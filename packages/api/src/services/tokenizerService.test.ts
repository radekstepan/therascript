import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock tiktoken to control tokenizer availability and behavior
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
    // Silence expected error/warn noise from init failure and null tokenizer path
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Remock get_encoding to throw to simulate init failure
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
