// packages/worker/src/jobs/verificationProcessor.ts
import { Job } from 'bullmq';
import { VerificationJobData } from '../types.js';
import {
  verificationRepository,
  transcriptRepository,
  usageRepository,
  templateRepository,
  sessionRepository,
  type VerificationCandidateMessage,
  type VerificationStatementInput,
} from '@therascript/data';
import type {
  BackendChatMessage,
  BackendVerificationJob,
  StatementSeverity,
  StatementVerdict,
  StructuredTranscript,
  TranscriptEvidenceItem,
  TranscriptParagraphData,
} from '@therascript/domain';
import {
  streamLlmChatDetailed,
  calculateTokenCount,
  extractJsonObject,
  parseJsonObjectFromLlm,
  streamWithRetry,
  extractVisibleAnswer,
  type StreamResult,
  type LlmChatChunk,
} from '@therascript/services';
import config from '@therascript/config';
import { publishVerificationEvent } from '../services/streamPublisher.js';
import { runWithLlmWorkerLock } from '../llmWorkerMutex.js';
import {
  loadLlmModelForWorker,
  loadLlmApiTokenForWorker,
  unloadModelAtUrlForWorker,
  resolveEffectiveThinkingBudget,
} from './analysisProcessor.js';

export const VERIFICATION_JUDGE_TEMPLATE_TITLE = 'system_verification_judge';
export const VERIFICATION_USAGE_SOURCE = 'verification_judge';

/** Fallback judge prompt when the `system_verification_judge` template row is
 *  missing (fresh/legacy DBs seed it on startup, so this is defense-in-depth).
 *  Mirrors the seeded template's JSON contract. */
export const DEFAULT_VERIFICATION_JUDGE_PROMPT = `You are an expert fact-verification judge auditing an AI-generated therapy chat response against the ground-truth session transcript. You will be given:
1. GROUND-TRUTH SESSION TRANSCRIPT: Paragraphs formatted as [P#<index> MM:SS] <SPEAKER>: <text>. Some transcripts have no speaker diarization; those paragraphs are formatted as [P#<index> MM:SS] <text> with no speaker label.
2. THERAPIST'S PROMPT / QUESTION: The user message the AI was answering.
3. AI RESPONSE TO AUDIT: The visible text of the AI message to verify.

EVIDENCE CITATION RULES (must follow exactly):
- "paragraphIndex" MUST be the exact integer <index> copied from the cited paragraph's [P#<index> MM:SS] label. Never invent or guess an index.
- "timestampMs" should be your best estimate in milliseconds for the cited paragraph (the MM:SS label is minutes:seconds); it will be corrected against ground truth.
- "speaker" MUST be null when the cited paragraph shows no speaker label. Only copy a speaker label that literally appears after the [P#<index> MM:SS] tag; never copy speaker names from these instructions or examples.

Your tasks:
1. Extract every distinct factual or clinical statement/claim made in the AI Response about the session, client, therapist, symptoms, events, quotes, or interventions.
2. For each claim, copy the VERBATIM substring ("exact_quote") exactly as it appears in the AI Response so it can be highlighted in the UI. Do not paraphrase.
3. Verify each claim strictly against the Ground-Truth Session Transcript and assign one verdict:
   - "supported": Directly corroborated by the transcript.
   - "partially_supported": Contains a kernel of truth from the transcript but exaggerates, overgeneralizes, or adds unsupported detail.
   - "contradicted": Directly conflicts with what the transcript says (e.g., wrong speaker attribution, opposite clinical fact, wrong timeline).
   - "fabricated": Completely made up / hallucinated; not mentioned anywhere in the transcript.
4. Check for OMISSIONS: Did the AI fail to mention a major, explicit point from the transcript that directly answers the Therapist's Prompt? If so, include entries in the "omissions" array.

Respond with ONLY a valid JSON object (no markdown fences, no commentary) matching this schema:
{
  "summary_assessment": "Brief 1-sentence overall audit summary.",
  "claims": [
    {
      "exact_quote": "Verbatim sentence or clause from the AI response",
      "normalized_claim": "Concise standalone statement of the claim",
      "verdict": "supported | partially_supported | contradicted | fabricated",
      "severity": "none | low | medium | high | critical",
      "confidence": 0.95,
      "reasoning": "Why this claim is supported, contradicted, or fabricated based on the transcript.",
      "evidence": [
        {
          "paragraphIndex": 14,
          "timestampMs": 84000,
          "speaker": "SPEAKER_01",
          "quote": "Verbatim quote from the transcript"
        }
      ]
    }
  ],
  "omissions": [
    {
      "normalized_claim": "What important fact from the transcript was omitted relative to the user's prompt",
      "severity": "low | medium | high | critical",
      "confidence": 0.9,
      "reasoning": "Why this omission matters for the therapist's question.",
      "evidence": [
        {
          "paragraphIndex": 22,
          "timestampMs": 135000,
          "speaker": "SPEAKER_01",
          "quote": "Verbatim quote from the transcript that was missed"
        }
      ]
    }
  ]
}`;

export interface QuoteSpan {
  startChar: number | null;
  endChar: number | null;
}

const NULL_SPAN: QuoteSpan = { startChar: null, endChar: null };

function spansOverlap(
  aStart: number,
  aEnd: number,
  b: [number, number]
): boolean {
  return aStart < b[1] && b[0] < aEnd;
}

function isSpanFree(
  start: number,
  end: number,
  usedRanges: Array<[number, number]>
): boolean {
  return !usedRanges.some(([uStart, uEnd]) =>
    spansOverlap(start, end, [uStart, uEnd])
  );
}

/** All (possibly overlapping-checked-later) occurrences of `needle` in `haystack`. */
function findAllOccurrences(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  if (!needle) return indices;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    indices.push(idx);
    from = idx + 1;
  }
  return indices;
}

const MARKDOWN_STRIP_CHARS = new Set(['*', '_', '`', '~']);

/** Single/double/curly quote variants, all normalized to `'`. */
const QUOTE_NORMALIZE_CHARS = new Set([
  '"',
  "'",
  '\u201C',
  '\u201D',
  '\u2018',
  '\u2019',
]);

/** Typographic dashes, normalized to `-`. */
const DASH_NORMALIZE_CHARS = new Set(['\u2013', '\u2014']);

interface NormalizedText {
  normalized: string;
  /** normalized[i] was produced from original[map[i]]. */
  map: number[];
}

/**
 * Lowercase + collapse whitespace runs / strip inline markdown chars while
 * keeping an index map back to the original string. Quote variants collapse
 * to `'` and typographic dashes to `-` (1-to-1, map-preserving); inline
 * markdown tokens are dropped. Leading/trailing whitespace is trimmed (map
 * entries dropped accordingly).
 */
export function normalizeTextWithMap(text: string): NormalizedText {
  let normalized = '';
  const map: number[] = [];
  let pendingSpace = true; // trim leading whitespace
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (MARKDOWN_STRIP_CHARS.has(ch)) continue;
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && normalized.length > 0) {
      normalized += ' ';
      map.push(i);
    }
    pendingSpace = false;
    let out = ch;
    if (QUOTE_NORMALIZE_CHARS.has(ch)) out = "'";
    else if (DASH_NORMALIZE_CHARS.has(ch)) out = '-';
    normalized += out.toLowerCase();
    map.push(i);
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

/** Matching outer quotation-mark pairs the Judge LLM tends to add. */
const OUTER_QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '\u201C': '\u201D',
  '\u2018': '\u2019',
};

const LEADING_ELLIPSIS_RE = /^(?:\.{2,}|…+)\s*/;
const TRAILING_ELLIPSIS_RE = /\s*(?:\.{2,}|…+)$/;
const MID_QUOTE_ELLIPSIS_RE = /(?:\.{3,}|…+)/;

/**
 * Clean a Judge-supplied `exact_quote` before span resolution: trim, strip
 * matching outer quotation marks (`"..."`, `'...'`, `"..."`, `'...'`) and
 * strip leading/trailing ellipses (`...`, `…`). Handles either order
 * (`"...text..."` and `..."text"...`).
 */
export function cleanExactQuote(exactQuote: string): string {
  let cleaned = exactQuote.trim();
  for (let pass = 0; pass < 2; pass++) {
    cleaned = cleaned
      .replace(LEADING_ELLIPSIS_RE, '')
      .replace(TRAILING_ELLIPSIS_RE, '')
      .trim();
    if (cleaned.length >= 2) {
      const first = cleaned[0];
      const last = cleaned[cleaned.length - 1];
      if (OUTER_QUOTE_PAIRS[first] === last) {
        cleaned = cleaned.slice(1, -1).trim();
      }
    }
  }
  return cleaned;
}

const ANCHOR_LEN = 35;
const MIN_ANCHOR_QUOTE_LEN = 40;
const ANCHOR_WINDOW_SLACK = 80;

/** Minimum trimmed length for an ellipsis-separated clause to be usable. */
const MIN_SUBSTANTIVE_CLAUSE_LEN = 12;
/** Max normalized-char gap between spliced clauses to span them as one. */
const MAX_CLAUSE_SPAN_GAP = 80;

