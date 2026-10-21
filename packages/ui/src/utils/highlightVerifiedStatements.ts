// packages/ui/src/utils/highlightVerifiedStatements.ts
//
// Inline highlighting of Judge-verified statements inside session chat
// notes. Two rendering paths share the same span-resolution logic:
//
// - Plain-text mode: `splitTextByStatementSpans` slices the visible text
//   into plain/highlighted segments for direct <mark> rendering.
// - Markdown mode: `rehypeHighlightStatements` is a zero-dependency
//   rehype plugin for ReactMarkdown. Each top-level block subtree is
//   concatenated into a virtual plain-text string (excluding <pre>),
//   statements resolve against that string, and matches fan back out
//   across the intersecting HAST text nodes — so quotes spanning inline
//   <code>/<strong>/<em> tags still highlight.
//
// Normalization mirrors the worker's span rules
// (`packages/worker/src/jobs/verificationProcessor.ts`): outer quotes and
// ellipses are stripped from Judge quotes, inline Markdown tokens are
// dropped, quote/dash variants collapse, and matching is case-insensitive
// with mid-quote `...` clause and prefix+suffix anchor fallbacks.
//
// The worker persists `start_char`/`end_char` relative to its own
// think-stripped text (`extractVisibleAnswer(...).trim()`), which can
// differ slightly from the bubble's display text. Spans are therefore
// validated against `exact_quote` (normalized equality or anchor match)
// and fall back to a quote search when they don't line up.

import type { CSSProperties } from 'react';
import type { Element, Root, Text } from 'hast';
import type {
  StatementVerdict,
  TranscriptEvidenceItem,
  VerifiedStatement,
} from '../api/verification';

export type HighlightableStatement = Pick<
  VerifiedStatement,
  'id' | 'exact_quote' | 'start_char' | 'end_char' | 'verdict'
>;

export interface ResolvedSpan {
  statementId: number;
  start: number;
  end: number;
  verdict: StatementVerdict;
}

export interface TextSegment {
  text: string;
  statementId: number | null;
  verdict: StatementVerdict | null;
}

/** Class applied to every verification <mark> (styling in global.css). */
export const VERIFIED_MARK_CLASS = 'verified-statement-mark';

// --- normalization (mirrors the worker's span rules) -------------------------

const MARKDOWN_STRIP_CHARS = new Set(['*', '_', '`', '~']);

/** Single/double/curly quote variants, all normalized to `'`. */
const QUOTE_NORMALIZE_CHARS = new Set(['"', "'", '“', '”', '‘', '’']);

/** Typographic dashes, normalized to `-`. */
const DASH_NORMALIZE_CHARS = new Set(['–', '—']);

export interface NormalizedMatchText {
  norm: string;
  /** norm[i] was produced from input[map[i]]. */
  map: number[];
}

/**
 * Lowercase + collapse whitespace runs / strip inline Markdown chars while
 * keeping an index map back to the source string. Quote variants collapse
 * to `'` and typographic dashes to `-` (1-to-1, map-preserving); inline
 * Markdown tokens are dropped. Leading/trailing whitespace is trimmed.
 */
export function normalizeForMatchWithMap(input: string): NormalizedMatchText {
  let norm = '';
  const map: number[] = [];
  let pendingSpace = true; // trim leading whitespace
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (MARKDOWN_STRIP_CHARS.has(ch)) continue;
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && norm.length > 0) {
      norm += ' ';
      map.push(i);
    }
    pendingSpace = false;
    let out = ch;
    if (QUOTE_NORMALIZE_CHARS.has(ch)) out = "'";
    else if (DASH_NORMALIZE_CHARS.has(ch)) out = '-';
    norm += out.toLowerCase();
    map.push(i);
  }
  if (norm.endsWith(' ')) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

/** Matching outer quotation-mark pairs the Judge LLM tends to add. */
const OUTER_QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
};

const LEADING_ELLIPSIS_RE = /^(?:\.{2,}|…+)\s*/;
const TRAILING_ELLIPSIS_RE = /\s*(?:\.{2,}|…+)$/;
const MID_QUOTE_ELLIPSIS_RE = /(?:\.{3,}|…+)/;

/**
 * Clean a Judge-supplied `exact_quote` before matching: trim, strip
 * matching outer quotation marks (`"..."`, `'...'`, `"..."`, `'...'`) and
 * strip leading/trailing ellipses (`...`, `…`). Handles either order
 * (`"...text..."` and `..."text"...`).
 */
