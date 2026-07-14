import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextEncoder } from 'node:util';
import {
  streamLlmChatDetailed,
  LlmConnectionError,
  LlmModelNotFoundError,
  LlmTimeoutError,
  type LlmChatChunk,
  type StreamResult,
} from './llamaCppClient.js';
import type { BackendChatMessage } from '@therascript/domain';

const messages: BackendChatMessage[] = [
  { id: 1, chatId: 1, sender: 'user', text: 'Hello', timestamp: 0 },
  { id: 2, chatId: 1, sender: 'ai', text: 'Hi back', timestamp: 1 },
  { id: 3, chatId: 1, sender: 'system', text: 'Be helpful', timestamp: 2 },
];

function sseChunk(data: object | string): string {
  if (typeof data === 'string') return `data: ${data}`;
  return `data: ${JSON.stringify(data)}`;
}

function makeSseResponse(chunks: Array<string | object>): Response {
  const encoder = new TextEncoder();
  const body = chunks
    .map((c) => (typeof c === 'string' ? c : sseChunk(c)))
    .join('\n');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function makeErrorResponse(
  status: number,
  statusText: string,
  body = ''
): Response {
  return new Response(body, { status, statusText });
}

async function consume(
  gen: AsyncGenerator<LlmChatChunk, StreamResult>
): Promise<{ chunks: LlmChatChunk[]; result: StreamResult }> {
  const chunks: LlmChatChunk[] = [];
  let step: IteratorResult<LlmChatChunk, StreamResult>;
  while (!(step = await gen.next()).done) {
    chunks.push(step.value);
  }
  return { chunks, result: step.value };
}

describe('streamLlmChatDetailed', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to <baseUrl>/v1/chat/completions with mapped messages and stream flags', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));

    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://remote:1234',
        model: 'meta/llama-3-8b',
      })
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe('http://remote:1234/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'meta/llama-3-8b',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi back' },
        { role: 'system', content: 'Be helpful' },
      ],
    });
  });

  it('defaults to the LLM_BASE_URL env var when no option is given', async () => {
    const previous = process.env.LLM_BASE_URL;
    process.env.LLM_BASE_URL = 'http://env-base:9999';
    try {
      mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
      await consume(streamLlmChatDetailed(messages, { model: 'm' }));
      expect(mockFetch.mock.calls[0]![0]).toBe(
        'http://env-base:9999/v1/chat/completions'
      );
    } finally {
      if (previous === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = previous;
    }
  });

  it('passes through stop tokens (capped at 4), temperature, top_p, max_tokens, repeat_penalty (via chat_template_kwargs), reasoning_budget', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));

    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        model: 'm',
        stopTokens: ['a', 'b', 'c', 'd', 'e', 'f'],
        temperature: 0.3,
        topP: 0.8,
        maxCompletionTokens: 256,
        repeatPenalty: 1.2,
        thinkingBudget: 1024,
      })
    );

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.stop).toEqual(['a', 'b', 'c', 'd']);
    expect(body.temperature).toBe(0.3);
    expect(body.top_p).toBe(0.8);
    expect(body.max_tokens).toBe(256);
    // repeatPenalty is routed through chat_template_kwargs (LM Studio's
    // native channel), not body.presence_penalty, to avoid the loop bug
    // caused by the OpenAI field's different semantics.
    expect(body.chat_template_kwargs).toEqual({ repeat_penalty: 1.2 });
    expect(body.presence_penalty).toBeUndefined();
    expect(body.reasoning_budget).toBe(1024);
  });

  it('omits reasoning_budget when null/undefined and omits stop when no tokens', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        thinkingBudget: null,
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty('reasoning_budget');
    expect(body).not.toHaveProperty('stop');
  });

  it('passes default stop tokens when passDefaultStopTokens is true and stopTokens is unset', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        passDefaultStopTokens: true,
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    // First 4 entries of DEFAULT_STOP_TOKENS.
    expect(body.stop).toEqual([
      '<end_of_turn>',
      '<|eot_id|>',
      '<|start_header_id|>',
      '<|end_header_id|>',
    ]);
  });

  it('explicit stopTokens wins over passDefaultStopTokens', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        passDefaultStopTokens: true,
        stopTokens: ['explicit1', 'explicit2'],
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.stop).toEqual(['explicit1', 'explicit2']);
  });

  it('explicit empty stopTokens array disables stop tokens even with passDefaultStopTokens', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        passDefaultStopTokens: true,
        stopTokens: [],
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty('stop');
  });

  it('merges chatTemplateKwargs with repeatPenalty when both are provided', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        repeatPenalty: 1.3,
        chatTemplateKwargs: { enable_thinking: true, custom_flag: 'x' },
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.chat_template_kwargs).toEqual({
      enable_thinking: true,
      custom_flag: 'x',
      repeat_penalty: 1.3,
    });
  });

  it('omits chat_template_kwargs entirely when no relevant options are set', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://h:1',
        temperature: 0.5,
      })
    );
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body).not.toHaveProperty('chat_template_kwargs');
  });

  it('yields each delta.content as a content chunk and finalises on [DONE]', async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { content: 'Hel' } }] },
        { choices: [{ delta: { content: 'lo ' } }] },
        { choices: [{ delta: { content: 'world' } }] },
        '[DONE]',
      ])
    );

    const { chunks, result } = await consume(
      streamLlmChatDetailed(messages, { llamaCppBaseUrl: 'http://h:1' })
    );

    expect(chunks).toEqual([
      { content: 'Hel' },
      { content: 'lo ' },
      { content: 'world' },
    ]);
    expect(result).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
    });
  });

  it('yields delta.reasoning_content as a thinking chunk', async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { reasoning_content: 'hmm' } }] },
        { choices: [{ delta: { content: 'answer' } }] },
        '[DONE]',
      ])
    );

    const { chunks } = await consume(
      streamLlmChatDetailed(messages, { llamaCppBaseUrl: 'http://h:1' })
    );

    expect(chunks).toEqual([{ thinking: 'hmm' }, { content: 'answer' }]);
  });

  it('splits a single <think>...</think> chunk into thinking then content', async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { content: '<think>inner</think>rest' } }] },
        '[DONE]',
      ])
    );

    const { chunks } = await consume(
      streamLlmChatDetailed(messages, { llamaCppBaseUrl: 'http://h:1' })
    );

    expect(chunks).toEqual([{ thinking: 'inner' }, { content: 'rest' }]);
  });

  it('captures prompt/completion tokens from the final chunk.usage', async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { content: 'a' } }] },
        {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 7, completion_tokens: 3 },
        },
        '[DONE]',
      ])
    );

    const { result } = await consume(
      streamLlmChatDetailed(messages, { llamaCppBaseUrl: 'http://h:1' })
    );

    expect(result).toMatchObject({ promptTokens: 7, completionTokens: 3 });
  });

  it('throws LlmModelNotFoundError on a 404 response', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(404, 'Not Found'));

    await expect(
      consume(
        streamLlmChatDetailed(messages, {
          llamaCppBaseUrl: 'http://h:1',
          model: 'meta/missing',
        })
      )
    ).rejects.toBeInstanceOf(LlmModelNotFoundError);
  });

  it('throws LlmConnectionError on non-404 HTTP errors and includes the body', async () => {
    mockFetch.mockResolvedValue(
      makeErrorResponse(500, 'Internal Server Error', 'boom')
    );

    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
    });
    await expect(consume(gen)).rejects.toThrow(/HTTP Error: 500/);
  });

  it('throws LlmConnectionError when llama.cpp emits a stream error chunk', async () => {
    mockFetch.mockResolvedValue(
      makeSseResponse([
        { choices: [{ delta: { content: 'a' } }] },
        { error: { message: 'context length exceeded' } },
      ])
    );

    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
    });
    await expect(consume(gen)).rejects.toThrow(
      /llama\.cpp stream error: context length exceeded/
    );
  });

  it('throws LlmConnectionError on ECONNREFUSED', async () => {
    const err: any = new Error('fetch failed');
    err.code = 'ECONNREFUSED';
    mockFetch.mockRejectedValue(err);

    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
    });
    await expect(consume(gen)).rejects.toBeInstanceOf(LlmConnectionError);
    await expect(
      consume(
        streamLlmChatDetailed(messages, { llamaCppBaseUrl: 'http://h:1' })
      )
    ).rejects.toThrow(
      /Connection refused: Could not connect to LLM at http:\/\/h:1/
    );
  });

  it('returns zeros and closes cleanly when the caller aborts via abortSignal', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseChunk({ choices: [{ delta: { content: 'a' } }] }) + '\n'
          )
        );
        // Never close — the abort should terminate the generator
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    const controller = new AbortController();
    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
      abortSignal: controller.signal,
    });

    // Read first chunk
    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ content: 'a' });

    // Abort and expect a clean {0,0,0} return
    controller.abort();
    const second = await gen.next();
    expect(second.done).toBe(true);
    expect(second.value).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      thinkingTokens: 0,
    });
  });

  it('throws LlmTimeoutError when the fetch itself is aborted by the timeout signal', async () => {
    // The timeout path goes through the outer try/catch: fetch rejects with
    // an AbortError when the combined signal aborts. Mock fetch to honor the
    // signal so we exercise that exact branch.
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
      timeoutMs: 50,
    });

    await expect(gen.next()).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('cancels the underlying reader when the caller aborts so the TCP connection closes', async () => {
    const encoder = new TextEncoder();
    const cancelSpy = vi.fn();
    // Custom stream that enqueues data but never closes — the abort must
    // drive the reader to done.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseChunk({ choices: [{ delta: { content: 'x' } }] }) + '\n'
          )
        );
      },
      cancel: (reason) => {
        cancelSpy(reason);
      },
    });
    mockFetch.mockResolvedValue(new Response(stream, { status: 200 }));

    const controller = new AbortController();
    const gen = streamLlmChatDetailed(messages, {
      llamaCppBaseUrl: 'http://h:1',
      abortSignal: controller.signal,
    });

    const first = await gen.next();
    expect(first.value).toEqual({ content: 'x' });

    controller.abort();
    const final = await gen.next();
    expect(final.done).toBe(true);
    // The abort handler calls reader.cancel(), which fires the stream's
    // cancel callback exactly once.
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards the request to the configured base URL unchanged', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
      })
    );
    expect(mockFetch.mock.calls[0]![0]).toBe(
      'http://10.0.0.1:1234/v1/chat/completions'
    );
  });
});

