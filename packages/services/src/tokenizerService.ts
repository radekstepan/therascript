import { get_encoding, Tiktoken } from '@dqbd/tiktoken';

let tokenizer: Tiktoken | null = null;
const ENCODING_NAME = 'cl100k_base';

try {
  tokenizer = get_encoding(ENCODING_NAME);
  console.log(
    `[TokenizerService] Tiktoken tokenizer ('${ENCODING_NAME}') initialized successfully.`
  );
} catch (e) {
  console.error(
    `[TokenizerService] FATAL: Failed to initialize Tiktoken tokenizer ('${ENCODING_NAME}'):`,
    e
  );
  tokenizer = null;
}

export const calculateTokenCount = (
  text: string | null | undefined
): number | null => {
  if (!tokenizer) {
    console.warn(
      '[TokenizerService] Tokenizer not available, cannot calculate token count.'
    );
    return null;
  }
  if (!text) {
    return 0;
  }
  try {
    const tokens = tokenizer.encode(text);
    return tokens.length;
  } catch (e) {
    console.error('[TokenizerService] Error calculating tokens:', e);
    return null;
  }
};

export interface TruncateResult {
  text: string;
  truncated: boolean;
  droppedParagraphs: number;
  originalTokens: number;
  finalTokens: number;
}

const OMITTED_MARKER = '\n\n[... {n} paragraphs omitted for length ...]\n\n';

/**
 * Truncate a transcript (paragraph-joined by `\n\n`) to fit a token budget
 * using a head + tail strategy. The first 60% of the budget is taken from
 * the beginning of the text, the last 40% from the end, and a marker is
 * inserted between them so the model knows the middle was dropped.
 *
 * If the text already fits, it is returned as-is with `truncated: false`.
 *
 * This is intentionally simple: it does not preserve paragraph boundaries
 * inside the head/tail slices (the marker is the boundary). For long
 * sessions this keeps the most chronologically relevant content (head =
 * session opening, tail = session close) within budget.
 *
 * Hardening: the tail walk is bounded so it can never overlap/duplicate head
 * paragraphs, and when even a single paragraph exceeds its budget (e.g. a
 * giant monologue) the first paragraph is token-sliced to the budget so the
 * function never returns zero transcript text when `budgetTokens > 0`.
 */

/**
 * Slice `text` down to approximately `budget` tokens. Prefers exact
 * token-level truncation via `decode` when the tokenizer supports it,
 * otherwise binary-searches the longest word prefix within budget measured
 * with `encode` (covers mocked tokenizers that only implement `encode`).
 * Always returns a non-empty string when `text` is non-empty and
 * `budget > 0`.
 */