export function cleanQuoteForMatch(quote: string): string {
  let cleaned = quote.trim();
  for (let pass = 0; pass < 2; pass++) {
    cleaned = cleaned
      .replace(LEADING_ELLIPSIS_RE, '')
      .replace(TRAILING_ELLIPSIS_RE, '')
      .trim();
    if (cleaned.length >= 2) {
      const first = cleaned[0]!;
      const last = cleaned[cleaned.length - 1]!;
      if (OUTER_QUOTE_PAIRS[first] === last) {
        cleaned = cleaned.slice(1, -1).trim();
      }
    }
  }
  return cleaned;
}

/**
 * Normalize a value for comparison: case-insensitive, Markdown-insensitive,
 * quote/dash-insensitive, whitespace-collapsed. Prefer
 * `normalizeForMatchWithMap` when source offsets are needed.
 */
export function normalizeForMatch(value: string): string {
  return normalizeForMatchWithMap(value).norm;
}

// --- span resolution ----------------------------------------------------------

const ANCHOR_LEN = 35;
const MIN_ANCHOR_QUOTE_LEN = 40;
const ANCHOR_WINDOW_SLACK = 80;

/** Minimum trimmed length for an ellipsis-separated clause to be usable. */
const MIN_SUBSTANTIVE_CLAUSE_LEN = 12;
/** Max normalized-char gap between spliced clauses to span them as one. */
const MAX_CLAUSE_SPAN_GAP = 80;

function rangesOverlap(
  aStart: number,
  aEnd: number,
  ranges: Array<readonly [number, number]>
): boolean {
  return ranges.some(([s, e]) => aStart < e && s < aEnd);
}

/** All occurrences of `needle` in `haystack`. */
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

/** Map a normalized [start, end) range back to source coordinates. */
function toRawSpan(
  idx: NormalizedMatchText,
  normStart: number,
  normEnd: number
): [number, number] | null {
  const s = idx.map[normStart];
  const e = idx.map[normEnd - 1];
  if (s === undefined || e === undefined) return null;
  return [s, e + 1];
}

/**
 * Does a worker-persisted slice match the Judge quote? Accepts normalized
 * equality, containment (worker spans resolved case-insensitively or with
 * Markdown stripped), and a prefix+suffix anchor match (worker Pass 3
 * anchor spans carrying slack over a skipped middle clause).
 */
function workerSliceMatchesQuote(
  sliceNorm: string,
  quoteNorm: string
): boolean {
  if (!sliceNorm || !quoteNorm) return false;
  if (sliceNorm === quoteNorm) return true;
  if (quoteNorm.includes(sliceNorm) || sliceNorm.includes(quoteNorm)) {
    return true;
  }
  // Anchor match: head + tail anchors of the quote at the slice edges.
  if (quoteNorm.length >= MIN_SUBSTANTIVE_CLAUSE_LEN) {
    const len = Math.min(ANCHOR_LEN, Math.floor(quoteNorm.length / 2));
    if (len > 0) {
      const head = quoteNorm.slice(0, len);
      const tail = quoteNorm.slice(-len);
      if (sliceNorm.startsWith(head) && sliceNorm.endsWith(tail)) {
        return true;
      }
    }
  }
  return false;
}

/** Normalized full-quote search: first non-overlapping occurrence. */
function findNormalizedSpan(
  idx: NormalizedMatchText,
  quoteNorm: string,
  used: Array<[number, number]>
): [number, number] | null {
  for (const hit of findAllOccurrences(idx.norm, quoteNorm)) {
    const span = toRawSpan(idx, hit, hit + quoteNorm.length);
    if (span && !rangesOverlap(span[0], span[1], used)) return span;
  }
  return null;
}

interface MatchedClause {
  /** Start/end offsets in normalized-text coordinates. */
  normStart: number;
  normEnd: number;
  normLength: number;
}

/** Longest free matching clause (ties resolve to the earliest clause). */
function longestMatchedClauseSpan(
  idx: NormalizedMatchText,
  matched: Array<MatchedClause | null>,
  used: Array<[number, number]>
): [number, number] | null {
  let best: MatchedClause | null = null;
  for (const m of matched) {
    if (!m) continue;
    if (!best || m.normLength > best.normLength) best = m;
  }
  if (!best) return null;
  const span = toRawSpan(idx, best.normStart, best.normEnd);
  if (span && !rangesOverlap(span[0], span[1], used)) return span;
  return null;
}

