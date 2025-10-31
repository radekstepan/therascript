import { describe, it, expect, vi } from 'vitest';

import { initializeIndices } from './searchUtils.ts';
import { TRANSCRIPTS_INDEX, MESSAGES_INDEX } from './mappings.ts';

function makeClient() {
  return {
    indices: {
      exists: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
    },
  } as any;
}

describe('searchUtils.initializeIndices', () => {
  it('checks existence for both indices', async () => {
    const client = makeClient();
    await initializeIndices(client);
    expect(client.indices.exists).toHaveBeenCalledTimes(2);
    const calls = (client.indices.exists as any).mock.calls;
    expect(calls[0][0]).toEqual({ index: TRANSCRIPTS_INDEX });
    expect(calls[1][0]).toEqual({ index: MESSAGES_INDEX });
    expect(client.indices.create).not.toHaveBeenCalled();
  });
});
