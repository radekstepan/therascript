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

describe('tokenizerService.truncateTranscriptToTokenBudget hardening', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an exact 60/40 head/tail split on uniform paragraphs', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // 10 paragraphs x 10 mock-tokens (words) = 100 tokens; budget = 50.
    // headBudget = 30 -> first 3 paragraphs; tailBudget = 20 -> last 2.
    const paras = Array.from(
      { length: 10 },
      (_, i) => `para${i} ` + Array(9).fill('tok').join(' ')
    );
    const out = truncateTranscriptToTokenBudget(paras.join('\n\n'), 50);
    expect(out.truncated).toBe(true);
    expect(out.droppedParagraphs).toBe(5);
    expect(out.text).toContain('[... 5 paragraphs omitted for length ...]');
    expect(out.text.startsWith(paras[0]!)).toBe(true);
    expect(out.text.endsWith(paras[9]!)).toBe(true);
    expect(out.text).toContain(paras[2]!);
    expect(out.text).not.toContain('para4 ');
    expect(out.text).not.toContain('para7 ');
  });

  it('never returns empty text for a single giant monologue paragraph', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // One 100-word paragraph, budget 10: exceeds both headBudget (6) and
    // tailBudget (4), so both walks come back empty and the fallback must
    // slice the paragraph instead of returning only the omission marker.
    const words = Array.from({ length: 100 }, (_, i) => `w${i}`);
    const out = truncateTranscriptToTokenBudget(words.join(' '), 10);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe(words.slice(0, 10).join(' '));
    expect(out.text).not.toContain('omitted for length');
    expect(out.finalTokens).toBeLessThanOrEqual(10);
    expect(out.droppedParagraphs).toBe(0);
  });

  it('slices the first paragraph when every paragraph exceeds its budget', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    const first = Array.from({ length: 50 }, (_, i) => `a${i}`).join(' ');
    const second = Array.from({ length: 50 }, (_, i) => `b${i}`).join(' ');
    const out = truncateTranscriptToTokenBudget(`${first}\n\n${second}`, 10);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe(first.split(' ').slice(0, 10).join(' '));
    expect(out.text.startsWith('a0')).toBe(true);
    expect(out.text).not.toContain('b0');
    expect(out.finalTokens).toBeLessThanOrEqual(10);
    expect(out.droppedParagraphs).toBe(1);
  });

  it('keeps tail content when only the head walk comes back empty', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    const giant = Array.from({ length: 50 }, () => 'word').join(' ');
    const out = truncateTranscriptToTokenBudget(`${giant}\n\ntail end`, 10);
    expect(out.truncated).toBe(true);
    expect(out.text).toContain('tail end');
    expect(out.text).toContain('[... 1 paragraphs omitted for length ...]');
    expect(out.droppedParagraphs).toBe(1);
  });

  it('returns non-empty text for tiny budgets', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
    const one = truncateTranscriptToTokenBudget(words, 1);
    expect(one.truncated).toBe(true);
    expect(one.text).toBe('w0');
    const two = truncateTranscriptToTokenBudget(words, 2);
    expect(two.truncated).toBe(true);
    expect(two.text).toBe('w0 w1');

    // Multi-paragraph text with budget 1 also falls back to a word slice.
    const multi = truncateTranscriptToTokenBudget('aaa bbb\n\nccc ddd', 1);
    expect(multi.truncated).toBe(true);
    expect(multi.text).toBe('aaa');
  });

  it('never duplicates paragraphs between head and tail', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // 4 single-token paragraphs, budget 3: head=[a], tail=[c,d].
    const out = truncateTranscriptToTokenBudget('a\n\nb\n\nc\n\nd', 3);
    expect(out.truncated).toBe(true);
    expect(out.droppedParagraphs).toBe(1);
    expect(out.text).toBe(
      'a\n\n[... 1 paragraphs omitted for length ...]\n\nc\n\nd'
    );
    // 'b' was the only dropped paragraph; nothing appears twice.
    expect(out.text).not.toContain('\n\nb\n\n');
    expect(out.text.indexOf('c\n\nd')).toBeGreaterThan(-1);
  });

  it('returns all paragraphs without a marker when head+tail cover everything', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    // 2 single-token paragraphs, budget 1: head=[a], tail=[b], nothing
    // dropped, so no omission marker is emitted.
    const out = truncateTranscriptToTokenBudget('a\n\nb', 1);
    expect(out.truncated).toBe(true);
    expect(out.droppedParagraphs).toBe(0);
    expect(out.text).toBe('a\n\nb');
    expect(out.text).not.toContain('omitted for length');
  });

  it('returns empty text with zero budget instead of hanging', async () => {
    vi.resetModules();
    const { truncateTranscriptToTokenBudget } = await import(
      './tokenizerService.js'
    );
    const out = truncateTranscriptToTokenBudget('aaa bbb ccc ddd eee fff', 0);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe('');
    expect(out.finalTokens).toBe(0);
  });
});
