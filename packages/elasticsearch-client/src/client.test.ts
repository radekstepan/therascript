import { describe, it, expect, afterEach, vi } from 'vitest';
import { getElasticsearchClient, closeElasticsearchClient } from './client.js';

vi.mock('@elastic/elasticsearch', () => ({
  Client: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('getElasticsearchClient', () => {
  afterEach(async () => {
    await closeElasticsearchClient();
  });

  it('should return the same instance for identical URLs', () => {
    const client1 = getElasticsearchClient('http://localhost:9200');
    const client2 = getElasticsearchClient('http://localhost:9200');
    expect(client1).toBe(client2);
  });

  it('should throw error when called with different URL', () => {
    getElasticsearchClient('http://localhost:9200');
    expect(() => getElasticsearchClient('http://other:9200')).toThrow(
      /already initialized/
    );
  });

  it('should allow re-init after close', async () => {
    getElasticsearchClient('http://localhost:9200');
    await closeElasticsearchClient();
    expect(() => getElasticsearchClient('http://other:9200')).not.toThrow();
  });
});