function sliceTextToTokenBudget(text: string, budget: number): string {
  if (!tokenizer || budget <= 0) return '';
  if (!text) return '';
  const target = Math.max(1, Math.floor(budget));
  let tokens: Uint32Array;
  try {
    tokens = tokenizer.encode(text);
  } catch {
    return text.slice(0, Math.max(1, target));
  }
  if (tokens.length <= target) return text;
  const decode = (
    tokenizer as unknown as { decode?: (t: Uint32Array) => unknown }
  ).decode;
  if (typeof decode === 'function') {
    try {
      const decoded = decode.call(tokenizer, tokens.slice(0, target));
      const sliced =
        typeof decoded === 'string'
          ? decoded
          : new TextDecoder().decode(decoded as Uint8Array);
      if (sliced) return sliced;
    } catch {
      // fall through to the word-based slicing below
    }
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  let lo = 1;
  let hi = words.length;
  let best = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let count: number;
    try {
      count = tokenizer.encode(words.slice(0, mid).join(' ')).length;
    } catch {
      break;
    }
    if (count <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return words.slice(0, Math.max(1, best)).join(' ');
}
export function truncateTranscriptToTokenBudget(
  text: string,
  budgetTokens: number,
  options: { headRatio?: number } = {}
): TruncateResult {
  const headRatio = options.headRatio ?? 0.6;
  const empty: TruncateResult = {
    text,
    truncated: false,
    droppedParagraphs: 0,
    originalTokens: 0,
    finalTokens: 0,
  };

  if (!tokenizer) {
    console.warn(
      '[TokenizerService] Tokenizer unavailable, returning input unchanged.'
    );
    return empty;
  }
  if (!text) {
    return { ...empty, text: '' };
  }

  let originalTokens: number;
  try {
    originalTokens = tokenizer.encode(text).length;
  } catch (e) {
    console.error('[TokenizerService] Error encoding during truncate:', e);
    return empty;
  }

  if (originalTokens <= budgetTokens) {
    return {
      text,
      truncated: false,
      droppedParagraphs: 0,
      originalTokens,
      finalTokens: originalTokens,
    };
  }

  // Split by paragraph (double newline) to count what we're dropping.
  const paragraphs = text.split(/\n\n+/);
  // We need to be careful here: the joined text used `split(/\n\n+/)` but
  // the original was joined with `\n\n`. round-tripping is fine for the
  // counting, the marker will use the same separator.
  const headBudget = Math.max(1, Math.floor(budgetTokens * headRatio));
  const tailBudget = Math.max(1, budgetTokens - headBudget);

  // Walk from the start, accumulating paragraphs until we exceed headBudget.
  const headParagraphs: string[] = [];
  let headTokens = 0;
  for (const p of paragraphs) {
    const t = tokenizer.encode(p).length;
    if (headTokens + t > headBudget) break;
    headParagraphs.push(p);
    headTokens += t;
  }

  // Walk from the end, accumulating paragraphs until we exceed tailBudget.
  // Bounded below by headParagraphs.length so head and tail can never
  // overlap or duplicate paragraphs, even when per-paragraph token counts
  // under-estimate the whole-text count.
  const tailParagraphs: string[] = [];
  let tailTokens = 0;
  for (let i = paragraphs.length - 1; i >= headParagraphs.length; i--) {
    const p = paragraphs[i]!;
    const t = tokenizer.encode(p).length;
    if (tailTokens + t > tailBudget) break;
    tailParagraphs.unshift(p);
    tailTokens += t;
  }

  const headCount = headParagraphs.length;
  const tailCount = tailParagraphs.length;
  const kept = headCount + tailCount;

  // Fallback for oversized single paragraphs (e.g. a giant monologue): if
  // the first paragraph exceeds headBudget and the last exceeds tailBudget,
  // both loops above come back empty. Slice the first paragraph down to the
  // budget so we never return zero transcript text when budgetTokens > 0.
  if (kept === 0 && paragraphs.length > 0) {
    if (budgetTokens <= 0) {
      return {
        text: '',
        truncated: true,
        droppedParagraphs: paragraphs.length,
        originalTokens,
        finalTokens: 0,
      };
    }
    const sliced = sliceTextToTokenBudget(paragraphs[0]!, budgetTokens);
    let slicedTokens: number;
    try {
      slicedTokens = tokenizer.encode(sliced).length;
    } catch {
      slicedTokens = budgetTokens;
    }
    return {
      text: sliced,
      truncated: true,
      droppedParagraphs: Math.max(0, paragraphs.length - 1),
      originalTokens,
      finalTokens: slicedTokens,
    };
  }

  // Head + tail kept every paragraph: return them all with no marker.
  if (kept === paragraphs.length) {
    const fullText = paragraphs.join('\n\n');
    let fullTokens: number;
    try {
      fullTokens = tokenizer.encode(fullText).length;
    } catch {
      fullTokens = originalTokens;
    }
    return {
      text: fullText,
      truncated: true,
      droppedParagraphs: 0,
      originalTokens,
      finalTokens: fullTokens,
    };
  }

  const dropped = Math.max(0, paragraphs.length - kept);

  const droppedText =
    dropped > 0 ? OMITTED_MARKER.replace('{n}', String(dropped)) : '';
  const finalText = `${headParagraphs.join('\n\n')}${droppedText}${tailParagraphs.join('\n\n')}`;
  const finalTokens = tokenizer.encode(finalText).length;

  return {
    text: finalText,
    truncated: true,
    droppedParagraphs: dropped,
    originalTokens,
    finalTokens,
  };
}