describe('streamLlmChatDetailed — Authorization header', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const readHeaders = (): Record<string, string> => {
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    return (init.headers ?? {}) as Record<string, string>;
  };

  const consumeOne = async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
      })
    );
  };

  it('omits the Authorization header when no token is supplied', async () => {
    await consumeOne();
    expect(readHeaders()).not.toHaveProperty('Authorization');
  });

  it('omits the Authorization header when the token is undefined', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: undefined,
      })
    );
    expect(readHeaders()).not.toHaveProperty('Authorization');
  });

  it('omits the Authorization header when the token is null', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: null,
      })
    );
    expect(readHeaders()).not.toHaveProperty('Authorization');
  });

  it('omits the Authorization header when the token is an empty string', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: '',
      })
    );
    expect(readHeaders()).not.toHaveProperty('Authorization');
  });

  it('omits the Authorization header when the token is whitespace-only', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: '   \t\n  ',
      })
    );
    expect(readHeaders()).not.toHaveProperty('Authorization');
  });

  it('attaches Authorization: Bearer <token> when a non-empty token is supplied', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: 'sk-abc-123',
      })
    );
    expect(readHeaders()['Authorization']).toBe('Bearer sk-abc-123');
  });

  it('trims surrounding whitespace from the token before attaching', async () => {
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: '  sk-abc-123  ',
      })
    );
    expect(readHeaders()['Authorization']).toBe('Bearer sk-abc-123');
  });

  it('does not gate on URL — forwards the token to whatever URL the caller supplied', async () => {
    // The client is intentionally URL-agnostic; the upstream layer is
    // responsible for resolving the token to null for local URLs. This
    // test pins that contract: when the caller says "send a token",
    // a Bearer header is sent, period.
    mockFetch.mockResolvedValue(makeSseResponse(['[DONE]']));
    await consume(
      streamLlmChatDetailed(messages, {
        llamaCppBaseUrl: 'http://10.0.0.1:1234',
        llmApiToken: 'sk-abc-123',
      })
    );
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toBe('http://10.0.0.1:1234/v1/chat/completions');
    expect(readHeaders()['Authorization']).toBe('Bearer sk-abc-123');
  });
});