/**
 * Resolve a quote containing mid-quote `...`/`…`: split into substantive
 * clauses (>= 12 chars), anchor on the first matching clause, and span
 * forward while each subsequent clause appears within
 * `MAX_CLAUSE_SPAN_GAP` chars; otherwise return the longest matching
 * clause so the span never swallows unrelated intermediate sentences.
 */
function findEllipsisClauseSpan(
  idx: NormalizedMatchText,
  cleanedQuote: string,
  used: Array<[number, number]>
): [number, number] | null {
  if (!MID_QUOTE_ELLIPSIS_RE.test(cleanedQuote)) return null;
  const clauses = cleanedQuote
    .split(MID_QUOTE_ELLIPSIS_RE)
    .map((c) => c.trim())
    .filter((c) => c.length >= MIN_SUBSTANTIVE_CLAUSE_LEN);
  if (clauses.length === 0) return null;

  // First free occurrence of each substantive clause, in quote order.
  const matched: Array<MatchedClause | null> = clauses.map((clause) => {
    const clauseNorm = normalizeForMatchWithMap(clause).norm;
    if (!clauseNorm) return null;
    for (const hit of findAllOccurrences(idx.norm, clauseNorm)) {
      const span = toRawSpan(idx, hit, hit + clauseNorm.length);
      if (span && !rangesOverlap(span[0], span[1], used)) {
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
    return longestMatchedClauseSpan(idx, matched, used);
  }

  // Extend across subsequent clauses while each lands within one
  // sentence/clause window of the current span end.
  let spanEnd = first.normEnd;
  let extended = false;
  for (let i = 1; i < clauses.length; i++) {
    const clauseNorm = normalizeForMatchWithMap(clauses[i]!).norm;
    if (!clauseNorm) break;
    let chained: MatchedClause | null = null;
    for (const hit of findAllOccurrences(idx.norm, clauseNorm)) {
      if (hit < spanEnd) continue;
      if (hit - spanEnd > MAX_CLAUSE_SPAN_GAP) break;
      const span = toRawSpan(idx, hit, hit + clauseNorm.length);
      if (span && !rangesOverlap(span[0], span[1], used)) {
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
    const span = toRawSpan(idx, first.normStart, spanEnd);
    if (span && !rangesOverlap(span[0], span[1], used)) return span;
  }
  return (
    longestMatchedClauseSpan(idx, matched, used) ??
    (() => {
      const anchor = toRawSpan(idx, first.normStart, first.normEnd);
      return anchor && !rangesOverlap(anchor[0], anchor[1], used)
        ? anchor
        : null;
    })()
  );
}

/**
 * Prefix+suffix anchor fallback for long, slightly truncated quotes: the
 * first and last 35 normalized chars must both match within a bounded
 * window.
 */
function findAnchorSpan(
  idx: NormalizedMatchText,
  quoteNorm: string,
  used: Array<[number, number]>
): [number, number] | null {
  if (quoteNorm.length < MIN_ANCHOR_QUOTE_LEN) return null;
  const head = quoteNorm.slice(0, ANCHOR_LEN);
  const tail = quoteNorm.slice(-ANCHOR_LEN);
  const windowLen = quoteNorm.length + ANCHOR_WINDOW_SLACK;
  for (const headIdx of findAllOccurrences(idx.norm, head)) {
    const tailIdx = idx.norm.indexOf(tail, headIdx + head.length);
    if (tailIdx === -1 || tailIdx - headIdx > windowLen) continue;
    const span = toRawSpan(idx, headIdx, tailIdx + tail.length);
    if (span && !rangesOverlap(span[0], span[1], used)) return span;
  }
  return null;
}

export interface ResolveSpansOptions {
  /**
   * Trust worker-persisted `start_char`/`end_char` when the slice matches
   * the quote. Disable when resolving against derived text (e.g. HAST
   * virtual text) whose offsets don't correspond to worker coordinates.
   */
  trustWorkerSpans?: boolean;
}

/**
 * Resolve each statement to a non-overlapping raw-text span. Prefers the
 * worker-persisted span when its slice matches the quote (normalized
 * equality or prefix/suffix anchor match); otherwise searches for the
 * quote (normalized full match, mid-quote `...` clause fallback, then
 * prefix+suffix anchor fallback). Returns spans sorted by start offset.
 */
export function resolveStatementSpans(
  text: string,
  statements: HighlightableStatement[],
  options: ResolveSpansOptions = {}
): ResolvedSpan[] {
  const { trustWorkerSpans = true } = options;
  const idx = normalizeForMatchWithMap(text);
  const used: Array<[number, number]> = [];
  const resolved: ResolvedSpan[] = [];

  for (const stmt of statements) {
    const cleaned = cleanQuoteForMatch(stmt.exact_quote ?? '');
    if (!cleaned) continue;
    const quoteNorm = normalizeForMatchWithMap(cleaned).norm;
    if (!quoteNorm || !idx.norm) continue;

    // Pass 1: trust the worker span when valid, free, and matching.
    if (trustWorkerSpans) {
      const { start_char: sc, end_char: ec } = stmt;
      if (
        typeof sc === 'number' &&
        typeof ec === 'number' &&
        Number.isInteger(sc) &&
        Number.isInteger(ec) &&
        sc >= 0 &&
        ec > sc &&
        ec <= text.length &&
        !rangesOverlap(sc, ec, used)
      ) {
        const sliceNorm = normalizeForMatchWithMap(text.slice(sc, ec)).norm;
        if (workerSliceMatchesQuote(sliceNorm, quoteNorm)) {
          used.push([sc, ec]);
          resolved.push({
            statementId: stmt.id,
            start: sc,
            end: ec,
            verdict: stmt.verdict,
          });
          continue;
        }
      }
    }

    // Pass 2: normalized full-quote search, then mid-quote `...` clause
    // fallback, then prefix+suffix anchor fallback.
    const span =
      findNormalizedSpan(idx, quoteNorm, used) ??
      findEllipsisClauseSpan(idx, cleaned, used) ??
      findAnchorSpan(idx, quoteNorm, used);
    if (!span) continue;
    used.push(span);
    resolved.push({
      statementId: stmt.id,
      start: span[0],
      end: span[1],
      verdict: stmt.verdict,
    });
  }

  resolved.sort((a, b) => a.start - b.start);
  return resolved;
}

/** Slice `text` into plain/highlighted segments for plain-text rendering. */
export function splitTextByStatementSpans(
  text: string,
  statements: HighlightableStatement[]
): TextSegment[] {
  if (!text) return [];
  const spans = resolveStatementSpans(text, statements);
  if (spans.length === 0) {
    return [{ text, statementId: null, verdict: null }];
  }
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      segments.push({
        text: text.slice(cursor, span.start),
        statementId: null,
        verdict: null,
      });
    }
    segments.push({
      text: text.slice(span.start, span.end),
      statementId: span.statementId,
      verdict: span.verdict,
    });
    cursor = span.end;
  }
  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      statementId: null,
      verdict: null,
    });
  }
  return segments;
}

