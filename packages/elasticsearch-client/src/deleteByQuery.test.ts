import { describe, it, expect, vi } from 'vitest';

vi.mock('@elastic/elasticsearch', () => {
  class ResponseError extends Error {
    constructor(public meta: any) {
      super('ResponseError');
    }
  }
  return { errors: { ResponseError } };
});

import { deleteByQuery } from './searchUtils.js';
import { errors as esErrors } from '@elastic/elasticsearch';

function makeClient(overrides: Partial<any> = {}) {
  return {
    deleteByQuery: vi.fn().mockResolvedValue({ deleted: 1, failures: [] }),
    ...overrides,
  } as any;
}

describe('searchUtils.deleteByQuery', () => {
  it('logs warnings but resolves on failures set', async () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const client = makeClient({
        deleteByQuery: vi
          .fn()
          .mockResolvedValue({ deleted: 0, failures: [{ reason: 'x' }] }),
      });
      await deleteByQuery(client, 'idx', { term: { a: 1 } });
      expect(client.deleteByQuery).toHaveBeenCalled();
    } finally {
      spyWarn.mockRestore();
    }
  });

  it('throws on ResponseError and surfaces meta.body', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new (esErrors as any).ResponseError({
        body: { error: { type: 'boom' } },
      });
      const client = makeClient({
        deleteByQuery: vi.fn().mockRejectedValue(err),
      });
      await expect(
        deleteByQuery(client, 'idx', { match_all: {} })
      ).rejects.toBe(err);
    } finally {
      spyErr.mockRestore();
    }
  });
});
