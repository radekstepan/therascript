import type { BackendSession } from '@therascript/domain';

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

export const cleanLlmOutput = (text: string): string => {
  const tokensToRemove = [
    '</end_of_turn>',
    '<end_of_turn>',
    '<|end_of_turn|>',
    '<|endofturn|>',
    '<|eot_id|>',
    '<|eot|>',
    '<eos>',
    '</s>',
    '<start_of_turn>user',
    '<start_of_turn>model',
    '<start_of_turn>assistant',
    '<start_of_turn>',
    '<|start_of_turn|>',
    '<|startofturn|>',
    '<|start_header_id|>',
    '<|end_header_id|>',
    '<|eom_id|>',
    '[/INST]',
    '[INST]',
    '<s>',
  ];

  let cleanedText = text;
  for (const token of tokensToRemove) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedToken, 'gi');
    cleanedText = cleanedText.replace(regex, '');
  }

  cleanedText = cleanedText.replace(/^\s+|\s+$/g, '').trim();

  return cleanedText;
};

export const createSessionListDTO = (
  session: BackendSession
): Omit<BackendSession, 'chats'> => {
  const { chats, ...dto } = session;
  return dto;
};

export interface ExtractedJson {
  /** The candidate JSON text (trimmed). May be empty. */
  json: string;
  /**
   * True if a balanced top-level object was found, or the text was a
   * complete fenced JSON block. False means the input was truncated or
   * not parseable as a JSON object.
   */
  complete: boolean;
}

/**
 * Pull a single JSON object out of a free-form LLM response.
 *
 * Defends against the common failure modes that cause the strategy planner
 * (and any other LLM-as-JSON call) to fail:
 *
 *   1. Wrapping in a ` ```json ... ``` ` fence (with or without `json` tag)
 *   2. Leading prose such as "Sure! Here is the JSON:"
 *   3. Trailing prose such as "Let me know if you need more."
 *   4. Inline `<think>...</think>` or `<tool_call>...</tool_call>` blocks
 *      that some reasoning models emit even when asked for pure JSON
 *   5. Truncation (returns complete=false so the caller can decide)
 *
 * The brace counter is string-aware: it ignores braces inside JSON strings
 * and handles `\"` escapes. This is the same approach atlas uses in
 * `apps/api/src/lib/json-mode.ts:154-200`.
 */
export function extractJsonObject(text: string): ExtractedJson {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .trim();

  // Fenced JSON block (```json or ```). Must be a complete block.
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch && fenceMatch[1]) {
    return { json: fenceMatch[1].trim(), complete: true };
  }

  // Find the first `{` and walk a string-aware brace counter.
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) {
    return { json: '', complete: false };
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let closeIdx = -1;
  for (let i = firstBrace; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx > 0) {
    return {
      json: cleaned.slice(firstBrace, closeIdx + 1),
      complete: true,
    };
  }
  // Truncated / no closing brace — return what we have so the caller can
  // log the partial output.
  return { json: cleaned.slice(firstBrace), complete: false };
}

/**
 * Parse a free-form LLM response into a JSON object with defense-in-depth.
 *
 *   - `null` is returned when no JSON object can be located.
 *   - `complete: false` returns `null` too (treat truncated as failure;
 *     the caller should retry rather than accept a half-parsed strategy).
 *   - Parse errors throw with the underlying message + the raw snippet
 *     so the caller can surface a useful error.
 */
export function parseJsonObjectFromLlm<T = unknown>(
  text: string,
  rawSnippetMaxLen = 300
): T | null {
  const extracted = extractJsonObject(text);
  if (!extracted.complete || !extracted.json.trim()) {
    return null;
  }
  try {
    return JSON.parse(extracted.json) as T;
  } catch (e) {
    const snippet =
      extracted.json.length > rawSnippetMaxLen
        ? extracted.json.slice(0, rawSnippetMaxLen) + '...'
        : extracted.json;
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`JSON parse failed: ${message} (raw: ${snippet})`);
  }
}

/**
 * Run an async function with exponential backoff + jitter. Used for retrying
 * transient LLM errors (connection drops, 5xx, etc.) without retrying on
 * user cancel or hard model errors. The same shape atlas uses in
 * `synthesis-engine.ts:116` — 250ms / 500ms / 1000ms with ±150ms jitter.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; jitterMs?: number } = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const jitterMs = options.jitterMs ?? 150;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < retries) {
        const delay = baseDelayMs * Math.pow(2, i) + Math.random() * jitterMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw last;
}

/**
 * Wrap a "create async generator" factory with retry on initial connection
 * failure. Each retry creates a fresh generator. The wrapper:
 *
 *   1. Calls `factory()` to get a new generator.
 *   2. Awaits the first `.next()` to surface connection errors here.
 *   3. If the first call yields a chunk, exposes that chunk and proxies the
 *      rest of the inner generator's chunks.
 *   4. Captures the inner generator's return value (StreamResult) so the
 *      consumer loop can still see it.
 *   5. Retries with exponential backoff + jitter on the first-step error.
 *
 * Does NOT retry mid-stream — once a chunk has been yielded, a stream
 * failure bubbles up so the caller can decide what to do.
 */
export async function* streamWithRetry<TYield, TReturn>(
  factory: () => AsyncGenerator<TYield, TReturn>,
  options: {
    retries?: number;
    baseDelayMs?: number;
    jitterMs?: number;
    onRetry?: (err: unknown, attempt: number) => void;
  } = {}
): AsyncGenerator<TYield, TReturn> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const jitterMs = options.jitterMs ?? 150;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const inner = factory();
    let step: IteratorResult<TYield, TReturn>;
    try {
      // First .next() surfaces connection errors so the retry can fire
      // before any chunk is exposed to the consumer.
      step = await inner.next();
    } catch (e) {
      last = e;
      if (attempt < retries) {
        options.onRetry?.(e, attempt + 1);
        const delay =
          baseDelayMs * Math.pow(2, attempt) + Math.random() * jitterMs;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
    // Manual loop (not for-await) so we can capture the final return value.
    // for-await discards it on the iteration that returns done:true.
    while (!step.done) {
      yield step.value;
      try {
        step = await inner.next();
      } catch (e) {
        // Mid-stream failure — surface to the caller; do not retry.
        throw e;
      }
    }
    return step.value;
  }
  // Unreachable — the loop above always either throws or returns.
  throw last;
}