// --- rehype plugin -----------------------------------------------------------

interface CollectedTextNode {
  node: Text;
  parent: Element | Root;
  /** [start, end) offsets within the block's virtual plain text. */
  start: number;
  end: number;
}

interface PendingTextNode {
  node: Text;
  parent: Element | Root;
  breakBefore: boolean;
}

function isTextNode(node: unknown): node is Text {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'text'
  );
}

function isElementNode(node: unknown): node is Element {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'element'
  );
}

/** Elements whose subtree is never highlighted (code blocks, metadata). */
const SKIPPED_TAGS = new Set(['pre', 'script', 'style']);

/**
 * Tags that start a new virtual line so matches can't bleed across list
 * items or nested blocks inside one top-level block subtree.
 */
const BLOCK_TAGS = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'aside',
  'nav',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'hr',
]);

function isVerifiedMark(node: Element): boolean {
  if (node.tagName !== 'mark') return false;
  const className = (node.properties as { className?: unknown } | undefined)
    ?.className;
  return (
    Array.isArray(className) &&
    (className as unknown[]).includes(VERIFIED_MARK_CLASS)
  );
}

/**
 * Collect text nodes in document order, descending into inline elements
 * (`code`, `strong`, `em`, links, ...) but skipping `<pre>` subtrees and
 * existing verification marks. The first text node inside a nested block
 * element is flagged so a virtual line break is inserted before it.
 */
