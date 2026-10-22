// packages/worker/src/jobs/verificationProcessor.ts
import { Job } from 'bullmq';
import { VerificationJobData } from '../types.js';
import {
  verificationRepository,
  transcriptRepository,
  usageRepository,
  templateRepository,
  sessionRepository,
  appSettingsRepository,
  type VerificationCandidateMessage,
  type VerificationStatementInput,
} from '@therascript/data';
import { formatMessagePreview } from '@therascript/domain';
import type {
  AppSettingsRow,
  BackendChatMessage,
  BackendVerificationJob,
  StatementSeverity,
  StatementVerdict,
  StructuredTranscript,
  TranscriptEvidenceItem,
  TranscriptParagraphData,
  VerificationFailureCode,
} from '@therascript/domain';
import type { VerificationStreamPhase } from '@therascript/queue';
import {
  streamLlmChatDetailed,
  calculateTokenCount,
  extractJsonObject,
  parseJsonObjectFromLlm,
  streamWithRetry,
  extractVisibleAnswer,
  prepareLlmChatMessages,
  type StreamResult,
  type LlmChatChunk,
} from '@therascript/services';
import config from '@therascript/config';
import { publishVerificationEvent } from '../services/streamPublisher.js';
import { runWithLlmWorkerLock } from '../llmWorkerMutex.js';
import {
  loadLlmModelForWorker,
  loadLlmApiTokenForWorker,
} from './analysisProcessor.js';

export const VERIFICATION_JUDGE_TEMPLATE_TITLE = 'system_verification_judge';
export const VERIFICATION_USAGE_SOURCE = 'verification_judge';

/** Fallback judge prompt when the `system_verification_judge` template row is
 *  missing (fresh/legacy DBs seed it on startup, so this is defense-in-depth).
 *  Mirrors the seeded template's JSON contract. */
