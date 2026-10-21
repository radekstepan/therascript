import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmChatChunk } from '@therascript/services';

// ---- Mocked dependencies (declared before importing the handlers) ----

vi.mock('../services/llamaCppService.js', () => ({
  ensureModelLoaded: vi.fn(async () => {}),
  streamChatResponse: vi.fn(),
  unloadActiveModel: vi.fn(async () => 'model unloaded successfully'),
}));

vi.mock('../services/activeModelService.js', () => ({
  getConfiguredContextSize: () => 8192,
  getActiveModel: () => 'default',
  getActiveBaseUrl: () => 'http://localhost:1234',
}));

vi.mock('../services/contextUsageService.js', () => ({
  computeContextUsageForChat: vi.fn(async () => ({
    totals: { promptTokens: 10 },
  })),
  recommendContextSize: () => 4096,
}));

interface StoredMessage {
  id: number;
  chatId: number;
  sender: string;
  text: string;
  timestamp: number;
  promptTokens?: number;
  completionTokens?: number;
}

const { messageStore, idCounter } = vi.hoisted(() => ({
  messageStore: [] as StoredMessage[],
  idCounter: { next: 0 },
}));

vi.mock('@therascript/data', () => ({
  chatRepository: {},
  transcriptRepository: {
    getTranscriptTextForSession: () => 'TRANSCRIPT',
  },
  messageRepository: {
    addMessage: vi.fn(
      (
        chatId: number,
        sender: string,
        text: string,
        promptTokens?: number,
        completionTokens?: number
      ): StoredMessage => {
        const msg: StoredMessage = {
          id: ++idCounter.next,
          chatId,
          sender,
          text,
          timestamp: Date.now(),
          promptTokens,
          completionTokens,
        };
        messageStore.push(msg);
        return msg;
      }
    ),
    findMessagesByChatId: vi.fn((chatId: number) =>
      messageStore.filter((m) => m.chatId === chatId)
    ),
  },
  usageRepository: {
    insertUsageLog: vi.fn(),
  },
  templateRepository: {
    findByTitle: () => null,
  },
}));

vi.mock('@therascript/elasticsearch-client', () => ({
  getElasticsearchClient: () => ({}),
  MESSAGES_INDEX: 'messages-test',
  indexDocument: vi.fn(async () => {}),
  deleteByQuery: vi.fn(async () => {}),
  bulkIndexDocuments: vi.fn(async () => {}),
}));

vi.mock('@therascript/config', () => ({
  default: { elasticsearch: { url: 'http://localhost:9200' } },
}));

import { streamChatResponse } from '../services/llamaCppService.js';
import { messageRepository } from '@therascript/data';
import { addSessionChatMessage } from './sessionChatHandler.js';
import { addStandaloneChatMessage } from './standaloneChatHandler.js';

type SessionCtx = Parameters<typeof addSessionChatMessage>[0];
type StandaloneCtx = Parameters<typeof addStandaloneChatMessage>[0];

const FALLBACK_SNIPPET = 'exhausted its token budget while reasoning';

async function* makeLlmStream(
  chunks: LlmChatChunk[],
  result: { promptTokens: number; completionTokens: number } = {
    promptTokens: 5,
    completionTokens: 10,
  }
): AsyncGenerator<
  LlmChatChunk,
  { promptTokens: number; completionTokens: number }
> {
  for (const chunk of chunks) {
    yield chunk;
  }
  return result;
}

function parseSseEvents(raw: string): Array<Record<string, unknown>> {
  return raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      return JSON.parse((line ?? 'data: {}').substring(5).trim());
    });
}

function sessionCtx(chatId = 7): SessionCtx {
  return {
    body: { text: 'hello' },
    params: {},
    query: {},
    set: {},
    request: new Request('http://localhost/api/test'),
    sessionData: {
      id: 1,
      clientName: 'Client',
      sessionName: 'Session',
      showSpeakers: 1,
      transcriptTokenCount: 10,
    },
    chatData: { id: chatId, sessionId: 1 },
  } as unknown as SessionCtx;
}

function standaloneCtx(chatId = 8): StandaloneCtx {
  return {
    body: { text: 'hello' },
    params: {},
    query: {},
    set: {},
    request: new Request('http://localhost/api/test'),
    chatData: { id: chatId, sessionId: null, name: null, tags: null },
  } as unknown as StandaloneCtx;
}

function savedAiText(): string | undefined {
  const calls = vi.mocked(messageRepository.addMessage).mock.calls;
  const aiSave = calls.find((c) => c[1] === 'ai');
  return aiSave?.[2] as string | undefined;
}

