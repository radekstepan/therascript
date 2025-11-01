import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    isAxiosError: (e: any) => !!e && typeof e === 'object' && 'code' in e,
  },
}));

import { listLocalModels } from './ollamaClient.js';

describe('ollamaClient.listLocalModels', () => {
  it('returns model names on success', async () => {
    (axios as any).get = vi.fn().mockResolvedValue({
      data: { models: [{ name: 'm1' }, { name: 'm2' }] },
    });
    await expect(listLocalModels()).resolves.toEqual(['m1', 'm2']);
  });
  it('returns [] when ECONNREFUSED', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new Error('refused') as any;
      err.code = 'ECONNREFUSED';
      (axios as any).get = vi.fn().mockRejectedValue(err);
      await expect(listLocalModels()).resolves.toEqual([]);
    } finally {
      spyErr.mockRestore();
    }
  });
});
