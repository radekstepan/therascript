import { describe, it, expect, vi } from 'vitest';

// Mock the ES client module with a ResponseError and a dummy Client
vi.mock('@elastic/elasticsearch', () => {
  class ResponseError extends Error {
    constructor(public meta: any) {
      super('ResponseError');
    }
  }
  return { errors: { ResponseError } };
});

import { ensureIndexExists } from './searchUtils.ts';
import { errors as esErrors } from '@elastic/elasticsearch';

function makeClient(opts: { exists: boolean; throwCreate?: any }) {
  return {
    indices: {
      exists: vi.fn().mockResolvedValue(opts.exists),
      create: opts.throwCreate
        ? vi.fn().mockRejectedValue(opts.throwCreate)
        : vi.fn().mockResolvedValue({ acknowledged: true }),
    },
  } as any;
}

describe('searchUtils.ensureIndexExists', () => {
  it('creates index when missing', async () => {
    const client = makeClient({ exists: false });
    await ensureIndexExists(client as any, 'idx', { m: 1 });
    expect(client.indices.create).toHaveBeenCalledOnce();
  });

  it('skips create when already exists', async () => {
    const client = makeClient({ exists: true });
    await ensureIndexExists(client as any, 'idx', { m: 1 });
    expect(client.indices.create).not.toHaveBeenCalled();
  });

  it('swallows resource_already_exists_exception as harmless race', async () => {
    const err = new (esErrors as any).ResponseError({
      body: { error: { type: 'resource_already_exists_exception' } },
    });
    const client = makeClient({ exists: false, throwCreate: err });
    await ensureIndexExists(client as any, 'idx', { m: 1 });
    // no throw
  });

  it('re-throws unexpected create error', async () => {
    const err = new (esErrors as any).ResponseError({
      body: { error: { type: 'boom' } },
    });
    const client = makeClient({ exists: false, throwCreate: err });
    await expect(
      ensureIndexExists(client as any, 'idx', { m: 1 })
    ).rejects.toBe(err);
  });
});