export const DEFAULT_VERIFICATION_JUDGE_PROMPT = `You are an expert fact-verification judge auditing an AI-generated therapy chat response against the ground-truth session transcript. You will be given:
1. GROUND-TRUTH SESSION TRANSCRIPT: Paragraphs formatted as [P#<index> MM:SS] <SPEAKER>: <text>. Some transcripts have no speaker diarization; those paragraphs are formatted as [P#<index> MM:SS] <text> with no speaker label.
2. THERAPIST'S PROMPT / QUESTION: The instructions that were given to the AI (it may be a long template). It is context only — never extract claims from it.
3. AI RESPONSE TO AUDIT: The visible text of the AI message to verify. Extract claims ONLY from this text.

REASONING GUIDANCE (for models that think before answering):
- If you use <think> reasoning, keep your internal thinking brief and focused — do not draft full JSON or convert timestamps in <think>.
- Group closely related details from the same sentence or bullet into a single factual claim. Aim for at most 15-25 core factual/clinical claims for long structured notes rather than splitting every clause.

EVIDENCE CITATION RULES (must follow exactly):
- "paragraphIndex" MUST be the exact integer <index> copied from the cited paragraph's [P#<index> MM:SS] label. Never invent or guess an index.
- Each "evidence" item needs ONLY "paragraphIndex" and "quote". Do NOT include "timestampMs" or "speaker" — they are looked up automatically from the cited paragraph.

Your tasks:
1. Extract the key factual or clinical statements/claims made in the AI Response about the session, client, therapist, symptoms, events, quotes, or interventions. Group related clauses from one sentence or bullet into a single claim (at most ~15-25 claims for long structured notes).
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
      "reasoning": "One short sentence explaining the verdict.",
      "evidence": [
        {
          "paragraphIndex": 14,
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
      "reasoning": "One short sentence explaining why this omission matters.",
      "evidence": [
        {
          "paragraphIndex": 22,
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

/** Reminder appended to the Judge user message on the JSON-repair retry. */
export const JUDGE_RETRY_REMINDER =
  '\n\nIMPORTANT REMINDER: Your previous response was not valid JSON. ' +
  'Respond with ONLY a valid JSON object matching the required schema. ' +
  'Properly escape all double quotes and newlines inside string values ' +
  '(use \\" and \\n), and do not include trailing commas, markdown fences, or commentary. ' +
  'Keep any <think> reasoning brief and emit the final JSON object immediately.';

/**
 * Reminder appended to the Judge user message when the first attempt parsed
 * as JSON but failed structural validation (missing/non-array `claims` or
 * `omissions`, or entries with no usable quote text).
 */
export const JUDGE_RETRY_SCHEMA_REMINDER =
  '\n\nIMPORTANT REMINDER: Your previous response was valid JSON but did not match the required schema. ' +
  'Respond with ONLY a JSON object containing "claims" (array) and "omissions" (array). ' +
  'Every claims entry must include "exact_quote" and "normalized_claim" strings; ' +
  'every omissions entry must include a "normalized_claim" string. ' +
  'Keep any <think> reasoning brief and emit the final JSON object immediately.';

/**
 * Reminder appended to the Judge user message when the first attempt
 * produced runaway output (filled the completion cap or emitted a huge
 * volume of unparseable tokens): the retry demands a compact verdict
 * instead of repeating the identical giant call.
 */
export const JUDGE_RETRY_COMPACT_REMINDER =
  '\n\nIMPORTANT REMINDER: Your previous response was far too long and did not contain valid JSON. ' +
  'Respond with ONLY a compact valid JSON object matching the required schema, with no preamble or commentary. ' +
  'Keep every reasoning field to one sentence. ' +
  'Keep any <think> reasoning brief and emit the final JSON object immediately.';

/**
 * Unparseable output at or above this completion volume counts as a Judge
 * runaway even when the completion cap is larger: legitimate single-message
 * verdicts are single-digit kilobytes, so 16k tokens of invalid JSON means
 * the model rambled (repetition loop, endless thinking) instead of emitting
 * verdicts.
 */
export const JUDGE_RUNAWAY_COMPLETION_TOKENS = 16384;

/**
 * Fail-fast completion cap for the retry after a runaway first attempt
 * (`min(original cap, this)`). A concise valid verdict fits comfortably;
 * a second ramble fails in a minute or two instead of burning another
 * ~10 minutes filling a giant window.
 */
export const JUDGE_RUNAWAY_RETRY_MAX_COMPLETION_TOKENS = 8192;

/** Runaway verdict for one Judge attempt, from server-reported usage. */
export interface JudgeRunawayDetection {
  /**
   * True when the attempt filled the completion cap or emitted a huge
   * volume of output — the retry should demand a compact verdict under a
   * fail-fast cap instead of repeating the identical call.
   */
  runaway: boolean;
  /** True when generation demonstrably stopped at the completion cap. */
  hitCap: boolean;
}

/**
 * Detect runaway Judge output from server-reported completion tokens.
 * Missing usage (`null`/`undefined`) is never a runaway: without
 * evidence the standard retry path applies.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function detectJudgeRunaway(
  completionTokens: number | null | undefined,
  maxCompletionTokens: number
): JudgeRunawayDetection {
  if (completionTokens == null) {
    return { runaway: false, hitCap: false };
  }
  const hitCap =
    maxCompletionTokens > 0 && completionTokens >= maxCompletionTokens;
  const runaway = hitCap || completionTokens >= JUDGE_RUNAWAY_COMPLETION_TOKENS;
  return { runaway, hitCap };
}

/**
 * Fail-fast completion cap for the retry after a runaway first attempt.
 * Small-context judges keep their (already small) cap; giant windows
 * shrink to `JUDGE_RUNAWAY_RETRY_MAX_COMPLETION_TOKENS` so a second
 * ramble fails in a minute or two instead of ~10.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function resolveJudgeRetryCompletionBudget(
  maxCompletionTokens: number
): number {
  return Math.min(
    maxCompletionTokens,
    JUDGE_RUNAWAY_RETRY_MAX_COMPLETION_TOKENS
  );
}

/**
 * Resolve the effective Judge thinking budget: a straight passthrough of the
 * job's configured budget, matching Session Chat (`sessionChatHandler.ts`
 * passes `getConfiguredThinkingBudget()` to the LLM client untouched).
 * Unset (`null`/`undefined`) defaults to `-1` (unrestricted thinking);
 * `0` is honored only when the user explicitly disabled thinking.
 * Thinking is never clamped or disabled by the worker — not even on retry.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function resolveJudgeThinkingBudget(
  configuredBudget: number | null | undefined
): number {
  return configuredBudget ?? -1;
}

/**
 * Safety margin (tokens) kept free inside the Judge context window for
 * tokenizer-estimate drift plus the JSON-repair retry reminder.
 */
export const JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS = 512;

/**
 * Minimum viable completion budget. Structured JSON verdicts below this size
 * truncate too aggressively to audit reliably.
 */
export const JUDGE_MIN_COMPLETION_TOKENS = 512;

/**
 * Minimum transcript budget. Below this the Judge has no ground truth to
 * cite, so the request is not worth sending.
 */
export const JUDGE_MIN_TRANSCRIPT_TOKENS = 128;

export interface JudgeContextBudget {
  feasible: true;
  /** System prompt + question/answer skeleton + safety margin. */
  overheadTokens: number;
  /** Transcript budget for `selectJudgeTranscriptContext`. */
  transcriptTokens: number;
}

export interface JudgeContextBudgetInfeasible {
  feasible: false;
  overheadTokens: number;
  reason: string;
}

export type JudgeContextAllocation =
  | JudgeContextBudget
  | JudgeContextBudgetInfeasible;

/**
 * Allocate one Judge call's transcript budget from the actual remaining
 * context window. The transcript selection may use everything left after the
 * fixed overhead except the minimum viable completion reserve; the
 * completion cap itself is resolved afterwards from the *actual* selected
 * transcript via `resolveJudgeCompletionBudget`, so a short prompt never
 * starves `<think>` + JSON output with an artificial percentage cap.
 *
 * When the fixed prompt/answer overhead alone leaves insufficient room for
 * the minimum viable budgets, the allocation is infeasible: the caller must
 * record a failed assessment instead of sending a request known to overflow.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function allocateJudgeContextBudget(options: {
  contextSize: number;
  systemPromptTokens: number;
  /** Question/answer wrapper with an empty transcript. */
  skeletonTokens: number;
}): JudgeContextAllocation {
  const { contextSize, systemPromptTokens, skeletonTokens } = options;
  const overheadTokens =
    systemPromptTokens + skeletonTokens + JUDGE_CONTEXT_SAFETY_MARGIN_TOKENS;
  const remaining = contextSize - overheadTokens;
  const minimum = JUDGE_MIN_COMPLETION_TOKENS + JUDGE_MIN_TRANSCRIPT_TOKENS;
  if (remaining < minimum) {
    return {
      feasible: false,
      overheadTokens,
      reason:
        `Judge context window (${contextSize} tokens) cannot fit this request: ` +
        `the system prompt, question, and answer need ~${overheadTokens} tokens, ` +
        `leaving ${remaining} for completion plus transcript ` +
        `(minimum ${minimum}). ` +
        `Increase the judge context size or shorten the answer.`,
    };
  }
  // The transcript selection gets everything except the minimum completion
  // reserve; completion is sized from the actual leftovers afterwards.
  const transcriptTokens = remaining - JUDGE_MIN_COMPLETION_TOKENS;
  return {
    feasible: true,
    overheadTokens,
    transcriptTokens,
  };
}

/**
 * Resolve one Judge call's completion cap from the context capacity that
 * actually remains after the prompt: `contextSize - overheadTokens -
 * transcriptTokens` (transcript measured post-selection), floored at
 * `JUDGE_MIN_COMPLETION_TOKENS`. Reasoning models get the full remaining
 * window for `<think>` + JSON instead of a fixed 30% slice.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function resolveJudgeCompletionBudget(options: {
  contextSize: number;
  overheadTokens: number;
  /** Selected transcript block, measured in tokens. */
  transcriptTokens: number;
}): number {
  const { contextSize, overheadTokens, transcriptTokens } = options;
  return Math.max(
    JUDGE_MIN_COMPLETION_TOKENS,
    contextSize - overheadTokens - transcriptTokens
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
 * errors — the caller decides whether to retry (thinking stays enabled).
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

/**
 * Snapshotted Judge LLM config needed to adopt a finished Fact Check's model
 * as the global active settings (a subset of `BackendVerificationJob`).
 */
export interface JudgeActiveSettingsSource {
  model_name: string | null;
  context_size: number | null;
  thinking_budget: number | null;
  temperature: number | null;
  top_p: number | null;
  repeat_penalty: number | null;
  num_gpu_layers: number | null;
  llm_base_url: string | null;
}

/**
 * Build the global `app_settings` update that adopts a Fact Check's Judge LLM
 * config as the active model settings, so Session/Standalone chat and the
 * next Fact Check start with the Judge model (and its context/params) preset
 * — and chat's `ensureModelLoaded` reuses the still-loaded model instead of
 * evicting it.
 *
 * Range guards mirror `setActiveModelAndContextAndParams` in the API's
 * `activeModelService` (the job row carries no range validation, so a
 * malformed row must never corrupt the global settings): out-of-range
 * sampling values are skipped, i.e. the current global value is kept.
 * `temperature`/`top_p`/`repeat_penalty` are `NOT NULL` in `app_settings`,
 * so null snapshots are skipped as well. The `llm_base_url` override is
 * `null` when the job ran on the local default (trailing-slash-insensitive
 * comparison), otherwise the job's concrete URL.
 *
 * Pure function: no I/O. Exported for unit testing. The caller persists the
 * result via `appSettingsRepository.updateSettings` (best-effort).
 */
export function buildJudgeActiveSettingsUpdate(
  job: JudgeActiveSettingsSource,
  localBaseUrl: string
): Partial<AppSettingsRow> {
  const stripTrailingSlashes = (value: string): string =>
    value.replace(/\/+$/, '');
  const update: Partial<AppSettingsRow> = {};

  if (job.model_name) {
    update.llm_model_name = job.model_name;
  }
  if (
    job.context_size === null ||
    (Number.isInteger(job.context_size) && job.context_size > 0)
  ) {
    update.llm_context_size = job.context_size;
  }
  if (
    typeof job.temperature === 'number' &&
    job.temperature >= 0 &&
    job.temperature <= 2
  ) {
    update.llm_temperature = job.temperature;
  }
  if (typeof job.top_p === 'number' && job.top_p >= 0 && job.top_p <= 1) {
    update.llm_top_p = job.top_p;
  }
  if (
    typeof job.repeat_penalty === 'number' &&
    job.repeat_penalty >= 0 &&
    job.repeat_penalty <= 2
  ) {
    update.llm_repeat_penalty = job.repeat_penalty;
  }
  if (
    job.num_gpu_layers === null ||
    (Number.isInteger(job.num_gpu_layers) && job.num_gpu_layers >= 0)
  ) {
    update.llm_num_gpu_layers = job.num_gpu_layers;
  }
  if (job.thinking_budget === null || Number.isInteger(job.thinking_budget)) {
    update.llm_thinking_budget = job.thinking_budget;
  }

  const jobUrl = job.llm_base_url?.trim();
  update.llm_base_url =
    jobUrl &&
    stripTrailingSlashes(jobUrl) !== stripTrailingSlashes(localBaseUrl)
      ? jobUrl
      : null;
  return update;
}

/**
 * Judge system prompt with the ground-truth transcript appended, mirroring
 * Session Chat (`sessionChatHandler.ts` injects the transcript into the
 * system prefix so the static prefix stays KV-cache-friendly across calls).
 */
function buildJudgeSystemPrompt(
  basePrompt: string,
  transcriptText: string
): string {
  return (
    `${basePrompt}\n\n--- GROUND-TRUTH SESSION TRANSCRIPT ---\n` +
    `"""\n${transcriptText}\n"""\n--- END TRANSCRIPT ---`
  );
}

/**
 * Focused Judge user turn: the therapist's prompt (the instructions given to
 * the AI — possibly a long template, delimited as context only) and the AI
 * response under audit (the sole text claims are extracted from).
 */
function buildJudgeUserMessage(
  userQuestion: string | null,
  visibleAnswer: string
): string {
  return (
    `THERAPIST'S PROMPT / QUESTION (the instructions given to the AI — context only, never extract claims from this):\n"""${userQuestion?.trim() || '(no therapist question found — audit the response on its own merits)'}"""\n\n` +
    `AI RESPONSE TO AUDIT (extract claims ONLY from this text):\n"""${visibleAnswer}"""\n\n` +
    `YOUR TASK: Extract the key factual/clinical claims, verify each strictly against the transcript, ` +
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
 * Live token-speed context for one Judge stream attempt. Counter values
 * are snapshots taken when the attempt starts (they cannot change
 * mid-attempt); ticks reuse the `phase` event so consumers need no new
 * event branch.
 */
