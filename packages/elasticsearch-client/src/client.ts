import { Client } from '@elastic/elasticsearch';

let esClientInstance: Client | null = null;

export const getElasticsearchClient = (nodeUrl: string): Client => {
  if (!esClientInstance) {
    try {
      esClientInstance = new Client({
        node: nodeUrl,
        requestTimeout: 10000, // Increased timeout for potentially long operations
        // Consider adding sniffOnStart: true, sniffInterval: 30000 for multi-node clusters
      });
      console.log(
        `[ES Client] Elasticsearch client initialized for node: ${nodeUrl}`
      );
    } catch (error) {
      console.error(
        '[ES Client] Failed to initialize Elasticsearch client:',
        error
      );
      throw new Error('Could not initialize Elasticsearch client.');
    }
  }
  return esClientInstance;
};

export const checkEsHealth = async (client: Client): Promise<boolean> => {
  try {
    const health = await client.cluster.health();
    console.log(
      '[ES Client Health] Elasticsearch cluster health:',
      health.status
    );
    return health.status === 'green' || health.status === 'yellow';
  } catch (error: any) {
    console.error(
      '[ES Client Health] Error checking Elasticsearch health:',
      error.message || error
    );
    return false;
  }
};

export const closeElasticsearchClient = async (): Promise<void> => {
  if (esClientInstance) {
    try {
      await esClientInstance.close();
      console.log('[ES Client] Elasticsearch client closed successfully.');
    } catch (error: any) {
      console.error(
        '[ES Client] Error closing Elasticsearch client:',
        error.message || error
      );
    } finally {
      esClientInstance = null;
    }
  }
};
