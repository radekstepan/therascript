import { describe, it, expect, vi } from 'vitest';

// Create a mock ResponseError class and a fake client shape
vi.mock('@elastic/elasticsearch', () => {
  class ResponseError extends Error {
    meta: any;
    constructor(statusCode: number, body?: any) {
      super('ResponseError');
      this.meta = { statusCode, body };
    }
  }
  return {
    errors: { ResponseError },
    Client: class {
      constructor() {}
    },
  };
});

import { deleteDocument, bulkIndexDocuments } from './searchUtils.js';
import { errors as esErrors } from '@elastic/elasticsearch';

function makeClient(overrides: Partial<any> = {}) {
  return {
    delete: vi.fn(),
    bulk: vi.fn(),
    ...overrides,
  } as any;
}

describe('searchUtils.deleteDocument', () => {
  it('swallows 404 ResponseError', async () => {
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const err404 = new (esErrors as any).ResponseError(404);
      const client = makeClient({ delete: vi.fn().mockRejectedValue(err404) });
      await expect(
        deleteDocument(client, 'idx', 'id1')
      ).resolves.toBeUndefined();
    } finally {
      spyWarn.mockRestore();
    }
  });
});

describe('searchUtils.bulkIndexDocuments', () => {
  it('throws when bulk has errors and collects items', async () => {
    const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const client = makeClient({
        bulk: vi.fn().mockResolvedValue({
          errors: true,
          items: [
            {
              index: {
                status: 400,
                error: { type: 'mapper_parsing_exception' },
              },
            },
            { index: { status: 200 } },
          ],
        }),
      });
      await expect(
        bulkIndexDocuments(client, 'idx', [{ id: 'a', document: { x: 1 } }])
      ).rejects.toThrow('Bulk indexing failed');
    } finally {
      spyErr.mockRestore();
    }
  });

  it('no-ops on empty docs', async () => {
    const client = makeClient({ bulk: vi.fn() });
    await bulkIndexDocuments(client, 'idx', []);
    expect(client.bulk).not.toHaveBeenCalled();
  });
});