/**
 * Deterministically locate `exactQuote` inside `visibleMessageText`.
 *
 * LLMs reliably copy a verbatim phrase but cannot count characters, so the
 * Judge returns quotes — never offsets — and this pure helper resolves them:
 *   0. Quote cleaning: strip outer quotation marks and leading/trailing
 *      ellipses the Judge tends to add.
 *   1. Exact match pass (`indexOf`, preferring ranges that don't overlap
 *      `usedRanges` when the same phrase appears multiple times).
 *   2. Case-insensitive / whitespace- + markdown-normalized pass (quote
 *      variants and dashes normalized) with an index map back to the
 *      original string.
 *   3. Mid-quote ellipsis pass: quotes spliced with `...`/`…` are split into
 *      clauses; adjacent clauses within a single sentence/clause window are
 *      spanned, otherwise the longest matching clause wins (so a wide span
 *      never swallows — and blocks — unrelated inner statements).
 *   4. Substring anchor pass for slightly truncated long quotes: the first
 *      and last 35 chars must both match within a bounded window.
 *
 * Returns null offsets when nothing matches. Callers push successful spans
 * onto `usedRanges` so duplicate quotes in one message resolve to distinct
 * occurrences.
 */
export function locateQuoteSpan(
  visibleMessageText: string,
  exactQuote: string,
  usedRanges: Array<[number, number]> = []
): QuoteSpan {
  if (!visibleMessageText || !exactQuote) return { ...NULL_SPAN };
  const cleanedQuote = cleanExactQuote(exactQuote);
  if (!cleanedQuote) return { ...NULL_SPAN };

  // Pass 1: exact match.
  const exactHits = findAllOccurrences(visibleMessageText, cleanedQuote);
  const freeExact = exactHits.find((idx) =>
    isSpanFree(idx, idx + cleanedQuote.length, usedRanges)
  );
  if (freeExact !== undefined) {
    return { startChar: freeExact, endChar: freeExact + cleanedQuote.length };
  }

  // Pass 2: normalized match.
  const textNorm = normalizeTextWithMap(visibleMessageText);
  const quoteNorm = normalizeTextWithMap(cleanedQuote);
  if (quoteNorm.normalized.length > 0 && textNorm.normalized.length > 0) {
    const normHits = findAllOccurrences(
      textNorm.normalized,
      quoteNorm.normalized
    );
    for (const hit of normHits) {
      const start = textNorm.map[hit];
      const end = textNorm.map[hit + quoteNorm.normalized.length - 1] + 1;
      if (isSpanFree(start, end, usedRanges)) {
        return { startChar: start, endChar: end };
      }
    }

    // Pass 3: mid-quote ellipsis clause pass. Only reached when the literal
    // `...`/`…` is absent from the message text (Pass 2 failed), i.e. the
    // Judge spliced clauses or skipped a middle clause.
    if (MID_QUOTE_ELLIPSIS_RE.test(cleanedQuote)) {
      const ellipsisSpan = locateEllipsisClauseSpan(
        textNorm,
        cleanedQuote,
        usedRanges
      );
      if (ellipsisSpan) return ellipsisSpan;
    }

    // Pass 4: anchor pass for long, slightly truncated quotes.
    if (quoteNorm.normalized.length >= MIN_ANCHOR_QUOTE_LEN) {
      const head = quoteNorm.normalized.slice(0, ANCHOR_LEN);
      const tail = quoteNorm.normalized.slice(-ANCHOR_LEN);
      const windowLen = quoteNorm.normalized.length + ANCHOR_WINDOW_SLACK;
      for (const headIdx of findAllOccurrences(textNorm.normalized, head)) {
        const searchFrom = headIdx + head.length;
        const tailIdx = textNorm.normalized.indexOf(tail, searchFrom);
        if (tailIdx === -1 || tailIdx - headIdx > windowLen) continue;
        const start = textNorm.map[headIdx];
        const end = textNorm.map[tailIdx + tail.length - 1] + 1;
        if (isSpanFree(start, end, usedRanges)) {
          return { startChar: start, endChar: end };
        }
      }
    }
  }

  return { ...NULL_SPAN };
}

interface MatchedClause {
  /** Start/end offsets in normalized-text coordinates. */
  normStart: number;
  normEnd: number;
  normLength: number;
}

/**
 * Resolve a quote containing mid-quote `...`/`…` against normalized message
 * text. Splits into substantive clauses (>= 12 chars), anchors on the first
 * matching clause, and spans forward while each subsequent clause appears
 * within `MAX_CLAUSE_SPAN_GAP` chars; otherwise returns the longest matching
 * clause so `usedRanges` does not swallow unrelated intermediate sentences.
 * Returns null when no substantive clause matches (caller falls through to
 * the anchor pass).
 */
function locateEllipsisClauseSpan(
  textNorm: NormalizedText,
  cleanedQuote: string,
  usedRanges: Array<[number, number]>
): QuoteSpan | null {
  const clauses = cleanedQuote
    .split(MID_QUOTE_ELLIPSIS_RE)
    .map((c) => c.trim())
    .filter((c) => c.length >= MIN_SUBSTANTIVE_CLAUSE_LEN);
  if (clauses.length === 0) return null;

  const toOrigSpan = (normStart: number, normEnd: number): QuoteSpan => ({
    startChar: textNorm.map[normStart],
    endChar: textNorm.map[normEnd - 1] + 1,
  });

  // First free occurrence of each substantive clause, in quote order.
  const matched: (MatchedClause | null)[] = clauses.map((clause) => {
    const clauseNorm = normalizeTextWithMap(clause).normalized;
    if (!clauseNorm) return null;
    for (const hit of findAllOccurrences(textNorm.normalized, clauseNorm)) {
      const span = toOrigSpan(hit, hit + clauseNorm.length);
      if (
        span.startChar !== null &&
        span.endChar !== null &&
        isSpanFree(span.startChar, span.endChar, usedRanges)
      ) {
        return {
          normStart: hit,
          normEnd: hit + clauseNorm.length,
          normLength: clauseNorm.length,
        };
      }
    }
    return null;
  });

  const first = matched[0];
  if (!first) {
    // First clause unmatched: fall back to the longest matching clause.
    return longestMatchedClauseSpan(textNorm, matched, usedRanges);
  }

  // Extend across subsequent clauses while each lands within one
  // sentence/clause window of the previous clause end. Each subsequent
  // clause is (re-)searched at/after the current span end so repeated
  // phrases earlier in the message cannot derail chaining.
  let spanEnd = first.normEnd;
  let extended = false;
  for (let i = 1; i < clauses.length; i++) {
    const clauseNorm = normalizeTextWithMap(clauses[i]).normalized;
    if (!clauseNorm) break;
    let chained: MatchedClause | null = null;
    for (const hit of findAllOccurrences(textNorm.normalized, clauseNorm)) {
      if (hit < spanEnd) continue;
      if (hit - spanEnd > MAX_CLAUSE_SPAN_GAP) break;
      const span = toOrigSpan(hit, hit + clauseNorm.length);
      if (
        span.startChar !== null &&
        span.endChar !== null &&
        isSpanFree(span.startChar, span.endChar, usedRanges)
      ) {
        chained = {
          normStart: hit,
          normEnd: hit + clauseNorm.length,
          normLength: clauseNorm.length,
        };
        break;
      }
    }
    if (!chained) break;
    spanEnd = chained.normEnd;
    extended = true;
  }
  if (extended) {
    const span = toOrigSpan(first.normStart, spanEnd);
    if (
      span.startChar !== null &&
      span.endChar !== null &&
      isSpanFree(span.startChar, span.endChar, usedRanges)
    ) {
      return span;
    }
    // Spanned range blocked (e.g. an inner statement claimed first):
    // degrade to the longest matching clause.
  }
  const longest = longestMatchedClauseSpan(textNorm, matched, usedRanges);
  if (longest) return longest;
  // Every matching clause is blocked; report the anchor's span only if free
  // (already verified above via the clause-level checks, but re-check the
  // exact span for safety).
  const anchor = toOrigSpan(first.normStart, first.normEnd);
  if (
    anchor.startChar !== null &&
    anchor.endChar !== null &&
    isSpanFree(anchor.startChar, anchor.endChar, usedRanges)
  ) {
    return anchor;
  }
  return null;
}

/** Longest free matching clause (ties resolve to the earliest clause). */
function longestMatchedClauseSpan(
  textNorm: NormalizedText,
  matched: (MatchedClause | null)[],
  usedRanges: Array<[number, number]>
): QuoteSpan | null {
  let best: MatchedClause | null = null;
  for (const m of matched) {
    if (!m) continue;
    if (!best || m.normLength > best.normLength) best = m;
  }
  if (!best) return null;
  const span: QuoteSpan = {
    startChar: textNorm.map[best.normStart],
    endChar: textNorm.map[best.normEnd - 1] + 1,
  };
  if (
    span.startChar !== null &&
    span.endChar !== null &&
    isSpanFree(span.startChar, span.endChar, usedRanges)
  ) {
    return span;
  }
  return null;
}

/**
 * Per-message accuracy score: supported claims count 1.0, partial 0.5,
 * contradicted/fabricated 0, and every omission counts as a missed item in
 * the denominator. Conversational acknowledgements with 0 claims and 0
 * omissions default to 1.0.
 */
export function computeVerificationAccuracy(
  supportedClaims: number,
  partialClaims: number,
  totalClaims: number,
  omissionsCount: number
): number {
  const denominator = totalClaims + omissionsCount;
  if (denominator <= 0) return 1.0;
  return (supportedClaims + 0.5 * partialClaims) / denominator;
}

