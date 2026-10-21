import type { BackendChatMessage } from '@therascript/domain';
import { prepareLlmChatMessages } from './thinking.js';

export const DEFAULT_STOP_TOKENS = [
  '<end_of_turn>',
  '<|eot_id|>',
  '<|start_header_id|>',
  '<|end_header_id|>',
  '<|eom_id|>',
  '</end_of_turn>',
  '<|endofturn|>',
  '<|eot|>',
  '<eos>',
  '</s>',
  '<start_of_turn>',
  '<|start_of_turn|>',
  '<|startofturn|>',
  '[/INST]',
  '[INST]',
  '<s>',
];

export interface StreamLlmChatOptions {
  model?: string;
  /**
   * Desired context window for the model. NOTE: `streamLlmChatDetailed`
   * never reads this field — LM Studio only applies `context_length` at
   * model load time, so the effective context size is enforced when the
   * model is loaded via `ensureModelLoaded` / `loadLlmModel` (API) or
   * `loadLlmModelForWorker` (analysis worker), not per chat-completion
   * request. Retained on the options type for backward compatibility;
   * prefer passing the context size to the load call and leave this unset.
   */
  contextSize?: number;
  abortSignal?: AbortSignal;
  /**
   * Per-call activity-based timeout. Resets every time a chunk is received.
   * For a hard wall-clock cap, use `hardTimeoutMs` instead.
   */
  timeoutMs?: number;
  /**
   * Hard wall-clock timeout. The request is aborted once this many ms have
   * elapsed regardless of streaming activity. Useful for long-running
   * analysis jobs where a slow-streaming model could otherwise run for
   * an unbounded amount of time.
   */
  hardTimeoutMs?: number;
  /**
   * Explicit stop tokens. If unset and `passDefaultStopTokens` is true, the
   * first 4 entries of `DEFAULT_STOP_TOKENS` are used. Pass an empty array
   * to explicitly disable stop tokens for a single call.
   */
  stopTokens?: string[];
  /**
   * When true and `stopTokens` is not explicitly set, the first 4 entries of
   * `DEFAULT_STOP_TOKENS` are forwarded to LM Studio so the model emits a
   * hard end-of-turn signal instead of running until `max_tokens`.
   * Defaults to false to preserve existing chat behavior; analysis paths
   * opt in.
   */
  passDefaultStopTokens?: boolean;
  llamaCppBaseUrl?: string;
  /**
   * Optional API token (e.g. `Authorization: Bearer ...`) to attach to
   * the outgoing request. The caller is responsible for resolving the
   * token against the active base URL — this client does not check
   * whether the URL is local or remote, so it is safe to pass a token
   * unconditionally and let the upstream layer gate on `isRemote`.
   * Undefined / null / empty -> no Authorization header is sent.
   */
  llmApiToken?: string | null;
  temperature?: number;
  topP?: number;
  /**
   * llama.cpp's native repeat_penalty. Sent through `chat_template_kwargs`
   * (LM Studio's native channel for llama.cpp-specific params) because
   * the OpenAI-compat `presence_penalty` field has different semantics —
   * passing `repeatPenalty` there does NOT replicate llama.cpp behavior
   * and is a known source of generation loops.
   */
  repeatPenalty?: number;
  maxCompletionTokens?: number;
  /** Number of model layers to offload to GPU. not used directly per-request in llama.cpp */
  numGpuLayers?: number | null;
  think?: boolean | 'high' | 'medium' | 'low';
  thinkingBudget?: number | null;
  /**
   * Arbitrary LM Studio native fields to forward through
   * `chat_template_kwargs`. Useful for `enable_thinking: true|false` and
   * other llama.cpp-specific knobs that the OpenAI-compat body does not
   * expose. Merged on top of any values derived from the other options
   * (so e.g. an explicit `repeat_penalty` from `repeatPenalty` is
   * preserved unless this option overrides it).
   */
  chatTemplateKwargs?: Record<string, unknown>;
}

export interface StreamResult {
  promptTokens?: number;
  completionTokens?: number;
  thinkingTokens?: number;
}

export interface LlmChatChunk {
  content?: string;
  thinking?: string;
}

export class LlmConnectionError extends Error {
  constructor(message?: string) {
    super(message || 'Failed to connect to LLM service');
    this.name = 'LlmConnectionError';
  }
}

