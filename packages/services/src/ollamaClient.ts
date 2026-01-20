import ollama from 'ollama';
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
  ollamaBaseUrl?: string;
}

export interface StreamResult {
  promptTokens?: number;
  completionTokens?: number;
}

export class OllamaConnectionError extends Error {
  constructor(message?: string) {
    super(message || 'Failed to connect to Ollama service');
    this.name = 'OllamaConnectionError';
  }
}

export class OllamaModelNotFoundError extends Error {
  constructor(modelName: string) {
    super(`Model '${modelName}' not found`);
    this.name = 'OllamaModelNotFoundError';
  }
}

export class OllamaTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Ollama request timed out after ${timeoutMs}ms`);
    this.name = 'OllamaTimeoutError';
  }
}

function mapSenderToRole(
  sender: 'user' | 'ai' | 'system'
): 'user' | 'assistant' | 'system' {
  if (sender === 'ai') return 'assistant';
  return sender;
}

async function ensureOllamaReady(
  baseUrl: string,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (Date.now() <= deadline) {
      try {
        await fetch(new URL('/api/tags', baseUrl), {
          signal: controller.signal,
          method: 'GET',
        });
        return;
      } catch (error: any) {
        if (error.name === 'AbortError') {
          throw new OllamaTimeoutError(timeoutMs);
        }
        if (error.code !== 'ECONNREFUSED') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw new OllamaTimeoutError(timeoutMs);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function* streamLlmChat(
  messages: BackendChatMessage[],
  options?: StreamLlmChatOptions
): AsyncGenerator<string, StreamResult> {
  const {
    model = 'llama3',
    contextSize,
    abortSignal,
    timeoutMs = 120000,
    stopTokens = DEFAULT_STOP_TOKENS,
    ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  } = options || {};

  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

  const combinedSignal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    await ensureOllamaReady(
      ollamaBaseUrl,
      Math.min(10000, deadline - Date.now())
    );
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof OllamaTimeoutError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED') {
      throw new OllamaConnectionError(
        `Connection refused: Could not connect to Ollama at ${ollamaBaseUrl}`
      );
    }
    throw new OllamaConnectionError(
      error instanceof Error ? error.message : String(error)
    );
  }

  const ollamaOptions: any = {
    stop: stopTokens,
  };

  if (contextSize !== null && contextSize !== undefined) {
    ollamaOptions.num_ctx = contextSize;
  }

  const ollamaMessages = messages.map((m) => ({
    role: mapSenderToRole(m.sender),
    content: m.text,
  }));

  try {
    const stream = await ollama.chat({
      model,
      messages: ollamaMessages,
      stream: true,
      options: ollamaOptions,
    });

    let accumulatedContent = '';

    for await (const chunk of stream) {
      if (combinedSignal.aborted) {
        clearTimeout(timeoutId);
        if (abortSignal?.aborted) {
          return { promptTokens: 0, completionTokens: 0 };
        }
        throw new OllamaTimeoutError(timeoutMs);
      }

      if (chunk.message?.content) {
        accumulatedContent += chunk.message.content;
        yield chunk.message.content;
      }

      if (chunk.done) {
        clearTimeout(timeoutId);
        return {
          promptTokens: chunk.prompt_eval_count,
          completionTokens: chunk.eval_count,
        };
      }
    }

    clearTimeout(timeoutId);
    return { promptTokens: 0, completionTokens: 0 };
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (combinedSignal.aborted) {
      if (abortSignal?.aborted) {
        return { promptTokens: 0, completionTokens: 0 };
      }
      throw new OllamaTimeoutError(timeoutMs);
    }

    const isModelNotFoundError =
      error.status === 404 ||
      (error.message?.includes('model') &&
        (error.message?.includes('not found') ||
          error.message?.includes('missing')));

    if (isModelNotFoundError) {
      throw new OllamaModelNotFoundError(model);
    }

    const isConnectionError =
      (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
      error.message?.includes('ECONNREFUSED');

    if (isConnectionError) {
      throw new OllamaConnectionError(
        `Connection refused: Could not connect to Ollama at ${ollamaBaseUrl}`
      );
    }

    throw new OllamaConnectionError(
      error instanceof Error ? error.message : String(error)
    );
  }
}
