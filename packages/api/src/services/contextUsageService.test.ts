import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies used inside contextUsageService
vi.mock('@therascript/services', () => ({
  calculateTokenCount: (s: string) => (s ? s.length : 0),
}));
vi.mock('./activeModelService.js', () => ({
  getActiveModel: () => 'test-model',
  getConfiguredContextSize: () => null,
}));
vi.mock('./ollamaService.js', () => ({
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
});