interface JudgeStreamTelemetry {
  phase: 'generating' | 'retrying';
  chatId?: number;
  sessionId?: number;
  messageIndex?: number;
  attempt?: number;
  totalMessages: number;
  processedMessages: number;
  succeededMessages: number;
  failedMessages: number;
  jobStartTime: number;
  messagePreview?: string | null;
}

/**
 * Run one Judge LLM stream attempt (initial call or JSON-repair retry).
 * Accumulates `<think>` + content chunks into `rawOutput`, polls
 * `isCanceled` mid-stream, and reports usage via `streamResult`.
 * Usage logging is the caller's job so it happens immediately after *every*
 * attempt — even ones whose output later fails JSON parsing.
 * When `streamTelemetry` is provided, throttled `phase` ticks publish the
 * live token generation speed (Redis only, never SQLite).
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
  streamTelemetry?: JudgeStreamTelemetry;
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
    streamTelemetry,
  } = options;
  const abortController = new AbortController();
  let lastCancelCheck = Date.now();
  let rawOutput = '';
  let streamResult: StreamResult = {};
  const attemptStartTime = Date.now();

  // Live token-speed tracking (same len/4 heuristic as Session Chat and
  // Cross-Session Analysis). Ticks are throttled and Redis-only.
  let firstTokenAt: number | null = null;
  let estimatedTokens = 0;
  let lastTokenPublishAt = attemptStartTime;
  const maybePublishTokenTelemetry = (): void => {
    if (!streamTelemetry || firstTokenAt === null) return;
    const now = Date.now();
    const elapsedSec = (now - firstTokenAt) / 1000;
    if (elapsedSec <= 0.1) return;
    if (now - lastTokenPublishAt < VERIFICATION_TOKEN_TELEMETRY_THROTTLE_MS)
      return;
    lastTokenPublishAt = now;
    const tokensPerSecond =
      Math.round((estimatedTokens / elapsedSec) * 10) / 10;
    publishVerificationEvent(jobId, {
      type: 'phase',
      phase: streamTelemetry.phase,
      message: describeVerificationPhase({
        phase: streamTelemetry.phase,
        messageIndex: streamTelemetry.messageIndex,
        totalMessages: streamTelemetry.totalMessages,
        messageId,
        attempt: streamTelemetry.attempt,
        messagePreview: streamTelemetry.messagePreview,
      }),
      totalMessages: streamTelemetry.totalMessages,
      processedMessages: streamTelemetry.processedMessages,
      succeededMessages: streamTelemetry.succeededMessages,
      failedMessages: streamTelemetry.failedMessages,
      skippedMessages: 0,
      messageId,
      chatId: streamTelemetry.chatId,
      sessionId: streamTelemetry.sessionId,
      messageIndex: streamTelemetry.messageIndex,
      attempt: streamTelemetry.attempt,
      elapsedMs: now - streamTelemetry.jobStartTime,
      messagePreview: streamTelemetry.messagePreview ?? null,
      tokensPerSecond,
      generatedTokens: estimatedTokens,
    });
  };

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
    for (const chunkText of [thinkingChunk, contentChunk]) {
      if (!chunkText) continue;
      if (firstTokenAt === null) firstTokenAt = Date.now();
      estimatedTokens += Math.max(1, Math.floor(chunkText.length / 4));
    }
    maybePublishTokenTelemetry();
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

/**
 * Maximum characters of provider/parse detail kept in a persisted per-message
 * error. Diagnostics stay concise and can never leak a full transcript or
 * raw model reasoning (only bounded summaries and error text are stored).
 */
export const VERIFICATION_MAX_ERROR_DETAIL_CHARS = 300;

/** Maximum characters for a persisted job-level error summary. */
export const VERIFICATION_MAX_JOB_SUMMARY_CHARS = 600;

/** Delay before an uncontended lock wait publishes `waiting_for_lock`. */
export const VERIFICATION_LOCK_WAIT_PUBLISH_MS = 500;

/**
 * Minimum gap between live token-speed `phase` ticks during Judge
 * streaming, so fast token streams do not flood Redis/SSE (~3 msgs/sec).
 */
export const VERIFICATION_TOKEN_TELEMETRY_THROTTLE_MS = 300;

export function truncateVerificationDetail(detail: string): string {
  const singleLine = detail.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= VERIFICATION_MAX_ERROR_DETAIL_CHARS) {
    return singleLine;
  }
  return `${singleLine.slice(0, VERIFICATION_MAX_ERROR_DETAIL_CHARS - 1)}…`;
}

/** Short human-readable label for a per-message failure category. */
export function verificationFailureLabel(
  code: VerificationFailureCode
): string {
  switch (code) {
    case 'empty_output':
      return 'Judge returned no output';
    case 'malformed_json':
      return 'Judge returned invalid JSON';
    case 'truncated_output':
      return 'Judge output hit the completion cap';
    case 'invalid_structure':
      return 'Judge JSON failed schema validation';
    case 'provider_error':
      return 'Judge provider request failed';
    case 'context_budget':
      return 'Judge context window too small';
    case 'missing_transcript':
      return 'Session transcript unavailable';
  }
}