export class LlmModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(`Model '${modelName}' not found`);
    this.name = 'LlmModelNotFoundError';
  }
}

export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mapSenderToRole(
  sender: 'user' | 'ai' | 'system'
): 'user' | 'assistant' | 'system' {
  if (sender === 'ai') return 'assistant';
  return sender;
}

const THINK_OPEN_TAG = '<think>';
const THINK_CLOSE_TAG = '</think>';

/**
 * Length of the longest trailing substring of `text` that is a proper prefix
 * of `tag` (compared case-insensitively). Used to hold a possibly split
 * `<think>` / `</think>` tag across SSE delta boundaries. Returns 0 when the
 * buffer ends with no partial tag.
 */
function trailingPartialTagLength(text: string, tag: string): number {
  const maxLen = Math.min(text.length, tag.length - 1);
  const lowerText = text.toLowerCase();
  for (let len = maxLen; len >= 1; len--) {
    if (lowerText.endsWith(tag.slice(0, len))) {
      return len;
    }
  }
  return 0;
}

export async function* streamLlmChat(
  messages: BackendChatMessage[],
  options?: StreamLlmChatOptions
): AsyncGenerator<string, StreamResult> {
  const detailedStream = streamLlmChatDetailed(messages, options);
  let result = await detailedStream.next();

  while (!result.done) {
    if (result.value.content !== undefined) {
      yield result.value.content;
    }
    result = await detailedStream.next();
  }

  return result.value as StreamResult;
}