export function formatTimestampMmSs(timestampMs: number | null): string {
  const totalSeconds = Math.max(0, Math.floor((timestampMs ?? 0) / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * `[P#<index> MM:SS] <SPEAKER>: <text>` — the citation format the Judge
 * prompt promises. The speaker label is included only when `showSpeakers`
 * is true and the paragraph carries a real (non-`UNKNOWN`) label; otherwise
 * the paragraph renders as `[P#<index> MM:SS] <text>` so the Judge cannot
 * copy a fabricated speaker.
 */
export function formatTranscriptParagraph(
  paragraph: TranscriptParagraphData,
  showSpeakers = true
): string {
  const rawSpeaker = paragraph.speaker?.trim() ?? '';
  const labeled =
    showSpeakers &&
    rawSpeaker.length > 0 &&
    rawSpeaker.toUpperCase() !== 'UNKNOWN';
  const prefix = `[P#${paragraph.id} ${formatTimestampMmSs(paragraph.timestamp)}]`;
  return labeled
    ? `${prefix} ${rawSpeaker}: ${paragraph.text}`
    : `${prefix} ${paragraph.text}`;
}

export function formatTranscriptForJudge(
  paragraphs: TranscriptParagraphData[],
  showSpeakers = true
): string {
  return paragraphs
    .map((p) => formatTranscriptParagraph(p, showSpeakers))
    .join('\n');
}

/** Token estimate that survives a missing tokenizer (chars/4 fallback). */
export function estimateTokens(text: string): number {
  return calculateTokenCount(text) ?? Math.ceil(text.length / 4);
}

const MIN_KEYWORD_LEN = 3;

function tokenizeForOverlap(text: string): Set<string> {
  const keywords = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length >= MIN_KEYWORD_LEN) keywords.add(token);
  }
  return keywords;
}

export interface JudgeTranscriptContext {
  text: string;
  totalParagraphs: number;
  includedParagraphs: number;
  truncated: boolean;
}

const OMITTED_PARAGRAPHS_MARKER = (n: number) =>
  `\n\n[... ${n} transcript paragraph(s) omitted to fit the Judge context window ...]\n\n`;

/**
 * Build the transcript block for one Judge call. Short transcripts are passed
 * through verbatim; long ones are reduced to the top keyword-overlapping
 * paragraphs (vs. the therapist question + AI response) plus adjacent
 * paragraphs for context, in chronological order, within `tokenBudget`.
 *
 * Pure except for the injected `countTokens` (tests pass a stub).
 */
export function selectJudgeTranscriptContext(
  paragraphs: TranscriptParagraphData[],
  queryText: string,
  tokenBudget: number,
  countTokens: (text: string) => number = estimateTokens,
  showSpeakers = true
): JudgeTranscriptContext {
  const fullText = formatTranscriptForJudge(paragraphs, showSpeakers);
  if (paragraphs.length === 0) {
    return {
      text: '',
      totalParagraphs: 0,
      includedParagraphs: 0,
      truncated: false,
    };
  }
  if (countTokens(fullText) <= tokenBudget) {
    return {
      text: fullText,
      totalParagraphs: paragraphs.length,
      includedParagraphs: paragraphs.length,
      truncated: false,
    };
  }

  const keywords = tokenizeForOverlap(queryText);
  const scored = paragraphs.map((p, order) => {
    const haystack = p.text.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (haystack.includes(kw)) score++;
    }
    return { order, score };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);

  const selected = new Set<number>();
  let usedTokens = 0;
  const lineTokens = paragraphs.map((p) =>
    countTokens(formatTranscriptParagraph(p, showSpeakers))
  );
  for (const { order } of scored) {
    const triple = [order - 1, order, order + 1].filter(
      (i) => i >= 0 && i < paragraphs.length && !selected.has(i)
    );
    const cost = triple.reduce((sum, i) => sum + lineTokens[i], 0);
    if (usedTokens + cost > tokenBudget) continue;
    for (const i of triple) selected.add(i);
    usedTokens += cost;
  }
  // Degenerate budget (nothing fit): keep the single most relevant paragraph
  // so the Judge always has ground truth to cite.
  if (selected.size === 0) {
    selected.add(scored[0].order);
  }

  const ordered = [...selected].sort((a, b) => a - b);
  const text =
    ordered
      .map((i) => formatTranscriptParagraph(paragraphs[i], showSpeakers))
      .join('\n') +
    OMITTED_PARAGRAPHS_MARKER(paragraphs.length - ordered.length);
  return {
    text,
    totalParagraphs: paragraphs.length,
    includedParagraphs: ordered.length,
    truncated: true,
  };
}

// --- Judge JSON contract (raw, untrusted) ---

interface RawJudgeEvidence {
  paragraphIndex?: unknown;
  timestampMs?: unknown;
  speaker?: unknown;
  quote?: unknown;
}

interface RawJudgeClaim {
  exact_quote?: unknown;
  normalized_claim?: unknown;
  verdict?: unknown;
  severity?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
}

interface RawJudgeOmission {
  normalized_claim?: unknown;
  severity?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  evidence?: unknown;
}

interface RawJudgeOutput {
  summary_assessment?: unknown;
  claims?: unknown;
  omissions?: unknown;
}

const CLAIM_VERDICTS: StatementVerdict[] = [
  'supported',
  'partially_supported',
  'contradicted',
  'fabricated',
];

const SEVERITIES: StatementSeverity[] = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
];

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNonNegativeIntOrNull(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    Number.isFinite(value)
    ? value
    : null;
}

function asConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 1.0;
}

function normalizeEvidence(
  raw: unknown,
  hydration?: EvidenceHydrationOptions
): TranscriptEvidenceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: TranscriptEvidenceItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as RawJudgeEvidence;
    const quote = asOptionalString(e.quote);
    if (!quote) continue;
    const item: TranscriptEvidenceItem = {
      paragraphIndex: asNonNegativeIntOrNull(e.paragraphIndex),
      timestampMs: asNonNegativeIntOrNull(e.timestampMs),
      speaker: asOptionalString(e.speaker),
      quote,
    };
    items.push(hydration ? hydrateEvidenceItem(item, hydration) : item);
  }
  return items;
}

/** Ground-truth context used to validate Judge-supplied evidence items. */
export interface EvidenceHydrationOptions {
  /** Session transcript paragraphs keyed by paragraph index (`p.id`). */
  paragraphsById: Map<number, TranscriptParagraphData>;
  /** Session `showSpeakers` flag; falsy forces hydrated `speaker` to null. */
  showSpeakers?: boolean;
}

/** Sentence punctuation a Judge quote may add at a clause boundary. */
const TRAILING_QUOTE_PUNCT_RE = /[.!?;:,]+$/;

/**
 * Normalized search needle for a Judge-supplied quote: quote-cleaned,
 * whitespace/case/markdown-normalized, with trailing sentence punctuation
 * removed so a clause quote (`I take Sertraline.`) still matches the
 * paragraph that continues past it (`I take Sertraline every morning.`).
 */
function quoteSearchNeedle(quote: string): string {
  return normalizeTextWithMap(cleanExactQuote(quote)).normalized.replace(
    TRAILING_QUOTE_PUNCT_RE,
    ''
  );
}

/**
 * Whether the precomputed `needle` (see `quoteSearchNeedle`) appears in the
 * paragraph text. Shared by index validation and quote search so both paths
 * agree on what "matches" means.
 */
function paragraphContainsQuote(
  para: TranscriptParagraphData,
  needle: string
): boolean {
  if (!needle) return false;
  return normalizeTextWithMap(para.text).normalized.includes(needle);
}

/**
 * Locate the transcript paragraph containing `quote` (normalized,
 * quote-cleaned comparison). Used when the Judge omits `paragraphIndex`,
 * cites an out-of-bounds index, or cites an index whose paragraph does not
 * contain the quote.
 */
export function findParagraphByQuote(
  paragraphsById: Map<number, TranscriptParagraphData>,
  quote: string
): TranscriptParagraphData | null {
  const needle = quoteSearchNeedle(quote);
  if (!needle) return null;
  for (const para of paragraphsById.values()) {
    if (paragraphContainsQuote(para, needle)) {
      return para;
    }
  }
  return null;
}

/**
 * Hydrate one Judge evidence item against ground-truth transcript
 * paragraphs. The Judge only sees `[P#<index> MM:SS]` labels, so its
 * `timestampMs`/`speaker` values are estimates at best — always overwrite
 * them from the matched paragraph, and null out citations that match no
 * paragraph in this session. A cited `paragraphIndex` is only trusted when
 * its paragraph actually contains the quote; otherwise the quote is
 * searched across all paragraphs so a fabricated quote can never borrow a
 * real speaker/timestamp via a valid index.
 */