/**
 * Error carrying a machine-readable per-message failure category. Thrown for
 * classified Judge failures so the persistence path records `error_code`
 * alongside the human-readable `error_message`.
 */
export class CodedVerificationError extends Error {
  readonly code: VerificationFailureCode;

  constructor(code: VerificationFailureCode, message: string) {
    super(message);
    this.name = 'CodedVerificationError';
    this.code = code;
  }
}

export function readVerificationFailureCode(
  error: unknown
): VerificationFailureCode | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const code = (error as { code: string }).code;
    if (
      code === 'empty_output' ||
      code === 'malformed_json' ||
      code === 'truncated_output' ||
      code === 'invalid_structure' ||
      code === 'provider_error' ||
      code === 'context_budget' ||
      code === 'missing_transcript'
    ) {
      return code;
    }
  }
  return null;
}

function formatVerificationDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

/**
 * Bounded per-message failure record: job/message IDs plus the Judge model,
 * phase/attempt, duration, and token usage that identify the failed call.
 * Never includes transcripts or raw reasoning — only the bounded detail.
 */
export function buildMessageFailureMessage(options: {
  code: VerificationFailureCode;
  jobId: number;
  messageId: number;
  judgeModel: string;
  phase: 'checking_message' | 'generating' | 'retrying';
  attempt: number;
  attemptsTotal: number;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  detail: string;
}): string {
  const {
    code,
    jobId,
    messageId,
    judgeModel,
    phase,
    attempt,
    attemptsTotal,
    durationMs,
    promptTokens,
    completionTokens,
    detail,
  } = options;
  const phaseLabel = phase === 'checking_message' ? 'setup' : phase;
  return (
    `[${code}] ${verificationFailureLabel(code)} for message ${messageId} ` +
    `(job ${jobId}, judge "${judgeModel}", ${phaseLabel}, ` +
    `attempt ${attempt} of ${attemptsTotal}, ` +
    `${formatVerificationDuration(durationMs)}, ` +
    `${promptTokens}+${completionTokens} tokens): ` +
    truncateVerificationDetail(detail)
  );
}

/**
 * Bounded job-level error summary for all-failed and mixed-outcome runs.
 * Carries counts plus the first failure's category so history rows and the
 * terminal banner stay debuggable without opening every message.
 */
export function buildJobFailureSummary(options: {
  jobId: number;
  judgeModel: string;
  succeeded: number;
  failed: number;
  total: number;
  firstFailureCode: VerificationFailureCode | null;
  firstFailureDetail: string | null;
}): string {
  const {
    jobId,
    judgeModel,
    succeeded,
    failed,
    total,
    firstFailureCode,
    firstFailureDetail,
  } = options;
  const headline =
    succeeded === 0
      ? `All ${failed} attempted assessment${failed === 1 ? '' : 's'} failed`
      : `Completed with errors: ${succeeded} of ${total} checked, ${failed} failed`;
  let summary =
    `${headline} (job ${jobId}, judge "${judgeModel}"). ` +
    (firstFailureCode && firstFailureDetail
      ? `First failure [${firstFailureCode}]: ${truncateVerificationDetail(firstFailureDetail)}`
      : 'No failure detail recorded.');
  if (summary.length > VERIFICATION_MAX_JOB_SUMMARY_CHARS) {
    summary = `${summary.slice(0, VERIFICATION_MAX_JOB_SUMMARY_CHARS - 1)}…`;
  }
  return summary;
}