function collectBlockTextNodes(
  parent: Element | Root,
  out: PendingTextNode[]
): void {
  for (const child of parent.children ?? []) {
    if (isTextNode(child)) {
      if (child.value) {
        out.push({ node: child, parent, breakBefore: false });
      }
    } else if (isElementNode(child)) {
      // Skip code blocks/metadata and never double-wrap existing marks
      // (defensive: trees are fresh per render).
      if (SKIPPED_TAGS.has(child.tagName) || isVerifiedMark(child)) {
        continue;
      }
      const mark = out.length;
      collectBlockTextNodes(child, out);
      if (BLOCK_TAGS.has(child.tagName)) {
        const first = out[mark];
        if (first) first.breakBefore = true;
      }
    }
  }
}

function makeMarkElement(
  statementId: number,
  verdict: StatementVerdict,
  value: string
): Element {
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      dataStatementId: String(statementId),
      dataVerdict: verdict,
      className: [VERIFIED_MARK_CLASS],
    },
    children: [{ type: 'text', value }],
  };
}

interface NodeEdit {
  collected: CollectedTextNode;
  /** Non-overlapping [start, end) ranges in node-local coordinates. */
  ranges: Array<{
    start: number;
    end: number;
    statementId: number;
    verdict: StatementVerdict;
  }>;
}

/** Split text nodes and wrap matched slices in <mark> elements. */
function applyNodeEdits(edits: Map<Text, NodeEdit>): void {
  for (const edit of edits.values()) {
    const { collected: c, ranges } = edit;
    ranges.sort((a, b) => a.start - b.start);
    const value = c.node.value;
    const replacement: Array<Text | Element> = [];
    let cursor = 0;
    for (const r of ranges) {
      if (r.start < cursor) continue; // overlapping match — keep first
      if (r.start > cursor) {
        replacement.push({
          type: 'text',
          value: value.slice(cursor, r.start),
        });
      }
      replacement.push(
        makeMarkElement(r.statementId, r.verdict, value.slice(r.start, r.end))
      );
      cursor = r.end;
    }
    if (cursor < value.length) {
      replacement.push({ type: 'text', value: value.slice(cursor) });
    }
    const siblings = c.parent.children as Array<Text | Element | unknown>;
    const idx = siblings.indexOf(c.node);
    if (idx >= 0) {
      siblings.splice(idx, 1, ...replacement);
    }
  }
}

/** Single-argument HAST transformer (pass to ReactMarkdown wrapped as a plugin). */
export type RehypeHighlightTransformer = (tree: Root) => void;

/**
 * rehype plugin factory: wraps each statement's `exact_quote` occurrence
 * in `<mark class="verified-statement-mark" data-statement-id
 * data-verdict>`.
 *
 * Matching runs per top-level block subtree: text nodes are concatenated
 * into virtual plain-text strings (split at nested block elements such
 * as list items), statements resolve against them with the same
 * normalization used for plain-text spans, and each resolved span fans
 * back out across every intersecting text node — including text inside
 * inline `<code>`, `<strong>`, and `<em>` elements. Quotes can never
 * bleed across block boundaries, and `<pre>` code blocks are never
 * highlighted.
 */