export function hydrateEvidenceItem(
  item: TranscriptEvidenceItem,
  options: EvidenceHydrationOptions
): TranscriptEvidenceItem {
  const showSpeakers = options.showSpeakers ?? true;
  const needle = quoteSearchNeedle(item.quote);
  let para: TranscriptParagraphData | null = null;
  const indexed =
    item.paragraphIndex !== null
      ? (options.paragraphsById.get(item.paragraphIndex) ?? null)
      : null;
  if (indexed && paragraphContainsQuote(indexed, needle)) {
    para = indexed;
  } else {
    // The cited index is absent, invalid, or does not contain the quote —
    // never attach its real speaker/time to unverified text. Search the
    // other paragraphs instead; findParagraphByQuote re-checks the indexed
    // paragraph too, but it already failed the same predicate above.
    para = findParagraphByQuote(options.paragraphsById, item.quote);
  }
  if (!para) {
    return { ...item, paragraphIndex: null, timestampMs: null, speaker: null };
  }
  const rawSpeaker = para.speaker?.trim() ?? '';
  const speaker =
    showSpeakers &&
    rawSpeaker.length > 0 &&
    rawSpeaker.toUpperCase() !== 'UNKNOWN'
      ? rawSpeaker
      : null;
  return {
    paragraphIndex: para.id,
    timestampMs: para.timestamp,
    speaker,
    quote: item.quote,
  };
}

export interface NormalizedJudgeResult {
  summaryAssessment: string | null;
  claims: Array<{
    exactQuote: string;
    normalizedClaim: string;
    verdict: StatementVerdict;
    severity: StatementSeverity;
    confidence: number;
    reasoning: string;
    evidence: TranscriptEvidenceItem[];
  }>;
  omissions: Array<{
    normalizedClaim: string;
    severity: StatementSeverity;
    confidence: number;
    reasoning: string;
    evidence: TranscriptEvidenceItem[];
  }>;
}

/**
 * Coerce raw Judge JSON into the persistence shape. Unknown claim verdicts
 * degrade to `partially_supported` (flagged, never silently trusted);
 * claims without any usable quote text are dropped. When `hydration` is
 * provided, every evidence item is validated against the ground-truth
 * transcript paragraphs (timestamps/speakers overwritten, unmatchable
 * citations nulled).
 */
export function normalizeJudgeOutput(
  raw: RawJudgeOutput | null,
  hydration?: EvidenceHydrationOptions
): NormalizedJudgeResult {
  const summaryAssessment =
    raw && typeof raw.summary_assessment === 'string'
      ? raw.summary_assessment
      : null;
  const claims: NormalizedJudgeResult['claims'] = [];
  const omissions: NormalizedJudgeResult['omissions'] = [];

  const rawClaims = raw && Array.isArray(raw.claims) ? raw.claims : [];
  for (const entry of rawClaims) {
    if (typeof entry !== 'object' || entry === null) continue;
    const c = entry as RawJudgeClaim;
    const exactQuote = asOptionalString(c.exact_quote);
    const normalizedClaim = asOptionalString(c.normalized_claim);
    if (!exactQuote && !normalizedClaim) continue;
    const verdict = CLAIM_VERDICTS.includes(c.verdict as StatementVerdict)
      ? (c.verdict as StatementVerdict)
      : 'partially_supported';
    const severity = SEVERITIES.includes(c.severity as StatementSeverity)
      ? (c.severity as StatementSeverity)
      : verdict === 'supported'
        ? 'none'
        : 'medium';
    claims.push({
      exactQuote: exactQuote ?? normalizedClaim ?? '',
      normalizedClaim: normalizedClaim ?? exactQuote ?? '',
      verdict,
      severity,
      confidence: asConfidence(c.confidence),
      reasoning: asNonEmptyString(c.reasoning, 'No reasoning provided.'),
      evidence: normalizeEvidence(c.evidence, hydration),
    });
  }

  const rawOmissions = raw && Array.isArray(raw.omissions) ? raw.omissions : [];
  for (const entry of rawOmissions) {
    if (typeof entry !== 'object' || entry === null) continue;
    const o = entry as RawJudgeOmission;
    const normalizedClaim = asOptionalString(o.normalized_claim);
    if (!normalizedClaim) continue;
    const severity = SEVERITIES.includes(o.severity as StatementSeverity)
      ? (o.severity as StatementSeverity)
      : 'medium';
    omissions.push({
      normalizedClaim,
      severity: severity === 'none' ? 'low' : severity,
      confidence: asConfidence(o.confidence),
      reasoning: asNonEmptyString(o.reasoning, 'No reasoning provided.'),
      evidence: normalizeEvidence(o.evidence, hydration),
    });
  }

  return { summaryAssessment, claims, omissions };
}

/** Deterministic default sampling temperature for Judge verdicts. */
export const JUDGE_DEFAULT_TEMPERATURE = 0.3;

/** Low-variance temperature for the single JSON-repair retry attempt. */
export const JUDGE_RETRY_TEMPERATURE = 0.1;

/**
 * Hard ceiling for the Judge's thinking budget. An unrestricted budget
 * (`-1`) lets reasoning models spend the entire completion allowance inside
 * `<think>` and emit no JSON at all; 2048 thinking tokens are plenty for a
 * per-message verdict while leaving room for the JSON payload.
 */
export const JUDGE_MAX_THINKING_BUDGET = 2048;

/** Reminder appended to the Judge user message on the JSON-repair retry. */
export const JUDGE_RETRY_REMINDER =
  '\n\nIMPORTANT REMINDER: Your previous response was not valid JSON. ' +
  'Respond with ONLY a valid JSON object matching the required schema. ' +
  'Properly escape all double quotes and newlines inside string values ' +
  '(use \\" and \\n), and do not include trailing commas, markdown fences, or commentary.';

/**
 * Reminder appended to the Judge user message when the first attempt parsed
 * as JSON but failed structural validation (missing/non-array `claims` or
 * `omissions`, or entries with no usable quote text).
 */
export const JUDGE_RETRY_SCHEMA_REMINDER =
  '\n\nIMPORTANT REMINDER: Your previous response was valid JSON but did not match the required schema. ' +
  'Respond with ONLY a JSON object containing "claims" (array) and "omissions" (array). ' +
  'Every claims entry must include "exact_quote" and "normalized_claim" strings; ' +
  'every omissions entry must include a "normalized_claim" string.';

/**
 * Resolve the effective Judge thinking budget: the shared `-1`-clamp first
 * (unrestricted/unset becomes the phase cap, `0` stays disabled), then the
 * Judge-specific hard ceiling so reasoning models cannot consume the whole
 * completion allowance inside `<think>`.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function resolveJudgeThinkingBudget(
  configuredBudget: number | null | undefined,
  maxThinkingCap: number
): number {
  return Math.min(
    resolveEffectiveThinkingBudget(configuredBudget, maxThinkingCap),
    JUDGE_MAX_THINKING_BUDGET
  );
}

const JSON_CONTROL_ESCAPES: Record<number, string> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
};

/**
 * Repair the two JSON defects Judge LLMs produce most often:
 *
 *   1. Raw control characters (`0x00`–`0x1F`, e.g. literal newlines/tabs)
 *      inside string literals — escaped to `\n`, `\t`, … or `\uXXXX`.
 *   2. Trailing commas before `}` or `]` — dropped.
 *
 * Both passes are string-aware (respect `\"` escapes) so commas and control
 * characters that are legitimately part of a string value are preserved.
 * Pure function: no I/O. Exported for unit testing.
 */
