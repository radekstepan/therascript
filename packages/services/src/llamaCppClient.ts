import type { BackendChatMessage } from '@therascript/domain';

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
  contextSize?: number;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  stopTokens?: string[];
  llamaCppBaseUrl?: string;
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
  maxCompletionTokens?: number;
  /** Number of model layers to offload to GPU. not used directly per-request in llama.cpp */
  numGpuLayers?: number | null;
  think?: boolean | 'high' | 'medium' | 'low';
  thinkingBudget?: number | null;
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

  const combinedSignal = options?.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutController.signal])
    : timeoutController.signal;

  // Hoisted so the finally block can cancel it and close the LM Studio TCP connection
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const bodyPayload: any = {
      model: options?.model || 'default',
      messages: messages.map((m) => ({
        role: mapSenderToRole(m.sender),
        content: m.text,
      })),
      stream: true,
      stream_options: { include_usage: true }, // Required to get usage on final chunk in OAI endpoints
    };

    if (options?.stopTokens && options.stopTokens.length > 0) {
      bodyPayload.stop = options.stopTokens.slice(0, 4); // Strict OpenAI standard
    }

    if (options?.temperature !== undefined)
      bodyPayload.temperature = options.temperature;
    if (options?.topP !== undefined) bodyPayload.top_p = options.topP;
    if (options?.maxCompletionTokens !== undefined)
      bodyPayload.max_tokens = options.maxCompletionTokens;
    if (options?.repeatPenalty !== undefined)
      bodyPayload.presence_penalty = options.repeatPenalty;
    if (
      options?.thinkingBudget !== undefined &&
      options?.thinkingBudget !== null
    )
      bodyPayload.reasoning_budget = options.thinkingBudget;

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
            let content = delta.content;

            // Simple heuristic to split `<think>` contents into thinking vs content
            if (content.includes('<think>')) {
              inThinkResponse = true;
              content = content.replace('<think>', '');
            }
            if (content.includes('</think>')) {
              inThinkResponse = false;
              const parts = content.split('</think>');
              if (parts[0]) {
                // Estimate thinking tokens from the closing think block
                thinkingTokens += Math.max(1, Math.floor(parts[0].length / 4));
                yield { thinking: parts[0] };
              }
              if (parts[1]) {
                yield { content: parts[1] };
              }
              continue;
            }

            if (inThinkResponse) {
              // Estimate thinking tokens for content within think block
              thinkingTokens += Math.max(1, Math.floor(content.length / 4));
              yield { thinking: content };
            } else {
              yield { content: content };
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
    // Cancel the reader to close the TCP connection to LM Studio.
    // This is essential when the consumer abandons the generator (e.g. user clicks Stop)
    // because the generator stays paused and the fetch would otherwise remain open.
    if (reader) {
      reader.cancel().catch(() => {});
    }
  }
}