describe('thinking-only chat responses', () => {
  beforeEach(() => {
    messageStore.length = 0;
    idCounter.next = 0;
    vi.clearAllMocks();
  });

  it('session chat streams and saves a fallback notice for thinking-only responses', async () => {
    vi.mocked(streamChatResponse).mockReturnValueOnce(
      makeLlmStream([{ thinking: 'reasoning that never concludes' }])
    );

    const res = await addSessionChatMessage(sessionCtx());
    const events = parseSseEvents(await res.text());

    const chunkIdx = events.findIndex(
      (e) => typeof e.chunk === 'string' && e.chunk.includes(FALLBACK_SNIPPET)
    );
    const doneIdx = events.findIndex((e) => e.done === true);
    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(chunkIdx);

    // The UI closes </think> on status:responding, so it must precede the
    // fallback chunk for the notice to render as visible text.
    const respondingIdx = events.findIndex((e) => e.status === 'responding');
    expect(respondingIdx).toBeGreaterThanOrEqual(0);
    expect(respondingIdx).toBeLessThan(chunkIdx);

    const text = savedAiText();
    expect(text).toBeDefined();
    expect(text).toContain('</think>');
    expect(text!.indexOf('</think>')).toBeLessThan(
      text!.indexOf(FALLBACK_SNIPPET)
    );
  });

  it('session chat leaves responses with visible text untouched', async () => {
    vi.mocked(streamChatResponse).mockReturnValueOnce(
      makeLlmStream([
        { thinking: 'brief reasoning' },
        { content: 'Hello there, visible answer.' },
      ])
    );

    const res = await addSessionChatMessage(sessionCtx());
    const raw = await res.text();
    expect(raw).not.toContain(FALLBACK_SNIPPET);

    const text = savedAiText();
    expect(text).toBeDefined();
    expect(text).not.toContain(FALLBACK_SNIPPET);
    expect(text).toContain('Hello there, visible answer.');
  });

  it('session chat skips the fallback when the user aborts mid-thinking', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* gatedStream(): AsyncGenerator<
      LlmChatChunk,
      { promptTokens: number; completionTokens: number }
    > {
      yield { thinking: 'slow reasoning' };
      await gate;
      return { promptTokens: 5, completionTokens: 10 };
    }
    vi.mocked(streamChatResponse).mockReturnValueOnce(gatedStream());

    const res = await addSessionChatMessage(sessionCtx());
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('thinkingChunk')) break;
    }
    // Simulate the STOP button: disconnect SSE, then let the LLM finish.
    await reader.cancel();
    release();

    await vi.waitFor(() => {
      expect(savedAiText()).toBeDefined();
    });
    expect(savedAiText()).not.toContain(FALLBACK_SNIPPET);
  });

  it('standalone chat streams and saves a fallback notice for thinking-only responses', async () => {
    vi.mocked(streamChatResponse).mockReturnValueOnce(
      makeLlmStream([{ thinking: 'reasoning that never concludes' }])
    );

    const res = await addStandaloneChatMessage(standaloneCtx());
    const events = parseSseEvents(await res.text());

    const chunkIdx = events.findIndex(
      (e) => typeof e.chunk === 'string' && e.chunk.includes(FALLBACK_SNIPPET)
    );
    const doneIdx = events.findIndex((e) => e.done === true);
    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(chunkIdx);

    const respondingIdx = events.findIndex((e) => e.status === 'responding');
    expect(respondingIdx).toBeGreaterThanOrEqual(0);
    expect(respondingIdx).toBeLessThan(chunkIdx);

    const text = savedAiText();
    expect(text).toBeDefined();
    expect(text).toContain('</think>');
    expect(text!.indexOf('</think>')).toBeLessThan(
      text!.indexOf(FALLBACK_SNIPPET)
    );
  });

  it('standalone chat leaves responses with visible text untouched', async () => {
    vi.mocked(streamChatResponse).mockReturnValueOnce(
      makeLlmStream([
        { thinking: 'brief reasoning' },
        { content: 'Hello there, visible answer.' },
      ])
    );

    const res = await addStandaloneChatMessage(standaloneCtx());
    const raw = await res.text();
    expect(raw).not.toContain(FALLBACK_SNIPPET);

    const text = savedAiText();
    expect(text).toBeDefined();
    expect(text).not.toContain(FALLBACK_SNIPPET);
    expect(text).toContain('Hello there, visible answer.');
  });
});