export function sanitizeJsonForParse(json: string): string {
  // Pass 1: escape raw control characters inside string literals.
  let escaped = '';
  let inString = false;
  let isEscaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (isEscaped) {
      escaped += ch;
      isEscaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped += ch;
        isEscaped = true;
        continue;
      }
      if (ch === '"') {
        escaped += ch;
        inString = false;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        escaped +=
          JSON_CONTROL_ESCAPES[code] ??
          `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
      escaped += ch;
      continue;
    }
    if (ch === '"') inString = true;
    escaped += ch;
  }

  // Pass 2: drop trailing commas before `}` / `]` outside strings.
  let stripped = '';
  inString = false;
  isEscaped = false;
  for (let i = 0; i < escaped.length; i++) {
    const ch = escaped[i];
    if (isEscaped) {
      stripped += ch;
      isEscaped = false;
      continue;
    }
    if (inString) {
      stripped += ch;
      if (ch === '\\') isEscaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      stripped += ch;
      inString = true;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < escaped.length && /\s/.test(escaped[j])) j++;
      if (j < escaped.length && (escaped[j] === '}' || escaped[j] === ']')) {
        continue; // Trailing comma — skip it (and keep the whitespace scan).
      }
    }
    stripped += ch;
  }
  return stripped;
}

/**
 * Parse one Judge LLM response into a JSON object with a sanitizing
 * fallback: when the strict parse throws (unescaped control characters,
 * trailing commas), the extracted candidate is sanitized and re-parsed
 * once. Returns `null` for truncated/empty output and unrecoverable syntax
 * errors — the caller decides whether to retry with thinking disabled.
 */
export function parseJudgeJson<T = unknown>(rawOutput: string): T | null {
  try {
    const parsed = parseJsonObjectFromLlm<T>(rawOutput);
    if (parsed != null) return parsed;
    // Incomplete/truncated (or empty): nothing a sanitizer could repair.
    return null;
  } catch {
    // Strict parse failed — fall through to the sanitized re-parse.
  }
  try {
    const extracted = extractJsonObject(rawOutput);
    if (!extracted.complete || !extracted.json.trim()) return null;
    return JSON.parse(sanitizeJsonForParse(extracted.json)) as T;
  } catch {
    return null;
  }
}

/** Structural validation verdict for one parsed Judge JSON payload. */
export interface JudgeStructureValidation {
  valid: boolean;
  /** Machine-readable reason; null when valid. */
  reason: string | null;
}

function isUsableJudgeClaim(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const c = entry as RawJudgeClaim;
  return (
    asOptionalString(c.exact_quote) !== null ||
    asOptionalString(c.normalized_claim) !== null
  );
}

function isUsableJudgeOmission(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  return (
    asOptionalString((entry as RawJudgeOmission).normalized_claim) !== null
  );
}

/**
 * Validate the *structure* of parsed Judge JSON. Syntax parsing alone
 * accepts objects such as `{}` or `{"error":"unable to assess"}`, which
 * normalization would coerce into empty claim/omission lists and score as
 * a perfect audit (accuracy 1.0). Likewise, a non-empty array whose
 * entries are all unusable would normalize to zero statements and look
 * clean.
 *
 * Requires a top-level object with array-typed `claims` and `omissions`
 * (explicitly empty arrays stay valid — e.g. conversational answers with
 * nothing to verify), plus at least one usable record in every non-empty
 * array (a claim needs `exact_quote` or `normalized_claim` text, matching
 * the normalization drop rule; an omission needs `normalized_claim`).
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function validateJudgeOutputStructure(
  raw: unknown
): JudgeStructureValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: 'top-level JSON value is not an object' };
  }
  const output = raw as RawJudgeOutput;
  if (!Array.isArray(output.claims)) {
    return { valid: false, reason: 'missing or non-array "claims"' };
  }
  if (!Array.isArray(output.omissions)) {
    return { valid: false, reason: 'missing or non-array "omissions"' };
  }
  if (output.claims.length > 0 && !output.claims.some(isUsableJudgeClaim)) {
    return {
      valid: false,
      reason: 'claims array has no usable claim records',
    };
  }
  if (
    output.omissions.length > 0 &&
    !output.omissions.some(isUsableJudgeOmission)
  ) {
    return {
      valid: false,
      reason: 'omissions array has no usable omission records',
    };
  }
  return { valid: true, reason: null };
}

/** Sentence/clause boundaries for the trivial-message fast path. */
const TRIVIAL_CLAUSE_SPLIT_RE = /[.!?…;:\n]+/;

/** Optional conversational openers stripped from the start of a clause. */
const TRIVIAL_OPENER_RE = /^(?:please|just|do|so|well|now|ok|okay|and|but)\b/;

/**
 * Recognized nonfactual utterance leads. A clause is trivial only when it
 * starts with one of these and continues with nothing but filler words
 * (see `TRIVIAL_FILLER_WORDS`).
 */
const TRIVIAL_LEAD_RE =
  /^(?:hi|hey|hello|greetings|good\s+(?:morning|afternoon|evening)|how can i help|what would you like to know|how may i (?:help|assist)|what can i (?:do|help)|let me know|happy to help|glad to (?:help|assist)|feel free to ask|is there anything (?:else )?i can|how are you)\b/;

/**
 * Words that cannot form a factual claim on their own: pronouns,
 * determiners, auxiliaries, prepositions, interrogatives, and neutral
 * conversational nouns. Deliberately excludes third-person pronouns,
 * clinical nouns/verbs, past-tense reporting verbs, and descriptive
 * content words, so any substantive clause fails the tail check and the
 * message is routed to the Judge. Unknown words fail closed (Judge).
 */
const TRIVIAL_FILLER_WORDS: ReadonlySet<string> = new Set([
  'a',
  'able',
  'about',
  'afternoon',
  'again',
  'all',
  'also',
  'always',
  'am',
  'an',
  'and',
  'another',
  'any',
  'anyone',
  'anything',
  'are',
  'as',
  'ask',
  'asking',
  'asks',
  'assist',
  'assistance',
  'assists',
  'at',
  'back',
  'be',
  'best',
  'better',
  'but',
  'can',
  'clarification',
  'could',
  'day',
  'days',
  'dear',
  'delay',
  'details',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'else',
  'everybody',
  'everyone',
  'evening',
  'everything',
  'feel',
  'feeling',
  'feedback',
  'folks',
  'for',
  'free',
  'friend',
  'friends',
  'from',
  'glad',
  'good',
  'great',
  'greetings',
  'guys',
  'had',
  'happy',
  'has',
  'have',
  'having',
  'hear',
  'hello',
  'help',
  'helpful',
  'helping',
  'helps',
  'here',
  'hey',
  'hi',
  'hope',
  'hoping',
  'how',
  'i',
  'if',
  'in',
  'information',
  'input',
  'into',
  'is',
  'it',
  'just',
  'know',
  'like',
  'look',
  'looking',
  'lot',
  'may',
  'me',
  'meet',
  'message',
  'might',
  'mind',
  'more',
  'morning',
  'much',
  'my',
  'need',
  'needs',
  'nice',
  'no',
  'not',
  'note',
  'nothing',
  'now',
  'of',
  'ok',
  'okay',
  'on',
  'one',
  'or',
  'other',
  'our',
  'out',
  'patience',
  'please',
  'provide',
  'provided',
  'question',
  'questions',
  'reach',
  'reached',
  'reaching',
  'ready',
  'reply',
  'response',
  'see',
  'session',
  'sessions',
  'shall',
  'share',
  'sharing',
  'should',
  'so',
  'some',
  'something',
  'soon',
  'sorry',
  'still',
  'talk',
  'talking',
  'team',
  'thank',
  'thanks',
  'that',
  'the',
  'there',
  'these',
  'this',
  'those',
  'time',
  'to',
  'today',
  'transcript',
  'transcripts',
  'understanding',
  'us',
  'useful',
  'very',
  'wait',
  'waiting',
  'want',
  'wants',
  'way',
  'ways',
  'we',
  'welcome',
  'well',
  'what',
  'when',
  'where',
  'which',
  'why',
  'will',
  'wish',
  'wishing',
  'with',
  'would',
  'you',
  'your',
]);

/** Lowercase letter words only; punctuation/digits become separators. */
function normalizeTrivialClause(clause: string): string {
  return clause
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/**
 * A clause is trivial only when, after stripping conversational openers,
 * it starts with a recognized nonfactual lead and every remaining word is
 * filler. Anything else (factual subjects, clinical verbs, content words,
 * unknown words) fails closed so the message goes to the Judge.
 */
function isTrivialClause(clause: string): boolean {
  let rest = normalizeTrivialClause(clause);
  if (!rest) return false;
  let opener: RegExpMatchArray | null;
  while ((opener = rest.match(TRIVIAL_OPENER_RE))) {
    rest = rest.slice(opener[0].length).trimStart();
    if (!rest) return false;
  }
  const lead = rest.match(TRIVIAL_LEAD_RE);
  if (!lead) return false;
  const tail = rest.slice(lead[0].length).trimStart();
  if (!tail) return true;
  return tail.split(' ').every((word) => TRIVIAL_FILLER_WORDS.has(word));
}

const TRIVIAL_QUOTE_CHARS = new Set(['"', "'", '“', '”', '‘', '’']);

/** List-item markers (`- foo`, `* foo`, `1. foo`) at a line start. */
const TRIVIAL_LIST_ITEM_RE = /(^|\n)\s*(?:[-*+]|\d+[.)])\s+\S/;

/** Inline Markdown that never appears in a plain conversational greeting. */
const TRIVIAL_MARKDOWN_RE = /[*`_~#|]/;

const THINK_BLOCK_RE = /<think>[\s\S]*?(?:<\/think>|$)/gi;

/**
 * Fast-path predicate for trivial conversational messages (short greetings
 * such as "Hello! How can I help you ...?") that carry no factual claims
 * and would waste a full Judge call to return `0 claims`.
 *
 * A message is trivial when, after stripping `<think>` blocks, it is short
 * (`<= 120` chars and `<= 20` words), contains no digits, no quote
 * characters, no bullet points / Markdown lists, and EVERY clause is a
 * complete, explicitly recognized nonfactual utterance: a known greeting /
 * offer lead followed only by filler words. Any additional substantive
 * clause (e.g. "Hello! The patient reported ...") fails the per-clause
 * check and the message goes to the Judge.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function isTrivialConversationalMessage(text: string): boolean {
  const stripped = text.replace(THINK_BLOCK_RE, '').trim();
  if (!stripped) return false;
  if (stripped.length > 120) return false;
  if (stripped.split(/\s+/).filter(Boolean).length > 20) return false;
  if (/\d/.test(stripped)) return false;
  for (const ch of stripped) {
    if (TRIVIAL_QUOTE_CHARS.has(ch)) return false;
  }
  if (TRIVIAL_LIST_ITEM_RE.test(stripped)) return false;
  if (TRIVIAL_MARKDOWN_RE.test(stripped)) return false;
  const clauses = stripped
    .split(TRIVIAL_CLAUSE_SPLIT_RE)
    .map((clause) => clause.trim())
    .filter((clause) => normalizeTrivialClause(clause) !== '');
  if (clauses.length === 0) return false;
  return clauses.every(isTrivialClause);
}

/** Worker-side remote-token gate (mirrors analysisProcessor's private helper). */
function resolveJudgeApiToken(url: string | undefined): string | null {
  if (!url || url === config.llm.baseURL) return null;
  return loadLlmApiTokenForWorker();
}

