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
 */
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
  const tailParagraphs: string[] = [];
  let tailTokens = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i]!;
    const t = tokenizer.encode(p).length;
    if (tailTokens + t > tailBudget) break;
    tailParagraphs.unshift(p);
    tailTokens += t;
  }

  // Avoid overlap if head consumed all paragraphs.
  const headCount = headParagraphs.length;
  const tailCount = tailParagraphs.length;
  const kept = headCount + tailCount;
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
