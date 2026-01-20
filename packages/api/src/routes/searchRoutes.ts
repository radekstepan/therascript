// Corrected file: packages/api/src/routes/searchRoutes.ts
import { Elysia, t } from 'elysia';
import { errors as esErrors, estypes } from '@elastic/elasticsearch';
const { ElasticsearchClientError, ResponseError } = esErrors;

type SearchHit<T> = estypes.SearchHit<T>;
type SearchResponse<T> = estypes.SearchResponse<T>;

import {
  getElasticsearchClient,
  MESSAGES_INDEX,
  TRANSCRIPTS_INDEX,
  type TranscriptSource,
  type MessageSource,
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';
import { InternalServerError, BadRequestError } from '../errors.js';
import type {
  ApiSearchResultItem as UIApiSearchResultItem,
  ApiSearchResponse as UIApiSearchResponse,
} from '@therascript/domain';

const SearchQuerySchema = t.Object({
  q: t.String({
    default: '',
    description:
      'The main search query string. Can be empty if only filters are used.',
  }),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  from: t.Optional(t.Numeric({ minimum: 0, default: 0 })),
  clientName: t.Optional(t.String()),
  searchType: t.Optional(
    t.Union([t.Literal('chat'), t.Literal('transcript'), t.Literal('all')])
  ),
});

const SearchResultHighlightSchema = t.Record(t.String(), t.Array(t.String()));

const SearchResultItemSchema = t.Object({
  id: t.Union([t.String(), t.Number()]),
  type: t.Union([t.Literal('chat'), t.Literal('transcript')]),
  chatId: t.Optional(t.Union([t.Number(), t.Null()])),
  sessionId: t.Optional(t.Union([t.Number(), t.Null()])),
  sender: t.Optional(
    t.Union([t.Literal('user'), t.Literal('ai'), t.Literal('system'), t.Null()]) // <-- THE FIX IS HERE
  ),
  timestamp: t.Number(),
  snippet: t.String(),
  score: t.Optional(t.Number()),
  highlights: t.Optional(SearchResultHighlightSchema),
  clientName: t.Optional(t.Union([t.String(), t.Null()])),
  tags: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
});

const SearchResponseSchema = t.Object({
  query: t.String(),
  results: t.Array(SearchResultItemSchema),
  total: t.Number(),
});

export const searchRoutes = new Elysia({ prefix: '/api/search' })
  .decorate('esClient', getElasticsearchClient(config.elasticsearch.url))
  .model({
    searchQuery: SearchQuerySchema,
    searchResultItem: SearchResultItemSchema,
    searchResponse: SearchResponseSchema,
  })
  .group('', { detail: { tags: ['Search'] } }, (app) =>
    app.get(
      '/',
      async ({ query, set, esClient }) => {
        const searchQuery = query.q || '';
        const limit = Math.floor(query.limit ?? 20);
        const from = Math.floor(query.from ?? 0);

        if (!searchQuery && !query.clientName) {
          set.status = 200;
          return {
            query: 'No query or filters provided',
            results: [],
            total: 0,
          };
        }

        console.log(
          `[API ES Search] Query="${searchQuery}", Limit=${limit}, From=${from}, Type=${query.searchType}, Client=${query.clientName}`
        );

        const esQueryBody: Record<string, any> = {
          from,
          size: limit,
          query: {
            bool: {
              must: [],
              filter: [],
            },
          },
          highlight: {
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
            fields: {
              // Highlights will primarily come from the 'text' field, not 'text.stem'
              text: {
                number_of_fragments: 1,
                fragment_size: 200,
                no_match_size: 200,
              },
              session_name: { number_of_fragments: 0 },
              client_name: { number_of_fragments: 0 },
              chat_name: { number_of_fragments: 0 },
            },
            encoder: 'html',
          },
          _source: true,
          sort: [{ _score: { order: 'desc' } }],
        };

        if (searchQuery) {
          (esQueryBody.query.bool.must as any[]).push({
            multi_match: {
              query: searchQuery,
              fields: [
                'text^3', // Original text field for exact/standard matches
                'text.stem^3', // Stemmed sub-field for stemmed matches (same boost)
                'session_name^2',
                'client_name^2',
                'chat_name^1.5',
              ],
              fuzziness: 'AUTO', // Fuzziness will apply to terms searched against both text and text.stem
              type: 'best_fields',
            },
          });
        } else {
          (esQueryBody.query.bool.must as any[]).push({ match_all: {} });
        }

        if (query.clientName) {
          (esQueryBody.query.bool.filter as any[]).push({
            term: { 'client_name.keyword': query.clientName },
          });
        }

        let targetIndices: string[] | undefined = undefined;
        if (query.searchType === 'chat') {
          targetIndices = [MESSAGES_INDEX];
        } else if (query.searchType === 'transcript') {
          targetIndices = [TRANSCRIPTS_INDEX];
        } else if (query.searchType === 'all' || !query.searchType) {
          targetIndices = [MESSAGES_INDEX, TRANSCRIPTS_INDEX];
        }

        try {
          const esResponse: SearchResponse<TranscriptSource | MessageSource> =
            await esClient.search({
              index: targetIndices,
              body: esQueryBody,
            });

          const results: UIApiSearchResultItem[] = esResponse.hits.hits
            .map((hit: SearchHit<TranscriptSource | MessageSource>) => {
              const source = hit._source;
              if (!source) {
                console.warn(`[API ES Search] Hit ${hit._id} missing _source.`);
                const itemTypeWhenSourceMissing: 'transcript' | 'chat' =
                  hit._index === TRANSCRIPTS_INDEX ? 'transcript' : 'chat';
                return {
                  id: hit._id || `unknown_${Date.now()}`,
                  type: itemTypeWhenSourceMissing,
                  chatId: null,
                  sessionId: null,
                  sender: null,
                  timestamp: 0,
                  snippet: 'Source data unavailable',
                  score: hit._score || undefined,
                  highlights: hit.highlight as
                    | Record<string, string[]>
                    | undefined,
                  clientName: null,
                  tags: null,
                };
              }

              const isTranscript = hit._index === TRANSCRIPTS_INDEX;
              let displaySnippet =
                (source as any).text?.substring(0, 300) || '';
              // Highlights usually come from the main 'text' field, not 'text.stem'
              if (
                hit.highlight &&
                hit.highlight.text &&
                hit.highlight.text.length > 0
              ) {
                displaySnippet = hit.highlight.text.join(' ... ');
              }

              const itemType: 'transcript' | 'chat' = isTranscript
                ? 'transcript'
                : 'chat';

              return {
                id: isTranscript
                  ? `${(source as TranscriptSource).session_id}_${(source as TranscriptSource).paragraph_index}`
                  : (source as MessageSource).message_id,
                type: itemType,
                chatId: isTranscript ? null : (source as MessageSource).chat_id,
                sessionId:
                  (source as TranscriptSource | MessageSource).session_id ??
                  null,
                clientName:
                  (source as TranscriptSource | MessageSource).client_name ??
                  null,
                tags: isTranscript
                  ? null
                  : ((source as MessageSource).tags ?? null),
                sender: isTranscript ? null : (source as MessageSource).sender,
                timestamp: isTranscript
                  ? (source as TranscriptSource).timestamp_ms!
                  : (source as MessageSource).timestamp!,
                snippet: displaySnippet,
                score: hit._score || undefined,
                highlights: hit.highlight as
                  | Record<string, string[]>
                  | undefined,
              };
            })
            .filter((item) => item.snippet !== 'Source data unavailable');

          set.status = 200;
          const totalHits =
            typeof esResponse.hits.total === 'number'
              ? esResponse.hits.total
              : esResponse.hits.total?.value || 0;
          return {
            query:
              searchQuery || query.clientName
                ? `Search/filter applied`
                : 'All entries (no query/filter)',
            results: results,
            total: totalHits,
          };
        } catch (error: any) {
          if (error instanceof ResponseError) {
            const errorBody = error.meta.body as any;
            console.error(
              `[API ES Search] Elasticsearch Response Error for query "${searchQuery}":`,
              errorBody || error.message
            );
            if (
              errorBody?.error?.type === 'query_shard_exception' ||
              errorBody?.error?.type === 'search_phase_execution_exception'
            ) {
              throw new BadRequestError(
                `Search query syntax error or invalid field: ${errorBody.error.reason || 'Error processing query'}`
              );
            }
            throw new InternalServerError(
              'Elasticsearch search operation failed.',
              error
            );
          } else if (error instanceof ElasticsearchClientError) {
            console.error(
              `[API ES Search] Elasticsearch Client Error (not ResponseError) for query "${searchQuery}":`,
              error.message
            );
            throw new InternalServerError(
              'Elasticsearch client operation failed.',
              error
            );
          }
          console.error(
            `[API ES Search] General Error for query "${searchQuery}":`,
            error
          );
          throw new InternalServerError(
            'Search failed due to an unexpected error.',
            error instanceof Error ? error : undefined
          );
        }
      },
      {
        query: 'searchQuery',
        response: {
          200: 'searchResponse',
          400: t.Object({
            error: t.String(),
            message: t.String(),
            details: t.Optional(t.Any()),
          }),
          500: t.Object({
            error: t.String(),
            message: t.String(),
            details: t.Optional(t.Any()),
          }),
        },
        detail: {
          summary:
            'Search chat messages and transcript paragraphs via Elasticsearch',
          description:
            'Performs full-text search using Elasticsearch. Returns results with highlights and relevance scores. Supports filtering by clientName and type (chat/transcript/all).',
        },
      }
    )
  );
