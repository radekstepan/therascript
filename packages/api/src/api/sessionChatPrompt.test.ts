import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmChatChunk } from '@therascript/services';

// ---- Mocked dependencies (same shape as chatThinkingOnly.test.ts) ----

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

type SessionCtx = Parameters<typeof addSessionChatMessage>[0];

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

function sessionCtx(text: string, chatId = 7): SessionCtx {
  return {
    body: { text },
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

describe('session chat prompt layout (Task 14)', () => {
  beforeEach(() => {
    messageStore.length = 0;
    idCounter.next = 0;
    vi.clearAllMocks();
    vi.mocked(streamChatResponse).mockImplementation(() =>
      makeLlmStream([{ content: 'Visible answer.' }])
    );
  });

  it('injects CONTEXT TRANSCRIPT into the system prefix, not the user message', async () => {
    const res = await addSessionChatMessage(sessionCtx('hello'));
    await res.text();

    const sentMessages = vi.mocked(streamChatResponse).mock.calls[0]![0];
    expect(sentMessages.length).toBeGreaterThanOrEqual(2);

    const [systemMsg, ...rest] = sentMessages;
    expect(systemMsg!.sender).toBe('system');
    expect(systemMsg!.text).toContain('CONTEXT TRANSCRIPT');
    expect(systemMsg!.text).toContain('TRANSCRIPT');

    // No other message may carry the transcript.
    for (const m of rest) {
      expect(m.text).not.toContain('CONTEXT TRANSCRIPT');
    }

    // The latest user message stays clean.
    const latest = sentMessages[sentMessages.length - 1]!;
    expect(latest.sender).toBe('user');
    expect(latest.text).toBe('hello');
  });

  it('keeps the system prefix byte-identical across follow-up turns (KV cache reuse)', async () => {
    const first = await addSessionChatMessage(sessionCtx('first question'));
    await first.text();
    const second = await addSessionChatMessage(sessionCtx('second question'));
    await second.text();

    const calls = vi.mocked(streamChatResponse).mock.calls;
    expect(calls).toHaveLength(2);
    const firstSystem = calls[0]![0][0]!;
    const secondSystem = calls[1]![0][0]!;
    expect(firstSystem.sender).toBe('system');
    expect(secondSystem.sender).toBe('system');
    // Stable prefix => LM Studio reuses the KV cache instead of re-prefilling.
    expect(secondSystem.text).toBe(firstSystem.text);

    // The follow-up user message is clean as well.
    const followUp = calls[1]![0];
    const latest = followUp[followUp.length - 1]!;
    expect(latest.sender).toBe('user');
    expect(latest.text).toBe('second question');
  });

  it('stores the clean user text in the database (no transcript leak)', async () => {
    const res = await addSessionChatMessage(sessionCtx('hello'));
    await res.text();

    const userSave = vi
      .mocked(messageRepository.addMessage)
      .mock.calls.find((c) => c[1] === 'user');
    expect(userSave).toBeDefined();
    expect(userSave![2]).toBe('hello');
  });
});
