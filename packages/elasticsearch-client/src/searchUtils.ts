// File: packages/elasticsearch-client/src/searchUtils.ts
import { Client, errors as esErrors } from '@elastic/elasticsearch'; // Added esErrors
const { ResponseError } = esErrors; // Destructure for easier use

import {
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
  transcriptsIndexMapping,
  messagesIndexMapping,
} from './mappings.js';

// Define interfaces for the _source part of our documents, these will be exported
export interface TranscriptSource {
  paragraph_id: string;
  session_id: number;
  paragraph_index: number;
  text: string;
  timestamp_ms: number;
  client_name?: string | null;
  session_name?: string | null;
  session_date?: string;
  session_type?: string;
  therapy_type?: string;
}

export interface MessageSource {
  message_id: string;
  chat_id: number;
  session_id?: number | null;
  sender: 'user' | 'ai' | 'system'; // <-- THE FIX IS HERE
  text: string;
  timestamp: number; // epoch_millis
  chat_name?: string | null;
  tags?: string[] | null;
  client_name?: string | null;
  session_name?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

// Simplified SearchHit structure focusing on what we use
export interface SimplifiedSearchHit<TSource> {
  _index: string;
  _id: string | undefined;
  _score?: number | null;
  _source?: TSource;
  highlight?: Record<string, string[]>;
}

// Simplified SearchResponse structure
export interface SimplifiedSearchResponse<TSource> {
  hits: {
    total?: { value: number; relation: string } | number;
    max_score?: number | null;
    hits: Array<SimplifiedSearchHit<TSource>>;
  };
}

export async function ensureIndexExists(
  client: Client,
  indexName: string,
  mapping: object
) {
  try {
    const indexExists: boolean = await client.indices.exists({
      index: indexName,
    });

    if (!indexExists) {
      console.log(
        `[ES Utils] Index "${indexName}" does not exist. Creating...`
      );
      try {
        await client.indices.create({
          index: indexName,
          body: mapping,
        });
        console.log(`[ES Utils] Index "${indexName}" created successfully.`);
      } catch (creationError: any) {
        // MODIFICATION: More detailed error logging and re-throw non-concurrency errors
        const isResponseError = creationError instanceof ResponseError;
        const esErrorBody = isResponseError
          ? (creationError.meta.body as any)
          : null;

        console.error(
          `[ES Utils] Error creating index "${indexName}":`,
          esErrorBody || creationError.message || creationError
        );

        // If it's a resource_already_exists_exception, it means another process/thread created it.
        // This is an acceptable race condition.
        if (
          isResponseError &&
          esErrorBody?.error?.type === 'resource_already_exists_exception'
        ) {
          console.warn(
            `[ES Utils] Index "${indexName}" was likely created concurrently by another process. Proceeding.`
          );
        } else {
          // For any other error during creation, re-throw it to signal a failure.
          // This will allow the retry loop in server.ts to catch it.
          console.error(
            `[ES Utils] Failed to create index "${indexName}" due to an unexpected error. Re-throwing.`
          );
          throw creationError;
        }
      }
    } else {
      console.log(`[ES Utils] Index "${indexName}" already exists.`);
    }
  } catch (error: any) {
    // Catch errors from client.indices.exists or re-thrown creation errors
    console.error(
      `[ES Utils] General error in ensureIndexExists for "${indexName}":`,
      error.message || error
    );
    throw error; // Re-throw to allow higher-level retries
  }
}

export async function initializeIndices(client: Client) {
  console.log('[ES Utils] Initializing Elasticsearch indices...');
  await ensureIndexExists(client, TRANSCRIPTS_INDEX, transcriptsIndexMapping);
  await ensureIndexExists(client, MESSAGES_INDEX, messagesIndexMapping);
  console.log('[ES Utils] Elasticsearch indices initialization complete.');
}

export async function deleteIndex(client: Client, indexName: string) {
  try {
    const indexExists: boolean = await client.indices.exists({
      index: indexName,
    });
    if (indexExists) {
      console.log(`[ES Utils] Deleting index "${indexName}"...`);
      await client.indices.delete({ index: indexName });
      console.log(`[ES Utils] Index "${indexName}" deleted.`);
    } else {
      console.log(
        `[ES Utils] Index "${indexName}" not found, skipping deletion.`
      );
    }
  } catch (error) {
    console.error(`[ES Utils] Error deleting index "${indexName}":`, error);
  }
}

export async function bulkIndexDocuments<T extends Record<string, any>>(
  client: Client,
  indexName: string,
  documents: Array<{ id: string; document: T }>
): Promise<void> {
  if (documents.length === 0) {
    console.log(
      `[ES Utils BulkIndex] No documents to index into "${indexName}".`
    );
    return;
  }
  const operations = documents.flatMap((doc) => [
    { index: { _index: indexName, _id: doc.id } },
    doc.document,
  ]);
  try {
    const bulkResponse = await client.bulk({ refresh: true, operations });
    if (bulkResponse.errors) {
      const erroredDocuments: {
        status?: number;
        error?: any;
        operation?: any;
        document?: any;
      }[] = [];
      bulkResponse.items.forEach((actionItem, i) => {
        const operationType = Object.keys(
          actionItem
        )[0] as keyof typeof actionItem;
        const actionResult = actionItem[operationType];
        if (actionResult && actionResult.error) {
          erroredDocuments.push({
            status: actionResult.status,
            error: actionResult.error,
            operation: operations[i * 2],
            document: operations[i * 2 + 1],
          });
        }
      });
      console.error(
        '[ES Utils BulkIndex] Errors encountered:',
        JSON.stringify(erroredDocuments, null, 2)
      );
      throw new Error('Bulk indexing failed for some documents.');
    }
    console.log(
      `[ES Utils BulkIndex] Successfully indexed ${documents.length} documents into "${indexName}".`
    );
  } catch (err) {
    console.error(
      `[ES Utils BulkIndex] Error during bulk indexing to "${indexName}":`,
      err
    );
    throw err;
  }
}

export async function indexDocument<T extends Record<string, any>>(
  client: Client,
  indexName: string,
  id: string,
  documentPayload: T
): Promise<void> {
  try {
    await client.index({
      index: indexName,
      id: id,
      document: documentPayload,
      refresh: true,
    });
  } catch (error) {
    console.error(
      `[ES Utils IndexDoc] Error indexing document ${id} in "${indexName}":`,
      error
    );
    throw error;
  }
}

export async function deleteDocument(
  client: Client,
  indexName: string,
  id: string
): Promise<void> {
  try {
    await client.delete({
      index: indexName,
      id: id,
      refresh: true,
    });
  } catch (error: any) {
    // MODIFICATION: Check for ResponseError specifically for statusCode
    if (error instanceof ResponseError && error.meta.statusCode === 404) {
      console.warn(
        `[ES Utils DeleteDoc] Document ${id} not found in "${indexName}" for deletion.`
      );
      return;
    }
    console.error(
      `[ES Utils DeleteDoc] Error deleting document ${id} from "${indexName}":`,
      error
    );
    throw error;
  }
}

export async function deleteByQuery(
  client: Client,
  indexName: string,
  queryDSL: Record<string, any>
): Promise<void> {
  try {
    const response = await client.deleteByQuery({
      index: indexName,
      body: { query: queryDSL },
      refresh: true,
      conflicts: 'proceed',
    });
    console.log(
      `[ES Utils DeleteByQuery] Delete by query on "${indexName}" completed. Deleted: ${response.deleted}, Failures: ${response.failures?.length}`
    );
    if (response.failures && response.failures.length > 0) {
      console.warn(
        `[ES Utils DeleteByQuery] Failures during delete by query on "${indexName}":`,
        response.failures
      );
    }
  } catch (error: any) {
    // MODIFICATION: Check for ResponseError for meta.body access
    const errorBody = error instanceof ResponseError ? error.meta.body : null;
    console.error(
      `[ES Utils DeleteByQuery] Error deleting by query from "${indexName}":`,
      errorBody || error
    );
    throw error;
  }
}
