import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

vi.mock('@dqbd/tiktoken', () => ({
  get_encoding: vi.fn(() => ({
    encode: (s: string) => (s.trim() === '' ? [] : s.trim().split(/\s+/g)),
  })),
}));

import { get_encoding } from '@dqbd/tiktoken';
const mockedGetEncoding = get_encoding as unknown as Mock;

describe('tokenizerService.calculateTokenCount', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 for empty/nullish input', async () => {
    vi.resetModules();
    const { calculateTokenCount } = await import('./tokenizerService.js');
    expect(calculateTokenCount('')).toBe(0);
    expect(calculateTokenCount(null as any)).toBe(0);
    expect(calculateTokenCount(undefined as any)).toBe(0);
  });

  it('counts tokens using mocked tokenizer', async () => {
    vi.resetModules();
    const { calculateTokenCount } = await import('./tokenizerService.js');
    expect(calculateTokenCount('one two  three')).toBe(3);
  });

  it('returns null if tokenizer failed to initialize', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      (mockedGetEncoding as any).mockImplementationOnce(() => {
        throw new Error('init fail');
      });
      vi.resetModules();
      const { calculateTokenCount } = await import('./tokenizerService.js');
      expect(calculateTokenCount('hello')).toBeNull();
    } finally {
      spyErr.mockRestore();
      spyWarn.mockRestore();
    }
  });
});

describe('tokenizerService.truncateTranscriptToTokenBudget', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the text unchanged when it fits the budget', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // Mock tokenizer splits on whitespace → 5 tokens for "a b c d e".
    const out = truncateTranscriptToTokenBudget('a b c d e', 100);
    expect(out.truncated).toBe(false);
    expect(out.droppedParagraphs).toBe(0);
    expect(out.text).toBe('a b c d e');
  });

  it('drops middle paragraphs and inserts an omitted-marker when over budget', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // 8 paragraphs of 2 tokens each = 16 tokens; budget = 6, headRatio = 0.6
    // headBudget = 3 → keeps first paragraph (2 tokens) before adding the
    // next (would be 4 > 3, so stop).
    // tailBudget = 3 → keeps last paragraph (2 tokens) similarly.
    const text = [
      'p1 a',
      'p2 b',
      'p3 c',
      'p4 d',
      'p5 e',
      'p6 f',
      'p7 g',
      'p8 h',
    ].join('\n\n');
    const out = truncateTranscriptToTokenBudget(text, 6);
    expect(out.truncated).toBe(true);
    expect(out.droppedParagraphs).toBeGreaterThan(0);
    expect(out.text).toContain('[...');
    expect(out.text).toContain('paragraphs omitted for length');
    // Head contains p1; tail contains p8.
    expect(out.text.startsWith('p1 a')).toBe(true);
    expect(out.text.endsWith('p8 h')).toBe(true);
  });

  it('returns the original text when empty', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    const out = truncateTranscriptToTokenBudget('', 100);
    expect(out.text).toBe('');
    expect(out.truncated).toBe(false);
  });
});
