// packages/ui/src/utils/highlightVerifiedStatements.ts
//
// Inline highlighting of Judge-verified statements inside session chat
// notes. Two rendering paths share the same span-resolution logic:
//
// - Plain-text mode: `splitTextByStatementSpans` slices the visible text
//   into plain/highlighted segments for direct <mark> rendering.
// - Markdown mode: `rehypeHighlightStatements` is a zero-dependency
//   rehype plugin for ReactMarkdown that wraps matching HAST text nodes
//   in <mark data-statement-id> elements (matched on normalized text so
//   bold/italic inline tags inside a sentence don't break matching).
//
// The worker persists `start_char`/`end_char` relative to its own
// think-stripped text (`extractVisibleAnswer(...).trim()`), which can
// differ slightly from the bubble's display text. Spans are therefore
// validated against `exact_quote` and fall back to a quote search when
// they don't line up.

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

/** Collapse whitespace runs so formatting differences don't break matching. */
export function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface NormalizedIndex {
  normalized: string;
  /** rawIndices[i] = raw-string index of normalized[i]. */
  rawIndices: number[];
}

/** Build a whitespace-collapsed copy of `text` with a map back to raw indices. */
function buildNormalizedIndex(text: string): NormalizedIndex {
  const normalized: string[] = [];
  const rawIndices: number[] = [];
  let i = 0;
  // Skip leading whitespace (trim).
  while (i < text.length && /\s/.test(text[i]!)) i++;
  let pendingSpace = false;
  let pendingIndex = -1;
  for (; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!pendingSpace) {
        pendingSpace = true;
        pendingIndex = i;
      }
      continue;
    }
    if (pendingSpace) {
      normalized.push(' ');
      rawIndices.push(pendingIndex);
      pendingSpace = false;
    }
    normalized.push(ch);
    rawIndices.push(i);
  }
  return { normalized: normalized.join(''), rawIndices };
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  ranges: Array<readonly [number, number]>
): boolean {
  return ranges.some(([s, e]) => aStart < e && s < aEnd);
}

/**
 * Resolve each statement to a non-overlapping raw-text span. Prefers the
 * worker-persisted span when its slice matches the quote; otherwise
 * searches for the quote. Returns spans sorted by start offset.
 */