function buildJudgeUserMessage(
  transcriptText: string,
  userQuestion: string | null,
  visibleAnswer: string
): string {
  return (
    `GROUND-TRUTH SESSION TRANSCRIPT:\n"""${transcriptText}"""\n\n` +
    `THERAPIST'S PROMPT / QUESTION:\n"""${userQuestion?.trim() || '(no therapist question found — audit the response on its own merits)'}"""\n\n` +
    `AI RESPONSE TO AUDIT:\n"""${visibleAnswer}"""\n\n` +
    `YOUR TASK: Extract every factual/clinical claim, verify each strictly against the transcript, ` +
    `check for omissions relative to the therapist's question, and respond with ONLY the JSON object.`
  );
}

interface SessionTranscriptCache {
  paragraphs: StructuredTranscript;
}

interface JudgeStreamAttempt {
  rawOutput: string;
  streamResult: StreamResult;
  durationMs: number;
  canceled: boolean;
}

/**
 * Run one Judge LLM stream attempt (initial call or JSON-repair retry).
 * Accumulates `<think>` + content chunks into `rawOutput`, polls
 * `isCanceled` mid-stream, and reports usage via `streamResult`.
 * Usage logging is the caller's job so it happens immediately after *every*
 * attempt — even ones whose output later fails JSON parsing.
 */
async function runJudgeStreamAttempt(options: {
  jobId: number;
  messageId: number;
  judgeMessages: BackendChatMessage[];
  modelName: string | null | undefined;
  baseUrl: string;
  temperature: number;
  topP: number | null | undefined;
  repeatPenalty: number | null | undefined;
  numGpuLayers: number | null | undefined;
  thinkingBudget: number;
  maxCompletionTokens: number;
  isCanceled: () => boolean;
}): Promise<JudgeStreamAttempt> {
  const {
    jobId,
    messageId,
    judgeMessages,
    modelName,
    baseUrl,
    temperature,
    topP,
    repeatPenalty,
    numGpuLayers,
    thinkingBudget,
    maxCompletionTokens,
    isCanceled,
  } = options;
  const abortController = new AbortController();
  let lastCancelCheck = Date.now();
  let rawOutput = '';
  let streamResult: StreamResult = {};
  const attemptStartTime = Date.now();

  const generator = streamWithRetry(
    () =>
      streamLlmChatDetailed(judgeMessages, {
        model: modelName || undefined,
        abortSignal: abortController.signal,
        llamaCppBaseUrl: baseUrl,
        llmApiToken: resolveJudgeApiToken(baseUrl),
        temperature,
        topP: topP ?? undefined,
        repeatPenalty: repeatPenalty ?? undefined,
        numGpuLayers: numGpuLayers ?? undefined,
        thinkingBudget,
        maxCompletionTokens,
        passDefaultStopTokens: true,
        hardTimeoutMs: 15 * 60 * 1000,
        chatTemplateKwargs: {
          enable_thinking: thinkingBudget !== 0,
        },
      }),
    {
      retries: 2,
      onRetry: (err, attempt) => {
        console.warn(
          `[Verification Worker ${jobId}] judge message ${messageId} ` +
            `attempt ${attempt} failed: ${(err as Error)?.message ?? err}. Retrying.`
        );
      },
    }
  );

  let hasOpenThinkingBlock = false;
  let iterResult = await generator.next();
  while (!iterResult.done) {
    const chunk: LlmChatChunk = iterResult.value;
    const thinkingChunk = chunk.thinking ?? '';
    const contentChunk = chunk.content ?? '';
    if (thinkingChunk) {
      if (!hasOpenThinkingBlock) {
        rawOutput += '<think>';
        hasOpenThinkingBlock = true;
      }
      rawOutput += thinkingChunk;
    }
    if (contentChunk) {
      if (hasOpenThinkingBlock) {
        rawOutput += '</think>';
        hasOpenThinkingBlock = false;
      }
      rawOutput += contentChunk;
    }
    if (Date.now() - lastCancelCheck > 500) {
      lastCancelCheck = Date.now();
      if (isCanceled()) {
        abortController.abort();
        break;
      }
    }
    iterResult = await generator.next();
  }
  if (hasOpenThinkingBlock) {
    rawOutput += '</think>';
  }
  streamResult = (iterResult.value as StreamResult) ?? {};
  const durationMs = Date.now() - attemptStartTime;
  return { rawOutput, streamResult, durationMs, canceled: isCanceled() };
}

