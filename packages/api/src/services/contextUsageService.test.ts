import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies used inside contextUsageService
vi.mock('@therascript/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@therascript/services')>();
  return {
    calculateTokenCount: (s: string) => (s ? s.length : 0),
    // Use the real preparation helper: the tests below verify estimates
    // reflect the same sanitized history inference sends.
    prepareLlmChatMessages: actual.prepareLlmChatMessages,
    extractVisibleAnswer: actual.extractVisibleAnswer,
  };
});
vi.mock('./activeModelService.js', () => ({
  getActiveModel: () => 'test-model',
  getConfiguredContextSize: () => null,
}));
vi.mock('./llamaCppService.js', () => ({
  listModels: async () => [{ name: 'test-model', defaultContextSize: 8192 }],
}));
vi.mock('@therascript/data', () => ({
  templateRepository: {
    findByTitle: (title: string) => ({
      id: 1,
      title,
      text: 'SYS',
      createdAt: Date.now(),
    }),
  },
}));
vi.mock('@therascript/db/dist/sqliteService.js', () => ({
  SYSTEM_PROMPT_TEMPLATES: {
    SESSION_CHAT: { text: 'SYS-CHAT' },
    STANDALONE_CHAT: { text: 'SYS-STANDALONE' },
  },
}));

import {
  recommendContextSize,
  computeContextUsageForChat,
} from './contextUsageService.js';

describe('contextUsageService.recommendContextSize', () => {
  it('returns transcript + buffer rounded, min 4096', () => {
    expect(
      recommendContextSize({ transcriptTokens: 1000, modelDefaultMax: null })
    ).toBe(4096);
    expect(
      recommendContextSize({ transcriptTokens: 3000, modelDefaultMax: null })
    ).toBe(5120);
  });
  it('caps at model default if provided', () => {
    expect(
      recommendContextSize({ transcriptTokens: 10000, modelDefaultMax: 8192 })
    ).toBe(8192);
  });
  it('returns default when transcript missing', () => {
    expect(
      recommendContextSize({
        transcriptTokens: null as any,
        modelDefaultMax: 4096,
      })
    ).toBe(4096);
  });
});

describe('contextUsageService.computeContextUsageForChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('computes totals and remaining for standalone chat', async () => {
    const res = await computeContextUsageForChat({
      isStandalone: true,
      messages: [
        { sender: 'user', text: 'hi', timestamp: 0 },
        { sender: 'ai', text: 'hello', timestamp: 1 },
      ] as any,
      inputDraft: '?',
      reservedOutputTokens: 512,
    });

    // Our mocked token counter returns string length
    // templateRepository mock returns 'SYS' so systemTokens = 3
    const expectedChatHistory = 'user: hi\nai: hello';
    expect(res.breakdown.systemTokens).toBe(3);
    expect(res.breakdown.chatHistoryTokens).toBe(expectedChatHistory.length);
    expect(res.breakdown.inputDraftTokens).toBe(1);
    const expectedPrompt = 3 + expectedChatHistory.length + 1;
    expect(res.totals.promptTokens).toBe(expectedPrompt);
    expect(res.model.effectiveContextSize).toBe(8192);
    expect(res.totals.remainingForPrompt).toBe(8192 - expectedPrompt);
    expect(res.totals.remainingForOutput).toBe(8192 - expectedPrompt - 512);
  });

  it('excludes stored reasoning from the history estimate', async () => {
    const withThinking = await computeContextUsageForChat({
      isStandalone: true,
      messages: [
        { sender: 'user', text: 'hi', timestamp: 0 },
        {
          sender: 'ai',
          text: '<think>very long internal reasoning chain</think>hello',
          timestamp: 1,
        },
      ] as any,
    });
    const clean = await computeContextUsageForChat({
      isStandalone: true,
      messages: [
        { sender: 'user', text: 'hi', timestamp: 0 },
        { sender: 'ai', text: 'hello', timestamp: 1 },
      ] as any,
    });
    // Same estimate whether or not stored reasoning is present.
    expect(withThinking.breakdown.chatHistoryTokens).toBe(
      clean.breakdown.chatHistoryTokens
    );
    expect(withThinking.totals.promptTokens).toBe(clean.totals.promptTokens);
  });

  it('drops reasoning-only assistant turns and leading welcome messages from the estimate', async () => {
    const res = await computeContextUsageForChat({
      isStandalone: true,
      messages: [
        { sender: 'ai', text: 'Welcome! Ask me anything.', timestamp: 0 },
        { sender: 'user', text: 'Q1', timestamp: 1 },
        { sender: 'ai', text: '<think>reasoning only</think>', timestamp: 2 },
        { sender: 'user', text: 'Q2', timestamp: 3 },
      ] as any,
    });
    // Welcome + reasoning-only turn removed; Q1 and Q2 merged into one turn.
    // Merged text: 'Q1\n\n---\n\nQ2' with the 'user: ' prefix.
    const expectedChatHistory = 'user: Q1\n\n---\n\nQ2';
    expect(res.breakdown.chatHistoryTokens).toBe(expectedChatHistory.length);
  });
});