export async function* streamLlmChatDetailed(
  messages: BackendChatMessage[],
  options?: StreamLlmChatOptions
): AsyncGenerator<LlmChatChunk, StreamResult> {
  const baseUrl =
    options?.llamaCppBaseUrl ??
    process.env.LLM_BASE_URL ??
    'http://localhost:8080';

  const startTime = Date.now();
  const timeoutMs = options?.timeoutMs ?? 300000;
  const hardTimeoutMs = options?.hardTimeoutMs;
  const timeoutController = new AbortController();
  // Use an activity-based timeout: resets every time we receive data
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(
    () => timeoutController.abort(),
    timeoutMs
  );
  const resetTimeout = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  };

  // Optional hard wall-clock cap. Unlike the activity-based timeout above,
  // this is NOT reset on every chunk. Useful for analysis calls where a
  // slowly-streaming model could otherwise run for an unbounded time.
  let hardTimeoutId: ReturnType<typeof setTimeout> | null = null;
  if (typeof hardTimeoutMs === 'number' && hardTimeoutMs > 0) {
    hardTimeoutId = setTimeout(() => timeoutController.abort(), hardTimeoutMs);
  }

  const combinedSignal = options?.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // Hoisted so the finally block can cancel it and close the LM Studio TCP connection
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    // Idempotent safeguard: strip stored reasoning from assistant turns for
    // every caller (including future ones). User/system text is source
    // material and passes through verbatim.
    const preparedMessages = prepareLlmChatMessages(messages);
    const bodyPayload: any = {
      model: options?.model || 'default',
      messages: preparedMessages.map((m) => ({
        role: mapSenderToRole(m.sender),
        content: m.text,
      })),
      stream: true,
      stream_options: { include_usage: true }, // Required to get usage on final chunk in OAI endpoints
    };

    // Resolve stop tokens: explicit list wins, otherwise fall back to the
    // default set when the caller opted in via `passDefaultStopTokens`.
    // An explicit empty array disables stop tokens for the call.
    const stopTokens = options?.stopTokens
      ? options.stopTokens
      : options?.passDefaultStopTokens
        ? DEFAULT_STOP_TOKENS
        : null;
    if (stopTokens && stopTokens.length > 0) {
      bodyPayload.stop = stopTokens.slice(0, 4); // Strict OpenAI standard
    }

    if (options?.temperature !== undefined)
      bodyPayload.temperature = options.temperature;
    if (options?.topP !== undefined) bodyPayload.top_p = options.topP;
    if (options?.maxCompletionTokens !== undefined)
      bodyPayload.max_tokens = options.maxCompletionTokens;
    if (
      options?.thinkingBudget !== undefined &&
      options?.thinkingBudget !== null
    )
      bodyPayload.reasoning_budget = options.thinkingBudget;

    // llama.cpp's native repeat_penalty travels through chat_template_kwargs
    // (LM Studio's native channel for llama.cpp-specific params). The OpenAI
    // `presence_penalty` field has different semantics — it penalizes tokens
    // that have ever appeared, additively — and is NOT a drop-in replacement
    // for `repeat_penalty` (which is a multiplicative logit penalty on
    // recently-seen tokens). Routing through chat_template_kwargs is the
    // fix for the "model loops" symptom at temperature 0.7.
    const chatTemplateKwargs: Record<string, unknown> = {
      ...(options?.chatTemplateKwargs ?? {}),
    };
    if (options?.repeatPenalty !== undefined) {
      chatTemplateKwargs.repeat_penalty = options.repeatPenalty;
    }
    // When thinking is explicitly disabled (`thinkingBudget === 0`,
    // "Disabled" in the UI), default `enable_thinking` to false so the
    // template does not emit a `<think>` block. An explicit caller value
    // always wins — this only fills in the unset case.
    if (
      options?.thinkingBudget === 0 &&
      chatTemplateKwargs.enable_thinking === undefined
    ) {
      chatTemplateKwargs.enable_thinking = false;
    }
    if (Object.keys(chatTemplateKwargs).length > 0) {
      bodyPayload.chat_template_kwargs = chatTemplateKwargs;
    }

    // Build headers. Authorization is only attached when a non-empty token
    // is supplied; the caller (API/worker) is expected to have already
    // gated on "is this a remote URL?" so the local LM Studio daemon is
    // never asked for credentials it cannot validate.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (
      typeof options?.llmApiToken === 'string' &&
      options.llmApiToken.trim().length > 0
    ) {
      headers['Authorization'] = `Bearer ${options.llmApiToken.trim()}`;
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      signal: combinedSignal,
      body: JSON.stringify(bodyPayload),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new LlmModelNotFoundError(options?.model || 'unknown');
      }
      const errText = await response.text().catch(() => '');
      throw new LlmConnectionError(
        `HTTP Error: ${response.status} ${response.statusText} - ${errText}`
      );
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Parse SSE stream (text/event-stream)
    // NOTE: hoisted to outer scope so the finally block can cancel it on abort
    reader = response.body.getReader();

    // *** KEY: directly cancel the reader the moment the signal fires ***
    // AbortSignal only controls the fetch() setup call, NOT the reader once it exists.
    // When the generator is paused at `yield` (not inside reader.read()), aborting
    // the signal has zero effect. This listener ensures the TCP connection to LM Studio
    // is closed immediately — causing reader.read() to return {done:true} on the next
    // call and gracefully terminating the generation loop.
    const abortHandler = () => {
      reader?.cancel().catch(() => {});
    };
    combinedSignal.addEventListener('abort', abortHandler, { once: true });

    const decoder = new TextDecoder();
    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let thinkingTokens = 0;

    let inThinkResponse = false;
    let thinkStartTime: number | null = null;
    // Holds a trailing partial `<think>` / `</think>` tag across
    // `delta.content` chunks so tags split over SSE deltas are still
    // recognised. Text before the held suffix is emitted immediately.
    let pendingBuffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      resetTimeout();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let isDone = false;

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          isDone = true;
          break;
        }
        try {
          const chunk = JSON.parse(data);

          // Surface llama.cpp error chunks that would otherwise be silently swallowed
          if (chunk.error) {
            const msg =
              typeof chunk.error === 'string'
                ? chunk.error
                : chunk.error.message || JSON.stringify(chunk.error);
            throw new LlmConnectionError(`llama.cpp stream error: ${msg}`);
          }

          const delta = chunk.choices?.[0]?.delta;

          // Handle native reasoning_content field (e.g. Qwen3, QwQ)
          if (
            delta &&
            typeof delta.reasoning_content === 'string' &&
            delta.reasoning_content
          ) {
            const reasoningText = delta.reasoning_content;
            // Estimate thinking tokens (rough heuristic: 1 token per 4 chars)
            thinkingTokens += Math.max(1, Math.floor(reasoningText.length / 4));
            yield { thinking: reasoningText };
          }

          if (delta && typeof delta.content === 'string') {
            // Stateful streaming tag parser: `<think>` / `</think>` may be
            // split across SSE deltas, so accumulate into `pendingBuffer`,
            // flip modes on every complete tag (case-insensitive), and hold
            // only a trailing partial-tag prefix for the next chunk.
            pendingBuffer += delta.content;
            while (true) {
              const tag = inThinkResponse ? THINK_CLOSE_TAG : THINK_OPEN_TAG;
              const idx = pendingBuffer.toLowerCase().indexOf(tag);
              if (idx === -1) break;
              const before = pendingBuffer.slice(0, idx);
              if (before) {
                if (inThinkResponse) {
                  thinkingTokens += Math.max(1, Math.floor(before.length / 4));
                  yield { thinking: before };
                } else {
                  yield { content: before };
                }
              }
              pendingBuffer = pendingBuffer.slice(idx + tag.length);
              inThinkResponse = !inThinkResponse;
            }
            // Emit everything except a trailing partial-tag prefix, which is
            // held until the next chunk proves or disproves the tag.
            const activeTag = inThinkResponse
              ? THINK_CLOSE_TAG
              : THINK_OPEN_TAG;
            const holdLen = trailingPartialTagLength(pendingBuffer, activeTag);
            const emitText = pendingBuffer.slice(
              0,
              pendingBuffer.length - holdLen
            );
            pendingBuffer = pendingBuffer.slice(pendingBuffer.length - holdLen);
            if (emitText) {
              if (inThinkResponse) {
                // Estimate thinking tokens for content within think block
                thinkingTokens += Math.max(1, Math.floor(emitText.length / 4));
                yield { thinking: emitText };
              } else {
                yield { content: emitText };
              }
            }
          }

          // Capture usage from final chunk (standard OAI streaming behavior)
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens;
            completionTokens = chunk.usage.completion_tokens;
          }
        } catch (e) {
          // Re-throw application errors — only swallow JSON parse failures
          // from incomplete/partial SSE chunks
          if (
            e instanceof LlmConnectionError ||
            e instanceof LlmModelNotFoundError
          ) {
            throw e;
          }
        }
      }
      if (isDone) break;
      // Yield to the event loop so the downstream consumer (the SSE handler
      // in the API) gets a chance to drain its own socket and forward bytes
      // to the browser before we demand the next chunk. Without this, a
      // single reader.read() that contains several lines would be delivered
      // to the consumer as a burst, and on a remote (non-loopback) socket
      // the consumer's writes can be coalesced by the kernel send buffer
      // into a single flush — manifesting as "loading, then full response."
      // Cost: ~1 event-loop tick per chunk. Negligible on local LM Studio
      // (where loopback is already microseconds) and turns remote streaming
      // into the same token-by-token cadence the user sees locally.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    // Flush any buffered tail (a partial tag that never completed, or
    // text withheld at EOF) to the currently active channel so no streamed
    // text is silently dropped.
    if (pendingBuffer) {
      if (inThinkResponse) {
        thinkingTokens += Math.max(1, Math.floor(pendingBuffer.length / 4));
        yield { thinking: pendingBuffer };
      } else {
        yield { content: pendingBuffer };
      }
      pendingBuffer = '';
    }

    // Return the usage result to the iterator's result value
    return { promptTokens, completionTokens, thinkingTokens };
  } catch (error: any) {
    if (combinedSignal.aborted || error.name === 'AbortError') {
      if (options?.abortSignal?.aborted) {
        return { promptTokens: 0, completionTokens: 0 };
      }
      throw new LlmTimeoutError(timeoutMs);
    }

    if (
      error instanceof LlmModelNotFoundError ||
      error instanceof LlmConnectionError
    ) {
      throw error;
    }

    const isConnectionError =
      (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('fetch failed');

    if (isConnectionError) {
      throw new LlmConnectionError(
        `Connection refused: Could not connect to LLM at ${baseUrl}`
      );
    }
    throw new Error(getErrorMessage(error));
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
    if (hardTimeoutId !== null) {
      clearTimeout(hardTimeoutId);
      hardTimeoutId = null;
    }
    // Cancel the reader to close the TCP connection to LM Studio.
    // This is essential when the consumer abandons the generator (e.g. user clicks Stop)
    // because the generator stays paused and the fetch would otherwise remain open.
    if (reader) {
      reader.cancel().catch(() => {});
    }
  }
}