export function rehypeHighlightStatements(
  statements: HighlightableStatement[]
): RehypeHighlightTransformer {
  const withQuotes = statements.filter(
    (s) =>
      typeof s.exact_quote === 'string' &&
      normalizeForMatch(cleanQuoteForMatch(s.exact_quote))
  );

  return (tree: Root): void => {
    if (withQuotes.length === 0) return;

    // Process each top-level block independently.
    for (const block of tree.children ?? []) {
      const pending: PendingTextNode[] = [];
      if (isTextNode(block)) {
        if (block.value) {
          pending.push({ node: block, parent: tree, breakBefore: false });
        }
      } else if (isElementNode(block)) {
        if (SKIPPED_TAGS.has(block.tagName) || isVerifiedMark(block)) {
          continue;
        }
        collectBlockTextNodes(block, pending);
      } else {
        continue;
      }
      if (pending.length === 0) continue;

      // Split at nested block boundaries so each group becomes its own
      // virtual plain-text string — quotes can span inline tags but never
      // bleed across list items or nested blocks.
      const groups: PendingTextNode[][] = [];
      for (const p of pending) {
        const current = groups[groups.length - 1];
        if (p.breakBefore && current && current.length > 0) {
          groups.push([p]);
        } else if (current) {
          current.push(p);
        } else {
          groups.push([p]);
        }
      }

      let remaining = withQuotes;
      for (const group of groups) {
        if (remaining.length === 0) break;
        let haystack = '';
        const collected: CollectedTextNode[] = [];
        for (const p of group) {
          const start = haystack.length;
          haystack += p.node.value;
          collected.push({
            node: p.node,
            parent: p.parent,
            start,
            end: haystack.length,
          });
        }
        if (!haystack) continue;

        // Worker spans are relative to raw message source, not HAST text —
        // resolve purely by quote search in virtual-text coordinates.
        const spans = resolveStatementSpans(haystack, remaining, {
          trustWorkerSpans: false,
        });
        if (spans.length === 0) continue;
        const claimed = new Set(spans.map((s) => s.statementId));
        remaining = remaining.filter((s) => !claimed.has(s.id));

        // Fan each resolved span out across the text nodes it covers.
        const edits = new Map<Text, NodeEdit>();
        for (const span of spans) {
          for (const c of collected) {
            const s = Math.max(span.start, c.start);
            const e = Math.min(span.end, c.end);
            if (s >= e) continue;
            let edit = edits.get(c.node);
            if (!edit) {
              edit = { collected: c, ranges: [] };
              edits.set(c.node, edit);
            }
            edit.ranges.push({
              start: s - c.start,
              end: e - c.start,
              statementId: span.statementId,
              verdict: span.verdict,
            });
          }
        }
        applyNodeEdits(edits);
      }
    }
  };
}

// --- verdict styling ---------------------------------------------------------

const RED_MARK_STYLE: CSSProperties = {
  background: 'var(--red-a3)',
  borderBottom: '2px solid var(--red-8)',
  borderRadius: 3,
  padding: '0 2px',
  cursor: 'pointer',
};

const AMBER_MARK_STYLE: CSSProperties = {
  background: 'var(--amber-a3)',
  borderBottom: '1.5px dashed var(--amber-8)',
  borderRadius: 3,
  padding: '0 2px',
  cursor: 'pointer',
};

const GREEN_MARK_STYLE: CSSProperties = {
  background: 'transparent',
  borderBottom: '1px dotted var(--green-7)',
  borderRadius: 3,
  padding: '0 2px',
  cursor: 'pointer',
};

/** Inline <mark> style per verdict (hover/focus states live in global.css). */
export function getVerdictMarkStyle(verdict: StatementVerdict): CSSProperties {
  switch (verdict) {
    case 'contradicted':
    case 'fabricated':
      return RED_MARK_STYLE;
    case 'partially_supported':
      return AMBER_MARK_STYLE;
    case 'supported':
      return GREEN_MARK_STYLE;
    case 'omission':
    default:
      return AMBER_MARK_STYLE;
  }
}

export function getVerdictLabel(verdict: StatementVerdict): string {
  switch (verdict) {
    case 'supported':
      return 'Supported';
    case 'partially_supported':
      return 'Partially supported';
    case 'contradicted':
      return 'Contradicted';
    case 'fabricated':
      return 'Fabricated';
    case 'omission':
      return 'Omission';
  }
}

/** Radix Badge color for a verdict. */
export function getVerdictBadgeColor(
  verdict: StatementVerdict
): 'green' | 'amber' | 'red' {
  switch (verdict) {
    case 'supported':
      return 'green';
    case 'partially_supported':
    case 'omission':
      return 'amber';
    case 'contradicted':
    case 'fabricated':
      return 'red';
  }
}

/** Safely resolve parsed transcript evidence (API field or raw JSON string). */
export function parseStatementEvidence(
  statement: Pick<VerifiedStatement, 'evidence' | 'transcript_evidence_json'>
): TranscriptEvidenceItem[] {
  if (Array.isArray(statement.evidence)) return statement.evidence;
  const raw = statement.transcript_evidence_json;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TranscriptEvidenceItem[]) : [];
  } catch {
    return [];
  }
}

/** Format evidence milliseconds as [M]M:SS or H:MM:SS. */
export function formatEvidenceTimestamp(timestampMs: number | null): string {
  if (timestampMs === null || timestampMs === undefined || timestampMs < 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(timestampMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