export async function processVerificationJob(
  job: Job<VerificationJobData, any, string>
) {
  const jobId = (job.data as VerificationJobData | undefined)?.jobId;
  if (typeof jobId !== 'number' || !Number.isInteger(jobId) || jobId <= 0) {
    throw new Error(
      `Invalid verification job payload: expected { jobId: positive int }, got ${JSON.stringify(job.data)}`
    );
  }
  console.log(`[Verification Worker] Starting processing for job ID: ${jobId}`);

  // Resolved inside try; kept in outer scope so `finally` can unload it.
  let judgeBaseUrl: string = config.llm.baseURL;
  let judgeModel = 'default';

  try {
    let jobRecord = verificationRepository.findVerificationJobById(jobId);
    if (!jobRecord) throw new Error(`Job ${jobId} not found in database.`);
    if (jobRecord.status === 'canceled') {
      await job.updateProgress(100);
      publishVerificationEvent(jobId, {
        type: 'status',
        status: 'canceled',
        message: 'Job was canceled before processing started.',
      });
      return;
    }

    judgeBaseUrl = jobRecord.llm_base_url || config.llm.baseURL;
    judgeModel = jobRecord.model_name || 'default';
    const contextSize = jobRecord.context_size ?? config.llm.contextSize;

    const judgeTemplate = templateRepository.findByTitle(
      VERIFICATION_JUDGE_TEMPLATE_TITLE
    );
    const judgeSystemPrompt =
      judgeTemplate?.text?.trim() || DEFAULT_VERIFICATION_JUDGE_PROMPT;
    if (!judgeTemplate?.text?.trim()) {
      console.warn(
        `[Verification Worker ${jobId}] '${VERIFICATION_JUDGE_TEMPLATE_TITLE}' template missing; using built-in fallback prompt.`
      );
    }

    // --- LOAD MODEL ---
    if (jobRecord.model_name && jobRecord.model_name !== 'default') {
      try {
        console.log(
          `[Verification Worker ${jobId}] Ensuring model is loaded... (baseUrl=${judgeBaseUrl})`
        );
        await loadLlmModelForWorker(
          jobRecord.model_name,
          jobRecord.context_size,
          judgeBaseUrl,
          jobRecord.num_gpu_layers
        );
        console.log(`[Verification Worker ${jobId}] Model ready.`);
      } catch (loadError: any) {
        console.error(
          `[Verification Worker ${jobId}] Failed to load model:`,
          loadError
        );
        const freshAfterLoadFailure =
          verificationRepository.findVerificationJobById(jobId);
        if (
          freshAfterLoadFailure &&
          freshAfterLoadFailure.status === 'canceled'
        ) {
          // The user canceled while the model was loading: preserve the
          // cancellation instead of overwriting it with `failed`.
          verificationRepository.updateJobStatus(jobId, 'canceled');
          await job.updateProgress(100);
          publishVerificationEvent(jobId, {
            type: 'status',
            status: 'canceled',
            message: 'Job canceled by user.',
          });
          return;
        }
        verificationRepository.updateJobStatus(jobId, 'failed', {
          errorMessage: `Failed to load model: ${loadError.message}`,
        });
        publishVerificationEvent(jobId, {
          type: 'error',
          status: 'failed',
          message: `Failed to load model: ${loadError.message}`,
        });
        throw loadError;
      }
    }

    // The user may have canceled while the model was loading: re-read the
    // row so the `processing` transition below cannot overwrite `canceled`.
    jobRecord = verificationRepository.findVerificationJobById(jobId);
    if (!jobRecord || jobRecord.status === 'canceled') {
      await job.updateProgress(100);
      verificationRepository.updateJobStatus(jobId, 'canceled');
      publishVerificationEvent(jobId, {
        type: 'status',
        status: 'canceled',
        message: 'Job canceled by user.',
      });
      return;
    }

    // --- CANDIDATES (newest-first, from the repository query) ---
    let sessionIds: number[] | null = null;
    if (jobRecord.session_ids_json) {
      try {
        const parsed: unknown = JSON.parse(jobRecord.session_ids_json);
        sessionIds = Array.isArray(parsed)
          ? parsed.filter(
              (v): v is number =>
                typeof v === 'number' && Number.isInteger(v) && v > 0
            )
          : null;
      } catch {
        console.warn(
          `[Verification Worker ${jobId}] Ignoring malformed session_ids_json.`
        );
      }
    }
    const candidates =
      verificationRepository.findCandidateMessagesForVerification({
        scope: jobRecord.scope,
        sessionIds,
        chatId: jobRecord.chat_id,
        skipVerified: jobRecord.skip_verified,
      });

    const transitioned = verificationRepository.transitionJobToProcessing(
      jobId,
      {
        totalMessages: candidates.length,
      }
    );
    if (!transitioned) {
      // Lost a race with a terminal transition (e.g. the user canceled
      // after the post-load re-read): never revive the terminal row.
      const fresh = verificationRepository.findVerificationJobById(jobId);
      await job.updateProgress(100);
      if (!fresh || fresh.status === 'canceled') {
        verificationRepository.updateJobStatus(jobId, 'canceled');
        publishVerificationEvent(jobId, {
          type: 'status',
          status: 'canceled',
          message: 'Job canceled by user.',
        });
      } else {
        console.warn(
          `[Verification Worker ${jobId}] Job became ${fresh.status} before processing started; leaving terminal state untouched.`
        );
      }
      return;
    }
    await job.updateProgress(2);
    publishVerificationEvent(jobId, {
      type: 'status',
      status: 'processing',
      message: `Auditing ${candidates.length} message(s), newest first.`,
      totalMessages: candidates.length,
      processedMessages: 0,
    });

    if (candidates.length === 0) {
      verificationRepository.updateJobStatus(jobId, 'completed');
      await job.updateProgress(100);
      publishVerificationEvent(jobId, {
        type: 'complete',
        status: 'completed',
        totalMessages: 0,
        processedMessages: 0,
        totalStatements: 0,
        flaggedStatements: 0,
        omissionsCount: 0,
      });
      console.log(
        `[Verification Worker] Job ${jobId} completed (no candidates).`
      );
      return;
    }

    // Judge completion budget: structured JSON verdicts need room, so mirror
    // the analysis map cap (30% of context, floor 4096) with the same 40%
    // thinking reserve and low-variance default temperature.
    const maxCompletionTokens = Math.max(4096, Math.round(contextSize * 0.3));
    const maxThinkingTokens = Math.round(maxCompletionTokens * 0.4);
    // The Judge budget is hard-capped (2048) on top of the shared `-1`
    // clamp so reasoning models cannot burn the whole completion allowance
    // inside `<think>` before emitting JSON.
    const effectiveThinkingBudget = resolveJudgeThinkingBudget(
      jobRecord.thinking_budget,
      maxThinkingTokens
    );
    const temperature = jobRecord.temperature ?? JUDGE_DEFAULT_TEMPERATURE;

    const transcriptCache = new Map<number, SessionTranscriptCache>();
    const getSessionParagraphs = (sessionId: number): StructuredTranscript => {
      const cached = transcriptCache.get(sessionId);
      if (cached) return cached.paragraphs;
      const paragraphs =
        transcriptRepository.findParagraphsBySessionId(sessionId);
      transcriptCache.set(sessionId, { paragraphs });
      return paragraphs;
    };

    // Per-session speaker-label visibility (sessions.showSpeakers): when a
    // session has no diarization the Judge must see unlabeled paragraphs and
    // hydrated evidence carries speaker: null.
    const showSpeakersCache = new Map<number, boolean>();
    const getSessionShowSpeakers = (sessionId: number): boolean => {
      const cached = showSpeakersCache.get(sessionId);
      if (cached !== undefined) return cached;
      let show = true;
      try {
        const session = sessionRepository.findById(sessionId);
        show = session?.showSpeakers !== 0;
      } catch (err) {
        console.warn(
          `[Verification Worker ${jobId}] Failed to load session ${sessionId}; assuming showSpeakers=true:`,
          err
        );
      }
      showSpeakersCache.set(sessionId, show);
      return show;
    };

    let processed = 0;

    const publishProgress = (extra?: {
      messageId?: number;
      chatId?: number;
      sessionId?: number;
      accuracyScore?: number;
      totalClaims?: number;
    }) => {
      const fresh = verificationRepository.findVerificationJobById(jobId);
      publishVerificationEvent(jobId, {
        type: 'progress',
        totalMessages: candidates.length,
        processedMessages: processed,
        totalStatements: fresh?.total_statements ?? 0,
        flaggedStatements: fresh?.flagged_statements ?? 0,
        omissionsCount: fresh?.omissions_count ?? 0,
        ...extra,
      });
    };

    for (const candidate of candidates) {
      jobRecord = verificationRepository.findVerificationJobById(jobId);
      if (!jobRecord || jobRecord.status === 'canceled') {
        await job.updateProgress(100);
        verificationRepository.updateJobStatus(jobId, 'canceled');
        publishVerificationEvent(jobId, {
          type: 'status',
          status: 'canceled',
          message: 'Job canceled by user.',
          totalMessages: candidates.length,
          processedMessages: processed,
        });
        return;
      }

      const messageId = candidate.id;
      const chatId = candidate.chatId;
      const sessionId = candidate.sessionId;
      const authoredModel = candidate.model ?? null;

      // Token/duration accumulators across the initial Judge call + the
      // single JSON-repair retry. Declared outside `try` so the failure
      // path persists actual usage instead of nulls.
      let accPromptTokens = 0;
      let accCompletionTokens = 0;
      let accDurationMs = 0;

      try {
        const visibleAnswer = extractVisibleAnswer(candidate.text ?? '').trim();
        const paragraphs = getSessionParagraphs(sessionId);

        // Nothing verifiable (conversational acknowledgement / thinking-only):
        // record a clean completed row without spending a Judge call.
        if (!visibleAnswer || paragraphs.length === 0) {
          const reason = !visibleAnswer
            ? 'No verifiable content in AI response.'
            : 'Session transcript is empty.';
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            accuracyScore: 1.0,
            summaryAssessment: reason,
            statements: [],
          });
          processed++;
          await job.updateProgress(
            Math.round((processed / candidates.length) * 100)
          );
          publishProgress();
          publishVerificationEvent(jobId, {
            type: 'message_verified',
            messageId,
            chatId,
            sessionId,
            accuracyScore: 1.0,
            totalClaims: 0,
          });
          continue;
        }

        // Trivial conversational greeting: no factual claims possible, so
        // skip the Judge call entirely (zero tokens, instant clean row).
        if (isTrivialConversationalMessage(visibleAnswer)) {
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            accuracyScore: 1.0,
            summaryAssessment:
              'Trivial conversational message; no factual claims to verify.',
            promptTokens: 0,
            completionTokens: 0,
            durationMs: 0,
            statements: [],
          });
          processed++;
          await job.updateProgress(
            Math.round((processed / candidates.length) * 100)
          );
          publishProgress();
          publishVerificationEvent(jobId, {
            type: 'message_verified',
            messageId,
            chatId,
            sessionId,
            accuracyScore: 1.0,
            totalClaims: 0,
          });
          continue;
        }

        // Transcript context budgeting: reserve the completion cap plus the
        // prompt overhead (system prompt + question + answer + margin) so the
        // Judge call never overflows its context window.
        const userQuestion = candidate.userQuestion ?? null;
        const judgeUserSkeleton = buildJudgeUserMessage(
          '',
          userQuestion,
          visibleAnswer
        );
        const overheadTokens =
          estimateTokens(judgeSystemPrompt) +
          estimateTokens(judgeUserSkeleton) +
          512;
        const transcriptBudget = Math.max(
          512,
          contextSize - maxCompletionTokens - overheadTokens
        );
        const showSpeakers = getSessionShowSpeakers(sessionId);
        const transcriptContext = selectJudgeTranscriptContext(
          paragraphs,
          `${userQuestion ?? ''}\n${visibleAnswer}`,
          transcriptBudget,
          estimateTokens,
          showSpeakers
        );
        if (transcriptContext.truncated) {
          console.log(
            `[Verification Worker ${jobId}] Transcript for session ${sessionId} reduced to ` +
              `${transcriptContext.includedParagraphs}/${transcriptContext.totalParagraphs} paragraphs for message ${messageId}.`
          );
        }

        const judgeMessages: BackendChatMessage[] = [
          {
            id: 0,
            chatId: 0,
            sender: 'system',
            text: judgeSystemPrompt,
            timestamp: Date.now(),
          },
          {
            id: 1,
            chatId: 0,
            sender: 'user',
            text: buildJudgeUserMessage(
              transcriptContext.text,
              userQuestion,
              visibleAnswer
            ),
            timestamp: Date.now(),
          },
        ];

        const isCanceled = (): boolean => {
          const fresh = verificationRepository.findVerificationJobById(jobId);
          return !fresh || fresh.status === 'canceled';
        };
        const finishCanceled = async (): Promise<void> => {
          await job.updateProgress(100);
          verificationRepository.updateJobStatus(jobId, 'canceled');
          publishVerificationEvent(jobId, {
            type: 'status',
            status: 'canceled',
            message: 'Job canceled by user.',
            totalMessages: candidates.length,
            processedMessages: processed,
          });
        };
        // Log usage immediately after each LLM call (before JSON parsing)
        // and accumulate across attempts so failed rows carry real metrics.
        const recordAttemptUsage = (
          attemptResult: StreamResult,
          durationMs: number
        ): void => {
          accPromptTokens += attemptResult.promptTokens ?? 0;
          accCompletionTokens += attemptResult.completionTokens ?? 0;
          accDurationMs += durationMs;
          try {
            usageRepository.insertUsageLog({
              type: 'llm',
              source: VERIFICATION_USAGE_SOURCE,
              model: judgeModel,
              promptTokens: attemptResult.promptTokens,
              completionTokens: attemptResult.completionTokens,
              duration: durationMs,
            });
          } catch (err) {
            console.warn(
              `[Verification Worker ${jobId}] Failed to log usage for message ${messageId}:`,
              err
            );
          }
        };

        const firstAttempt = await runJudgeStreamAttempt({
          jobId,
          messageId,
          judgeMessages,
          modelName: jobRecord?.model_name,
          baseUrl: judgeBaseUrl,
          temperature,
          topP: jobRecord?.top_p,
          repeatPenalty: jobRecord?.repeat_penalty,
          numGpuLayers: jobRecord?.num_gpu_layers,
          thinkingBudget: effectiveThinkingBudget,
          maxCompletionTokens,
          isCanceled,
        });
        recordAttemptUsage(firstAttempt.streamResult, firstAttempt.durationMs);

        if (firstAttempt.canceled) {
          await finishCanceled();
          return;
        }

        let parsed = parseJudgeJson<RawJudgeOutput>(firstAttempt.rawOutput);
        let structure = validateJudgeOutputStructure(parsed);
        if ((!parsed || !structure.valid) && !isCanceled()) {
          // One repair retry with thinking disabled and low-variance
          // sampling: reasoning output is the usual reason the first call
          // produced truncated/unparseable JSON, while parsed-but-invalid
          // output gets a schema-shaped reminder instead.
          console.warn(
            `[Verification Worker ${jobId}] Judge output for message ${messageId} ` +
              (parsed
                ? `failed structural validation (${structure.reason}); retrying once with thinking disabled.`
                : `failed JSON parsing; retrying once with thinking disabled.`)
          );
          const retryMessages: BackendChatMessage[] = [
            judgeMessages[0],
            {
              ...judgeMessages[1],
              text: `${judgeMessages[1].text}${parsed ? JUDGE_RETRY_SCHEMA_REMINDER : JUDGE_RETRY_REMINDER}`,
            },
          ];
          const retryAttempt = await runJudgeStreamAttempt({
            jobId,
            messageId,
            judgeMessages: retryMessages,
            modelName: jobRecord?.model_name,
            baseUrl: judgeBaseUrl,
            temperature: JUDGE_RETRY_TEMPERATURE,
            topP: jobRecord?.top_p,
            repeatPenalty: jobRecord?.repeat_penalty,
            numGpuLayers: jobRecord?.num_gpu_layers,
            thinkingBudget: 0,
            maxCompletionTokens,
            isCanceled,
          });
          recordAttemptUsage(
            retryAttempt.streamResult,
            retryAttempt.durationMs
          );

          if (retryAttempt.canceled) {
            await finishCanceled();
            return;
          }
          parsed = parseJudgeJson<RawJudgeOutput>(retryAttempt.rawOutput);
          structure = validateJudgeOutputStructure(parsed);
        }
        if (!parsed) {
          throw new Error(
            'Judge LLM did not return valid JSON (empty or unparseable output).'
          );
        }
        if (!structure.valid) {
          throw new Error(
            `Judge LLM returned structurally invalid JSON (${structure.reason}); cannot audit reliably.`
          );
        }
        // Hydrate Judge evidence against ground-truth transcript paragraphs:
        // overwrite hallucinated timestampMs/speaker from the DB row.
        const paragraphsById = new Map<number, TranscriptParagraphData>(
          paragraphs.map((p) => [p.id, p])
        );
        const normalized = normalizeJudgeOutput(parsed, {
          paragraphsById,
          showSpeakers,
        });

        const usedRanges: Array<[number, number]> = [];
        const statements: VerificationStatementInput[] = [];
        let statementIndex = 0;
        let supported = 0;
        let partial = 0;
        let contradicted = 0;
        let fabricated = 0;

        for (const claim of normalized.claims) {
          if (claim.verdict === 'supported') supported++;
          else if (claim.verdict === 'partially_supported') partial++;
          else if (claim.verdict === 'contradicted') contradicted++;
          else fabricated++;
          const span = locateQuoteSpan(
            visibleAnswer,
            claim.exactQuote,
            usedRanges
          );
          if (span.startChar !== null && span.endChar !== null) {
            usedRanges.push([span.startChar, span.endChar]);
          }
          statements.push({
            statementIndex: statementIndex++,
            kind: 'claim',
            exactQuote: claim.exactQuote,
            normalizedClaim: claim.normalizedClaim,
            startChar: span.startChar,
            endChar: span.endChar,
            verdict: claim.verdict,
            severity: claim.severity,
            confidence: claim.confidence,
            reasoning: claim.reasoning,
            evidence: claim.evidence,
          });
        }
        for (const omission of normalized.omissions) {
          // Omissions describe absent text: no span in the AI message.
          statements.push({
            statementIndex: statementIndex++,
            kind: 'omission',
            exactQuote: '',
            normalizedClaim: omission.normalizedClaim,
            startChar: null,
            endChar: null,
            verdict: 'omission',
            severity: omission.severity,
            confidence: omission.confidence,
            reasoning: omission.reasoning,
            evidence: omission.evidence,
          });
        }

        const totalClaims = normalized.claims.length;
        const omissionsCount = normalized.omissions.length;
        const accuracyScore = computeVerificationAccuracy(
          supported,
          partial,
          totalClaims,
          omissionsCount
        );

        verificationRepository.saveMessageVerificationResult({
          messageId,
          chatId,
          sessionId,
          verificationJobId: jobId,
          authoredModel,
          judgeModel,
          totalClaims,
          supportedClaims: supported,
          partialClaims: partial,
          contradictedClaims: contradicted,
          fabricatedClaims: fabricated,
          omissionsCount,
          accuracyScore,
          summaryAssessment: normalized.summaryAssessment,
          promptTokens: accPromptTokens,
          completionTokens: accCompletionTokens,
          durationMs: accDurationMs,
          statements,
        });

        processed++;
        await job.updateProgress(
          Math.round((processed / candidates.length) * 100)
        );
        publishProgress({
          messageId,
          chatId,
          sessionId,
          accuracyScore,
          totalClaims,
        });
        publishVerificationEvent(jobId, {
          type: 'message_verified',
          messageId,
          chatId,
          sessionId,
          accuracyScore,
          totalClaims,
        });

        console.log(
          `[Verification Worker ${jobId}] Verified message ${messageId} ` +
            `(${processed}/${candidates.length}, accuracy=${accuracyScore.toFixed(3)}).`
        );
      } catch (messageError: any) {
        console.error(
          `[Verification Worker ${jobId}] Failed to verify message ${messageId}:`,
          messageError
        );
        try {
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            status: 'failed',
            errorMessage: messageError?.message ?? String(messageError),
            promptTokens: accPromptTokens,
            completionTokens: accCompletionTokens,
            durationMs: accDurationMs,
            statements: [],
          });
        } catch (persistError) {
          console.error(
            `[Verification Worker ${jobId}] Failed to persist failure for message ${messageId}:`,
            persistError
          );
        }
        processed++;
        await job.updateProgress(
          Math.round((processed / candidates.length) * 100)
        );
        publishProgress();
      }
    }

    jobRecord = verificationRepository.findVerificationJobById(jobId);
    if (!jobRecord || jobRecord.status === 'canceled') {
      await job.updateProgress(100);
      verificationRepository.updateJobStatus(jobId, 'canceled');
      publishVerificationEvent(jobId, {
        type: 'status',
        status: 'canceled',
        message: 'Job canceled by user.',
        totalMessages: candidates.length,
        processedMessages: processed,
      });
      return;
    }

    const finalJob = verificationRepository.findVerificationJobById(jobId);
    await job.updateProgress(100);
    verificationRepository.updateJobStatus(jobId, 'completed');
    publishVerificationEvent(jobId, {
      type: 'complete',
      status: 'completed',
      totalMessages: candidates.length,
      processedMessages: processed,
      totalStatements: finalJob?.total_statements ?? 0,
      flaggedStatements: finalJob?.flagged_statements ?? 0,
      omissionsCount: finalJob?.omissions_count ?? 0,
    });
    console.log(`[Verification Worker] Job ${jobId} completed successfully.`);
  } catch (error: any) {
    console.error(`[Verification Worker] FAILED job ${jobId}:`, error);
    try {
      const jobRecord = verificationRepository.findVerificationJobById(jobId);
      if (jobRecord && jobRecord.status !== 'canceled') {
        verificationRepository.updateJobStatus(jobId, 'failed', {
          errorMessage: error?.message ?? String(error),
        });
        publishVerificationEvent(jobId, {
          type: 'error',
          status: 'failed',
          message: error?.message ?? String(error),
        });
      } else if (jobRecord) {
        verificationRepository.updateJobStatus(jobId, 'canceled');
      }
    } catch (statusError) {
      console.error(
        `[Verification Worker] Failed to mark job ${jobId} as failed:`,
        statusError
      );
    }
    throw error;
  } finally {
    // Best-effort: never let an unload failure mask the job outcome.
    try {
      const unloaded = await unloadModelAtUrlForWorker(judgeBaseUrl);
      console.log(
        `[Verification Worker ${jobId}] Unloaded ${unloaded} model instance(s) from ${judgeBaseUrl}`
      );
    } catch (unloadError: any) {
      console.warn(
        `[Verification Worker ${jobId}] Failed to unload model from ${judgeBaseUrl}:`,
        unloadError?.message ?? unloadError
      );
    }
  }
}

/**
 * BullMQ processor entry: serialized against analysis jobs via the shared
 * LLM worker mutex so the two queues never load/unload models concurrently.
 */
export default async function (job: Job<VerificationJobData, any, string>) {
  return runWithLlmWorkerLock(() => processVerificationJob(job));
}