export function resolveStatementSpans(
  text: string,
  statements: HighlightableStatement[]
): ResolvedSpan[] {
  const { normalized, rawIndices } = buildNormalizedIndex(text);
  const usedNormalized: Array<[number, number]> = [];
  const usedRaw: Array<[number, number]> = [];
  const resolved: ResolvedSpan[] = [];

  for (const stmt of statements) {
    const quote = normalizeForMatch(stmt.exact_quote ?? '');
    if (!quote) continue;

    let matchStart = -1;
    let matchEnd = -1;

    // Pass 1: trust the worker span when its slice matches the quote.
    const { start_char: sc, end_char: ec } = stmt;
    if (
      typeof sc === 'number' &&
      typeof ec === 'number' &&
      sc >= 0 &&
      ec > sc &&
      ec <= text.length
    ) {
      const slice = normalizeForMatch(text.slice(sc, ec));
      if (slice === quote || (slice.length > 0 && quote.includes(slice))) {
        // Map the raw slice back onto normalized coordinates for
        // overlap tracking via a bounded search.
        const fromIdx =
          usedNormalized.length > 0
            ? usedNormalized[usedNormalized.length - 1]![1]
            : 0;
        const idx = normalized.indexOf(
          quote,
          Math.max(0, fromIdx - quote.length)
        );
        if (
          idx >= 0 &&
          !rangesOverlap(idx, idx + quote.length, usedNormalized)
        ) {
          matchStart = idx;
          matchEnd = idx + quote.length;
        } else if (idx < 0) {
          // Quote text matches the slice but the normalized search
          // failed (shouldn't happen) — accept the raw span directly.
          if (!rangesOverlap(sc, ec, usedRaw)) {
            resolved.push({
              statementId: stmt.id,
              start: sc,
              end: ec,
              verdict: stmt.verdict,
            });
            usedRaw.push([sc, ec]);
          }
          continue;
        }
      }
    }

    // Pass 2: search for the (normalized) quote, preferring the first
    // non-overlapping occurrence after previously used ranges.
    if (matchStart < 0) {
      let from = 0;
      for (;;) {
        const idx = normalized.indexOf(quote, from);
        if (idx < 0) break;
        if (!rangesOverlap(idx, idx + quote.length, usedNormalized)) {
          matchStart = idx;
          matchEnd = idx + quote.length;
          break;
        }
        from = idx + 1;
      }
    }

    if (matchStart < 0) continue;
    const rawStart = rawIndices[matchStart]!;
    const rawEnd = rawIndices[matchEnd - 1]! + 1;
    if (rangesOverlap(rawStart, rawEnd, usedRaw)) continue;
    usedNormalized.push([matchStart, matchEnd]);
    usedRaw.push([rawStart, rawEnd]);
    resolved.push({
      statementId: stmt.id,
      start: rawStart,
      end: rawEnd,
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
  /** Raw offset of this node's value within the block haystack. */
  start: number;
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

function collectTextNodes(
  parent: Element | Root,
  out: CollectedTextNode[],
  offsetRef: { value: number }
): void {
  for (const child of parent.children ?? []) {
    if (isTextNode(child)) {
      if (child.value) {
        out.push({ node: child, parent, start: offsetRef.value });
        offsetRef.value += child.value.length;
      }
    } else if (isElementNode(child)) {
      // Skip nested verification marks (defensive: trees are fresh per
      // render, but never double-wrap).
      if (
        child.tagName === 'mark' &&
        Array.isArray(
          (child.properties as { className?: unknown } | undefined)?.className
        ) &&
        (
          (child.properties as { className: unknown[] }).className as unknown[]
        ).includes(VERIFIED_MARK_CLASS)
      ) {
        continue;
      }
      collectTextNodes(child, out, offsetRef);
    }
  }
}

function makeMarkElement(statementId: number, value: string): Element {
  return {
    type: 'element',
    tagName: 'mark',
    properties: {
      dataStatementId: String(statementId),
      className: [VERIFIED_MARK_CLASS],
    },
    children: [{ type: 'text', value }],
  };
}

interface NodeEdit {
  collected: CollectedTextNode;
  /** Non-overlapping [start, end) ranges in node-local coordinates. */
  ranges: Array<{ start: number; end: number; statementId: number }>;
}

/** Single-argument HAST transformer (pass to ReactMarkdown wrapped as a plugin). */
export type RehypeHighlightTransformer = (tree: Root) => void;

/**
 * rehype plugin factory: wraps each statement's `exact_quote` occurrence
 * in `<mark class="verified-statement-mark" data-statement-id>`.
 *
 * Matching runs per top-level block subtree on whitespace-normalized
 * text, so quotes spanning inline tags (bold/italic/links) still match
 * while quotes can never bleed across block boundaries.
 */
export function rehypeHighlightStatements(
  statements: HighlightableStatement[]
): RehypeHighlightTransformer {
  const withQuotes = statements.filter(
    (s) => typeof s.exact_quote === 'string' && normalizeForMatch(s.exact_quote)
  );

  return (tree: Root): void => {
    if (withQuotes.length === 0) return;

    // Process each top-level block independently.
    for (const block of tree.children ?? []) {
      if (!isElementNode(block) && !isTextNode(block)) continue;

      const collected: CollectedTextNode[] = [];
      const offsetRef = { value: 0 };
      if (isTextNode(block)) {
        if (block.value) {
          collected.push({ node: block, parent: tree, start: 0 });
        }
      } else {
        collectTextNodes(block, collected, offsetRef);
      }
      if (collected.length === 0) continue;

      const haystack = collected.map((c) => c.node.value).join('');
      const { normalized, rawIndices } = buildNormalizedIndex(haystack);
      if (!normalized) continue;

      const used: Array<[number, number]> = [];
      const edits = new Map<Text, NodeEdit>();

      for (const stmt of withQuotes) {
        const quote = normalizeForMatch(stmt.exact_quote);
        let from = 0;
        let matchStart = -1;
        for (;;) {
          const idx = normalized.indexOf(quote, from);
          if (idx < 0) break;
          if (!rangesOverlap(idx, idx + quote.length, used)) {
            matchStart = idx;
            break;
          }
          from = idx + 1;
        }
        if (matchStart < 0) continue;
        const matchEnd = matchStart + quote.length;
        used.push([matchStart, matchEnd]);

        const rawStart = rawIndices[matchStart]!;
        const rawEnd = rawIndices[matchEnd - 1]! + 1;

        // Fan the raw range out across the text nodes it covers.
        for (const c of collected) {
          const nodeStart = c.start;
          const nodeEnd = c.start + c.node.value.length;
          const s = Math.max(rawStart, nodeStart);
          const e = Math.min(rawEnd, nodeEnd);
          if (s >= e) continue;
          let edit = edits.get(c.node);
          if (!edit) {
            edit = { collected: c, ranges: [] };
            edits.set(c.node, edit);
          }
          edit.ranges.push({
            start: s - nodeStart,
            end: e - nodeStart,
            statementId: stmt.id,
          });
        }
      }

      // Apply edits: split text nodes and wrap matched slices in <mark>.
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
            makeMarkElement(r.statementId, value.slice(r.start, r.end))
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