/** Human-readable one-liner for a worker phase publish. */
export function describeVerificationPhase(options: {
  phase: VerificationStreamPhase;
  messageIndex?: number;
  totalMessages?: number;
  messageId?: number;
  attempt?: number;
  messagePreview?: string | null;
}): string {
  const { phase, messageIndex, totalMessages, messageId, attempt } = options;
  const preview = options.messagePreview?.trim()
    ? options.messagePreview
    : null;
  const position =
    messageIndex !== undefined && totalMessages !== undefined
      ? `${messageIndex} of ${totalMessages}`
      : null;
  switch (phase) {
    case 'waiting_for_lock':
      return 'Waiting for the LLM worker lock…';
    case 'loading_judge':
      return 'Loading the Judge model…';
    case 'checking_message':
      if (preview) {
        return position && totalMessages !== 1
          ? `Checking message ${position}: "${preview}"…`
          : `Checking "${preview}"…`;
      }
      return position ? `Checking message ${position}…` : 'Checking message…';
    case 'generating': {
      if (preview) {
        const attemptSuffix =
          attempt !== undefined && attempt > 1 ? `, attempt ${attempt}` : '';
        return position
          ? `Generating assessment (${position}${attemptSuffix}): "${preview}"…`
          : `Generating assessment: "${preview}"…`;
      }
      return messageId !== undefined
        ? `Generating assessment for message #${messageId} (attempt 1)…`
        : 'Generating assessment (attempt 1)…';
    }
    case 'retrying': {
      const attemptLabel = attempt ?? 2;
      if (preview) {
        return position
          ? `Retrying assessment (${position}, attempt ${attemptLabel}): "${preview}"…`
          : `Retrying assessment (attempt ${attemptLabel}): "${preview}"…`;
      }
      return messageId !== undefined
        ? `Retrying message #${messageId} (attempt ${attemptLabel})…`
        : `Retrying assessment (attempt ${attemptLabel})…`;
    }
    case 'finishing':
      return 'Finishing audit…';
  }
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

  // Resolved inside try; kept in outer scope so the stream attempts and the
  // persisted rows use the job's endpoint/model even after `jobRecord` is
  // re-read for cancellation checks.
  let judgeBaseUrl: string = config.llm.baseURL;
  let judgeModel = 'default';

  // Finished-attempt outcome split. `processed` stays the count of finished
  // attempts (successes + failures); these counters break it down so failed
  // attempts are never equated with successful checks. In-memory values are
  // authoritative at terminal transitions (persisted absolutely), while
  // incremental DB writes keep reloads truthful mid-run.
  let succeeded = 0;
  let failed = 0;
  let totalCandidates = 0;
  const processingStartTime = Date.now();
  // Holder object (not a narrowed `let`) so closure writes in
  // `noteFirstFailure` are visible at the terminal transition below.
  const firstFailureHolder: {
    current: { code: VerificationFailureCode; detail: string } | null;
  } = { current: null };

  /**
   * Publish a lifecycle phase change: transient SSE event plus a durable
   * phase snapshot on the job row (reconnects/page reloads read the row).
   * Phase persistence failures are logged, never fatal — the audit itself
   * must not fail because a progress write failed.
   */
  const publishPhase = (
    phase: VerificationStreamPhase,
    options: {
      processed: number;
      messageId?: number;
      chatId?: number;
      sessionId?: number;
      messageIndex?: number;
      attempt?: number;
      messagePreview?: string | null;
    }
  ): void => {
    const {
      processed,
      messageId,
      chatId,
      sessionId,
      messageIndex,
      attempt,
      messagePreview,
    } = options;
    try {
      verificationRepository.updateJobPhase(jobId, {
        currentPhase: phase,
        currentMessageId: messageId ?? null,
        currentAttempt: attempt ?? null,
      });
    } catch (phaseError) {
      console.warn(
        `[Verification Worker ${jobId}] Failed to persist phase ${phase}:`,
        phaseError
      );
    }
    publishVerificationEvent(jobId, {
      type: 'phase',
      phase,
      message: describeVerificationPhase({
        phase,
        messageIndex,
        totalMessages: totalCandidates > 0 ? totalCandidates : undefined,
        messageId,
        attempt,
        messagePreview,
      }),
      totalMessages: totalCandidates > 0 ? totalCandidates : undefined,
      processedMessages: processed,
      succeededMessages: succeeded,
      failedMessages: failed,
      skippedMessages: 0,
      messageId,
      chatId,
      sessionId,
      messageIndex,
      attempt,
      elapsedMs: Date.now() - processingStartTime,
      messagePreview: messagePreview ?? null,
      // Phase transitions carry no live speed: generation ticks publish
      // their own values, and every other transition clears stale speed.
      tokensPerSecond: null,
      generatedTokens: null,
    });
  };

  /**
   * Terminal transition helper: persists the authoritative outcome split
   * absolutely (self-healing any missed incremental write), clears the
   * live phase snapshot, and publishes the terminal event with counts.
   */
  const finishJobTerminal = async (
    status: 'completed' | 'failed' | 'canceled',
    options: {
      errorMessage?: string | null;
      eventType: 'complete' | 'error' | 'status';
      message?: string;
    }
  ): Promise<void> => {
    const skipped = Math.max(0, totalCandidates - succeeded - failed);
    try {
      verificationRepository.updateJobStatus(jobId, status, {
        succeededMessages: succeeded,
        failedMessages: failed,
        skippedMessages: skipped,
        ...(options.errorMessage !== undefined
          ? { errorMessage: options.errorMessage }
          : {}),
      });
    } catch (statusError) {
      console.error(
        `[Verification Worker ${jobId}] Failed to persist terminal ${status} counters:`,
        statusError
      );
    }
    try {
      verificationRepository.clearJobPhase(jobId);
    } catch (phaseError) {
      console.warn(
        `[Verification Worker ${jobId}] Failed to clear terminal phase:`,
        phaseError
      );
    }
    await job.updateProgress(100);
    const fresh = (() => {
      try {
        return verificationRepository.findVerificationJobById(jobId);
      } catch {
        return null;
      }
    })();
    publishVerificationEvent(jobId, {
      type: options.eventType,
      status,
      ...(options.message !== undefined ? { message: options.message } : {}),
      totalMessages: totalCandidates,
      processedMessages: succeeded + failed,
      succeededMessages: succeeded,
      failedMessages: failed,
      skippedMessages: skipped,
      totalStatements: fresh?.total_statements ?? 0,
      flaggedStatements: fresh?.flagged_statements ?? 0,
      omissionsCount: fresh?.omissions_count ?? 0,
      elapsedMs: Date.now() - processingStartTime,
      tokensPerSecond: null,
      generatedTokens: null,
    });
  };

  /** Best-effort incremental outcome write; warns and continues on failure. */
  const tallyOutcome = (outcome: 'succeeded' | 'failed'): void => {
    if (outcome === 'succeeded') succeeded++;
    else failed++;
    try {
      verificationRepository.incrementJobCounters(
        jobId,
        outcome === 'succeeded'
          ? { succeededMessages: 1 }
          : { failedMessages: 1 }
      );
    } catch (counterError) {
      console.warn(
        `[Verification Worker ${jobId}] Failed to increment ${outcome} counter:`,
        counterError
      );
    }
  };

  const noteFirstFailure = (
    code: VerificationFailureCode,
    detail: string
  ): void => {
    if (!firstFailureHolder.current) {
      firstFailureHolder.current = { code, detail };
    }
  };

  try {
    let jobRecord = verificationRepository.findVerificationJobById(jobId);
    if (!jobRecord) throw new Error(`Job ${jobId} not found in database.`);
    if (jobRecord.status === 'canceled') {
      await finishJobTerminal('canceled', {
        eventType: 'status',
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

    // Reject impossible settings before loading a model: if the context
    // window cannot fit the system prompt plus the minimum viable budgets
    // even with an empty question/answer, no candidate could ever fit.
    const jobAllocation = allocateJudgeContextBudget({
      contextSize,
      systemPromptTokens: estimateTokens(judgeSystemPrompt),
      skeletonTokens: estimateTokens(buildJudgeUserMessage(null, '')),
    });
    if (!jobAllocation.feasible) {
      throw new Error(
        `Cannot start verification audit: ${jobAllocation.reason}`
      );
    }

    // --- LOAD MODEL ---
    // Evicting a previous model here to load the Judge is expected
    // (`loadLlmModelForWorker` unloads stale instances, like Session Chat's
    // load path). The Judge model itself is intentionally kept loaded when
    // the job finishes — there is no `finally` unload — so chat and the
    // next Fact Check reuse it via the adopted active settings below.
    if (jobRecord.model_name && jobRecord.model_name !== 'default') {
      publishPhase('loading_judge', { processed: 0 });
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
        // Adopt the Judge config as the global active settings while the
        // model is confirmed loaded: Session/Standalone chat and the next
        // Fact Check then start with these settings preset, and chat's
        // `ensureModelLoaded` reuses the warm model instead of evicting it
        // (including mid-audit). Best-effort: a settings write failure must
        // never fail the audit itself.
        try {
          appSettingsRepository.updateSettings(
            buildJudgeActiveSettingsUpdate(jobRecord, config.llm.baseURL)
          );
          console.log(
            `[Verification Worker ${jobId}] Adopted Judge model '${judgeModel}' as the active model settings.`
          );
        } catch (settingsError) {
          console.warn(
            `[Verification Worker ${jobId}] Failed to adopt Judge model as active settings (non-fatal):`,
            settingsError
          );
        }
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
          await finishJobTerminal('canceled', {
            eventType: 'status',
            message: 'Job canceled by user.',
          });
          return;
        }
        // finishJobTerminal publishes the terminal `failed` event; the
        // rethrow below only marks the BullMQ job failed (the outer catch
        // skips already-terminal rows, so no duplicate event is sent).
        await finishJobTerminal('failed', {
          eventType: 'error',
          errorMessage: `Failed to load model: ${loadError.message}`,
          message: `Failed to load model: ${loadError.message}`,
        });
        throw loadError;
      }
    }

    // The user may have canceled while the model was loading: re-read the
    // row so the `processing` transition below cannot overwrite `canceled`.
    jobRecord = verificationRepository.findVerificationJobById(jobId);
    if (!jobRecord || jobRecord.status === 'canceled') {
      await finishJobTerminal('canceled', {
        eventType: 'status',
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
      totalCandidates = candidates.length;
      if (!fresh || fresh.status === 'canceled') {
        await finishJobTerminal('canceled', {
          eventType: 'status',
          message: 'Job canceled by user.',
        });
      } else {
        console.warn(
          `[Verification Worker ${jobId}] Job became ${fresh.status} before processing started; leaving terminal state untouched.`
        );
        await job.updateProgress(100);
      }
      return;
    }
    totalCandidates = candidates.length;
    await job.updateProgress(2);
    publishVerificationEvent(jobId, {
      type: 'status',
      status: 'processing',
      message: `Auditing ${candidates.length} message(s), newest first.`,
      totalMessages: candidates.length,
      processedMessages: 0,
      succeededMessages: 0,
      failedMessages: 0,
      skippedMessages: 0,
    });

    if (candidates.length === 0) {
      // Zero-candidate run: a clean no-op, distinct from all-failed (which
      // has attempted assessments and lands on `failed`).
      await finishJobTerminal('completed', {
        eventType: 'complete',
        message: 'No messages needed verification.',
      });
      console.log(
        `[Verification Worker] Job ${jobId} completed (no candidates).`
      );
      return;
    }

    // Judge sampling temperature (low-variance default for verdicts).
    // Completion, thinking, and transcript budgets are allocated per message
    // below from the actual remaining context window.
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
        succeededMessages: succeeded,
        failedMessages: failed,
        skippedMessages: 0,
        totalStatements: fresh?.total_statements ?? 0,
        flaggedStatements: fresh?.flagged_statements ?? 0,
        omissionsCount: fresh?.omissions_count ?? 0,
        elapsedMs: Date.now() - processingStartTime,
        ...extra,
      });
    };

    for (
      let candidateIndex = 0;
      candidateIndex < candidates.length;
      candidateIndex++
    ) {
      const candidate = candidates[candidateIndex];
      jobRecord = verificationRepository.findVerificationJobById(jobId);
      if (!jobRecord || jobRecord.status === 'canceled') {
        await finishJobTerminal('canceled', {
          eventType: 'status',
          message: 'Job canceled by user.',
        });
        return;
      }

      const messageId = candidate.id;
      const chatId = candidate.chatId;
      const sessionId = candidate.sessionId;
      const authoredModel = candidate.model ?? null;
      const messageIndex = candidateIndex + 1;
      // Human-readable preview for phase text (visible answer preferred,
      // raw text when the visible part is empty). Empty previews fall back
      // to `message #<id>` in `describeVerificationPhase`.
      const candidatePreview =
        formatMessagePreview(
          extractVisibleAnswer(candidate.text ?? '').trim() ||
            candidate.text ||
            ''
        ) || null;

      // Per-message setup phase (fast-path checks, transcript load,
      // context budgeting) — published before any LLM work so a slow
      // run shows activity while `processed` legitimately stays flat.
      publishPhase('checking_message', {
        processed,
        messageId,
        chatId,
        sessionId,
        messageIndex,
        attempt: 1,
        messagePreview: candidatePreview,
      });

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
        if (!visibleAnswer) {
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            accuracyScore: 1.0,
            summaryAssessment: 'No verifiable content in AI response.',
            statements: [],
          });
          tallyOutcome('succeeded');
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
            tokensPerSecond: null,
            generatedTokens: null,
          });
          continue;
        }

        // Trivial conversational greeting: no factual claims possible, so
        // skip the Judge call entirely (zero tokens, instant clean row).
        // Runs before the transcript check: greetings carry no claims to
        // ground, so they keep this completed fast path even when the
        // session transcript is missing.
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
          tallyOutcome('succeeded');
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
            tokensPerSecond: null,
            generatedTokens: null,
          });
          continue;
        }

        // Missing ground truth: a substantive answer with no transcript
        // paragraphs cannot be judged. Record a FAILED row (never a
        // successful verification) so coverage ignores it and default
        // audits retry it once the transcript exists. No message_verified
        // event: only successful audits emit one.
        if (paragraphs.length === 0) {
          console.warn(
            `[Verification Worker ${jobId}] Skipping judge call for message ${messageId}: session ${sessionId} has no transcript paragraphs.`
          );
          const missingDetail =
            'Session transcript has no paragraphs; cannot verify substantive claims without ground truth.';
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            status: 'failed',
            errorMessage: buildMessageFailureMessage({
              code: 'missing_transcript',
              jobId,
              messageId,
              judgeModel,
              phase: 'checking_message',
              attempt: 1,
              attemptsTotal: 1,
              durationMs: 0,
              promptTokens: 0,
              completionTokens: 0,
              detail: missingDetail,
            }),
            errorCode: 'missing_transcript',
            promptTokens: 0,
            completionTokens: 0,
            durationMs: 0,
            statements: [],
          });
          noteFirstFailure('missing_transcript', missingDetail);
          tallyOutcome('failed');
          processed++;
          await job.updateProgress(
            Math.round((processed / candidates.length) * 100)
          );
          publishProgress();
          continue;
        }

        // Context budgeting: allocate completion and transcript budgets
        // from the actual remaining window so the Judge call never overflows
        // it. When the fixed prompt/answer cannot fit, record a failed
        // assessment instead of sending a request known to overflow.
        const userQuestion = candidate.userQuestion ?? null;
        const judgeUserSkeleton = buildJudgeUserMessage(
          userQuestion,
          visibleAnswer
        );
        const allocation = allocateJudgeContextBudget({
          contextSize,
          systemPromptTokens: estimateTokens(judgeSystemPrompt),
          skeletonTokens: estimateTokens(judgeUserSkeleton),
        });
        if (!allocation.feasible) {
          console.warn(
            `[Verification Worker ${jobId}] Skipping judge call for message ${messageId}: ${allocation.reason}`
          );
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            status: 'failed',
            errorMessage: buildMessageFailureMessage({
              code: 'context_budget',
              jobId,
              messageId,
              judgeModel,
              phase: 'checking_message',
              attempt: 1,
              attemptsTotal: 1,
              durationMs: 0,
              promptTokens: 0,
              completionTokens: 0,
              detail: allocation.reason,
            }),
            errorCode: 'context_budget',
            promptTokens: 0,
            completionTokens: 0,
            durationMs: 0,
            statements: [],
          });
          noteFirstFailure('context_budget', allocation.reason);
          tallyOutcome('failed');
          processed++;
          await job.updateProgress(
            Math.round((processed / candidates.length) * 100)
          );
          publishProgress();
          continue;
        }
        const transcriptBudget = allocation.transcriptTokens;
        // Straight passthrough (Session Chat parity): unset means `-1`
        // (unrestricted). Thinking is never clamped or disabled by the
        // worker — not even on retry.
        const effectiveThinkingBudget = resolveJudgeThinkingBudget(
          jobRecord.thinking_budget
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
        // Completion gets the full remaining window after the actual prompt
        // (measured post-selection), never an artificial percentage cap.
        const maxCompletionTokens = resolveJudgeCompletionBudget({
          contextSize,
          overheadTokens: allocation.overheadTokens,
          transcriptTokens: estimateTokens(transcriptContext.text),
        });

        // Session Chat layout: transcript in the system prefix (stable,
        // KV-cache-friendly), question + answer in a focused user turn.
        const judgeMessages = prepareLlmChatMessages([
          {
            id: 0,
            chatId: 0,
            sender: 'system',
            text: buildJudgeSystemPrompt(
              judgeSystemPrompt,
              transcriptContext.text
            ),
            timestamp: Date.now(),
          },
          {
            id: 1,
            chatId: 0,
            sender: 'user',
            text: buildJudgeUserMessage(userQuestion, visibleAnswer),
            timestamp: Date.now(),
          },
        ]);

        const isCanceled = (): boolean => {
          const fresh = verificationRepository.findVerificationJobById(jobId);
          return !fresh || fresh.status === 'canceled';
        };
        const finishCanceled = async (): Promise<void> => {
          await finishJobTerminal('canceled', {
            eventType: 'status',
            message: 'Job canceled by user.',
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

        // First Judge attempt (attempt 1 of 2): thinking enabled per the
        // job budget. Unclassified stream errors become `provider_error` in
        // the catch below; classified JSON failures throw coded errors.
        publishPhase('generating', {
          processed,
          messageId,
          chatId,
          sessionId,
          messageIndex,
          attempt: 1,
          messagePreview: candidatePreview,
        });
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
          streamTelemetry: {
            phase: 'generating',
            chatId,
            sessionId,
            messageIndex,
            attempt: 1,
            totalMessages: candidates.length,
            processedMessages: processed,
            succeededMessages: succeeded,
            failedMessages: failed,
            jobStartTime: processingStartTime,
            messagePreview: candidatePreview,
          },
        });
        recordAttemptUsage(firstAttempt.streamResult, firstAttempt.durationMs);

        if (firstAttempt.canceled) {
          await finishCanceled();
          return;
        }

        let parsed = parseJudgeJson<RawJudgeOutput>(firstAttempt.rawOutput);
        let structure = validateJudgeOutputStructure(parsed);
        let usedRetry = false;
        let lastRawOutput = firstAttempt.rawOutput;
        // Completion accounting for runaway detection: a first attempt that
        // filled the completion cap (or emitted a huge volume of unparseable
        // output) gets a compact retry under a fail-fast cap instead of the
        // identical giant call. Parsed-but-invalid output is complete JSON,
        // so the schema reminder path below never counts as a runaway.
        const firstCompletionTokens =
          firstAttempt.streamResult.completionTokens ?? null;
        const firstRunaway = !parsed
          ? detectJudgeRunaway(firstCompletionTokens, maxCompletionTokens)
          : { runaway: false, hitCap: false };
        let lastCompletionTokens: number | null = firstCompletionTokens;
        let lastMaxCompletionTokens = maxCompletionTokens;
        if ((!parsed || !structure.valid) && !isCanceled()) {
          // One repair retry with low-variance sampling and a brief-thinking
          // reminder. Thinking stays at the job's configured budget:
          // disabling it breaks reasoning models that must think before
          // emitting JSON. Parsed-but-invalid output gets a schema-shaped
          // reminder instead; runaway output gets a compact-verdict reminder
          // under a fail-fast completion cap.
          const compactRetry = !parsed && firstRunaway.runaway;
          const retryMaxCompletionTokens = compactRetry
            ? resolveJudgeRetryCompletionBudget(maxCompletionTokens)
            : maxCompletionTokens;
          console.warn(
            `[Verification Worker ${jobId}] Judge output for message ${messageId} ` +
              (parsed
                ? `failed structural validation (${structure.reason}); retrying once.`
                : compactRetry
                  ? `ran away (${firstCompletionTokens ?? 0} completion tokens); retrying once with a compact-verdict reminder.`
                  : `failed JSON parsing; retrying once.`)
          );
          publishPhase('retrying', {
            processed,
            messageId,
            chatId,
            sessionId,
            messageIndex,
            attempt: 2,
            messagePreview: candidatePreview,
          });
          const retryMessages = prepareLlmChatMessages([
            judgeMessages[0],
            {
              ...judgeMessages[1],
              text: `${judgeMessages[1].text}${
                parsed
                  ? JUDGE_RETRY_SCHEMA_REMINDER
                  : compactRetry
                    ? JUDGE_RETRY_COMPACT_REMINDER
                    : JUDGE_RETRY_REMINDER
              }`,
            },
          ]);
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
            thinkingBudget: effectiveThinkingBudget,
            maxCompletionTokens: retryMaxCompletionTokens,
            isCanceled,
            streamTelemetry: {
              phase: 'retrying',
              chatId,
              sessionId,
              messageIndex,
              attempt: 2,
              totalMessages: candidates.length,
              processedMessages: processed,
              succeededMessages: succeeded,
              failedMessages: failed,
              jobStartTime: processingStartTime,
              messagePreview: candidatePreview,
            },
          });
          recordAttemptUsage(
            retryAttempt.streamResult,
            retryAttempt.durationMs
          );

          if (retryAttempt.canceled) {
            await finishCanceled();
            return;
          }
          usedRetry = true;
          lastRawOutput = retryAttempt.rawOutput;
          lastCompletionTokens =
            retryAttempt.streamResult.completionTokens ?? null;
          lastMaxCompletionTokens = retryMaxCompletionTokens;
          parsed = parseJudgeJson<RawJudgeOutput>(retryAttempt.rawOutput);
          structure = validateJudgeOutputStructure(parsed);
        }
        if (!parsed) {
          // Empty visible output (thinking-only / blank), cap truncation,
          // and malformed JSON are distinct debuggable failures; all
          // exhausted the retries.
          const visibleContent = extractVisibleAnswer(lastRawOutput).trim();
          const lastHitCap = detectJudgeRunaway(
            lastCompletionTokens,
            lastMaxCompletionTokens
          ).hitCap;
          const code: VerificationFailureCode =
            visibleContent.length === 0
              ? 'empty_output'
              : lastHitCap
                ? 'truncated_output'
                : 'malformed_json';
          const detail =
            code === 'empty_output'
              ? 'Judge LLM returned no visible output (empty or thinking-only response).'
              : code === 'truncated_output'
                ? `Judge LLM output hit the completion cap (${lastCompletionTokens ?? 0} of ${lastMaxCompletionTokens} max tokens) and truncated mid-JSON; the verdict was cut off.`
                : 'Judge LLM did not return valid JSON (unparseable output).';
          throw new CodedVerificationError(
            code,
            buildMessageFailureMessage({
              code,
              jobId,
              messageId,
              judgeModel,
              phase: usedRetry ? 'retrying' : 'generating',
              attempt: usedRetry ? 2 : 1,
              attemptsTotal: 2,
              durationMs: accDurationMs,
              promptTokens: accPromptTokens,
              completionTokens: accCompletionTokens,
              detail: usedRetry
                ? `${detail} Retries exhausted (1 retry).`
                : detail,
            })
          );
        }
        if (!structure.valid) {
          const detail =
            `Judge LLM returned structurally invalid JSON (${structure.reason}); ` +
            'cannot audit reliably.';
          throw new CodedVerificationError(
            'invalid_structure',
            buildMessageFailureMessage({
              code: 'invalid_structure',
              jobId,
              messageId,
              judgeModel,
              phase: usedRetry ? 'retrying' : 'generating',
              attempt: usedRetry ? 2 : 1,
              attemptsTotal: 2,
              durationMs: accDurationMs,
              promptTokens: accPromptTokens,
              completionTokens: accCompletionTokens,
              detail: usedRetry
                ? `${detail} Retries exhausted (1 retry).`
                : detail,
            })
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

        tallyOutcome('succeeded');
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
          tokensPerSecond: null,
          generatedTokens: null,
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
        // Classified Judge failures throw CodedVerificationError with a
        // pre-built message; anything else (provider/transport errors from
        // the stream, unexpected bugs) becomes `provider_error` with the
        // bounded raw detail. Either way the failed row carries job/message
        // IDs, the Judge model, attempt, duration, and token usage.
        const codedMessage =
          messageError instanceof CodedVerificationError
            ? messageError.message
            : null;
        const code: VerificationFailureCode =
          readVerificationFailureCode(messageError) ?? 'provider_error';
        const rawDetail =
          messageError?.message ?? String(messageError ?? 'unknown error');
        const failureMessage =
          codedMessage ??
          buildMessageFailureMessage({
            code,
            jobId,
            messageId,
            judgeModel,
            phase: 'generating',
            attempt: 1,
            attemptsTotal: 2,
            durationMs: accDurationMs,
            promptTokens: accPromptTokens,
            completionTokens: accCompletionTokens,
            detail:
              code === 'provider_error'
                ? `Judge provider request failed: ${rawDetail}`
                : rawDetail,
          });
        noteFirstFailure(code, rawDetail);
        let failurePersisted = false;
        try {
          verificationRepository.saveMessageVerificationResult({
            messageId,
            chatId,
            sessionId,
            verificationJobId: jobId,
            authoredModel,
            judgeModel,
            status: 'failed',
            errorMessage: failureMessage,
            errorCode: code,
            promptTokens: accPromptTokens,
            completionTokens: accCompletionTokens,
            durationMs: accDurationMs,
            statements: [],
          });
          failurePersisted = true;
        } catch (persistError) {
          console.error(
            `[Verification Worker ${jobId}] Failed to persist failure for message ${messageId}:`,
            persistError
          );
        }
        // The failed-row save already bumps `processed_messages`; only when
        // that save itself threw must the counters be repaired manually.
        // Either way the failure counts toward `failed`, never `succeeded`.
        failed++;
        try {
          verificationRepository.incrementJobCounters(
            jobId,
            failurePersisted
              ? { failedMessages: 1 }
              : { processedMessages: 1, failedMessages: 1 }
          );
        } catch (counterError) {
          console.warn(
            `[Verification Worker ${jobId}] Failed to increment failure counters for message ${messageId}:`,
            counterError
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
      await finishJobTerminal('canceled', {
        eventType: 'status',
        message: 'Job canceled by user.',
      });
      return;
    }

    publishPhase('finishing', { processed });
    // Terminal outcome from the finished-attempt split — never unqualified
    // success when failures happened:
    // - every attempted assessment failed -> `failed` with an error summary;
    // - mixed run -> `completed` with "Completed with errors" summary and
    //   counts (UI renders the mixed label from `failed_messages > 0`);
    // - clean run -> `completed` with no error summary.
    if (failed > 0 && succeeded === 0) {
      const summary = buildJobFailureSummary({
        jobId,
        judgeModel,
        succeeded,
        failed,
        total: candidates.length,
        firstFailureCode: firstFailureHolder.current?.code ?? null,
        firstFailureDetail: firstFailureHolder.current?.detail ?? null,
      });
      await finishJobTerminal('failed', {
        eventType: 'error',
        errorMessage: summary,
        message: summary,
      });
      console.error(
        `[Verification Worker] Job ${jobId} failed: ${succeeded} succeeded, ${failed} failed.`
      );
    } else if (failed > 0) {
      const summary = buildJobFailureSummary({
        jobId,
        judgeModel,
        succeeded,
        failed,
        total: candidates.length,
        firstFailureCode: firstFailureHolder.current?.code ?? null,
        firstFailureDetail: firstFailureHolder.current?.detail ?? null,
      });
      await finishJobTerminal('completed', {
        eventType: 'complete',
        errorMessage: summary,
        message: summary,
      });
      console.warn(
        `[Verification Worker] Job ${jobId} completed with errors: ${succeeded} succeeded, ${failed} failed.`
      );
    } else {
      await finishJobTerminal('completed', { eventType: 'complete' });
      console.log(
        `[Verification Worker] Job ${jobId} completed successfully (${succeeded}/${candidates.length} checked).`
      );
    }
  } catch (error: any) {
    console.error(`[Verification Worker] FAILED job ${jobId}:`, error);
    try {
      const jobRecord = verificationRepository.findVerificationJobById(jobId);
      if (
        jobRecord &&
        jobRecord.status !== 'canceled' &&
        jobRecord.status !== 'completed' &&
        jobRecord.status !== 'failed'
      ) {
        // Unexpected failure before (or outside) the per-message loop:
        // persist the partial outcome split so the terminal row stays
        // consistent with the incremental counters.
        const skipped = Math.max(0, totalCandidates - succeeded - failed);
        verificationRepository.updateJobStatus(jobId, 'failed', {
          errorMessage: error?.message ?? String(error),
          succeededMessages: succeeded,
          failedMessages: failed,
          skippedMessages: skipped,
        });
        try {
          verificationRepository.clearJobPhase(jobId);
        } catch {
          // Best-effort; the failed status above is the durable record.
        }
        publishVerificationEvent(jobId, {
          type: 'error',
          status: 'failed',
          message: error?.message ?? String(error),
          totalMessages: totalCandidates,
          processedMessages: succeeded + failed,
          succeededMessages: succeeded,
          failedMessages: failed,
          skippedMessages: skipped,
          elapsedMs: Date.now() - processingStartTime,
          tokensPerSecond: null,
          generatedTokens: null,
        });
      } else if (jobRecord) {
        // Already terminal (a `finishJobTerminal` path published the
        // terminal event before rethrowing, or the job was canceled):
        // never overwrite the outcome or emit a duplicate event.
        console.log(
          `[Verification Worker] Job ${jobId} already terminal (${jobRecord.status}); leaving outcome untouched.`
        );
      }
    } catch (statusError) {
      console.error(
        `[Verification Worker] Failed to mark job ${jobId} as failed:`,
        statusError
      );
    }
    throw error;
  }
  // NOTE: no `finally` unload — the Judge model intentionally stays loaded
  // with its context when the job finishes (completed, failed, or canceled),
  // and the global active settings adopted above keep pointing at it, so
  // chat and the next Fact Check reuse the warm model with settings preset.
  // Only worker shutdown (loadedModelsTracker) or an explicit unload evicts
  // it; starting another job with a different model evicts it at load time.
}

/**
 * BullMQ processor entry: serialized against analysis jobs via the shared
 * LLM worker mutex so the two queues never load/unload models concurrently.
 *
 * When the lock is actually contended (not acquired within
 * `VERIFICATION_LOCK_WAIT_PUBLISH_MS`), a `waiting_for_lock` phase is
 * published so the banner explains the stall truthfully instead of
 * sitting on `pending` with no activity.
 */
export default async function (job: Job<VerificationJobData, any, string>) {
  const pendingJobId = (job.data as VerificationJobData | undefined)?.jobId;
  let lockAcquired = false;
  const waitTimer =
    typeof pendingJobId === 'number' && Number.isInteger(pendingJobId)
      ? setTimeout(() => {
          if (lockAcquired) return;
          try {
            verificationRepository.updateJobPhase(pendingJobId, {
              currentPhase: 'waiting_for_lock',
            });
          } catch {
            // Best-effort; the event below is the primary signal.
          }
          publishVerificationEvent(pendingJobId, {
            type: 'phase',
            phase: 'waiting_for_lock',
            message: describeVerificationPhase({ phase: 'waiting_for_lock' }),
            processedMessages: 0,
            succeededMessages: 0,
            failedMessages: 0,
            skippedMessages: 0,
          });
        }, VERIFICATION_LOCK_WAIT_PUBLISH_MS)
      : null;
  try {
    return await runWithLlmWorkerLock(async () => {
      // The lock is held from here: a long audit must not publish
      // `waiting_for_lock` mid-run when the timer fires.
      lockAcquired = true;
      if (waitTimer) clearTimeout(waitTimer);
      return processVerificationJob(job);
    });
  } finally {
    lockAcquired = true;
    if (waitTimer) clearTimeout(waitTimer);
  }
}
