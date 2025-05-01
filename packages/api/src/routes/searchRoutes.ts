// =========================================
// File: packages/api/src/routes/searchRoutes.ts
// =========================================
import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
// --- Import updated search result type ---
import type { FtsSearchResult } from '../repositories/chatRepository.js';
import { InternalServerError, BadRequestError } from '../errors.js';

// --- Schemas ---
const SearchQuerySchema = t.Object({
  q: t.String({ minLength: 1, error: "Search query 'q' is required." }),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
});

// --- UPDATED Schema for response item (add clientName, tags) ---
const SearchResultItemSchema = t.Object({
  // Use paragraphIndex as ID for transcripts, message ID for chats
  id: t.Number(),
  type: t.Union([t.Literal('chat'), t.Literal('transcript')]), // Added type
  chatId: t.Union([t.Number(), t.Null()]), // Nullable for transcripts
  sessionId: t.Union([t.Number(), t.Null()]), // Nullable for standalone chats
  sender: t.Union([t.Literal('user'), t.Literal('ai'), t.Null()]), // Nullable for transcripts
  timestamp: t.Number(),
  snippet: t.String(), // Contains full text now
  rank: t.Number(), // Index-based rank
  clientName: t.Optional(t.Union([t.String(), t.Null()])), // Added clientName
  tags: t.Optional(t.Union([t.Array(t.String()), t.Null()])), // Added tags
});

const SearchResponseSchema = t.Object({
  query: t.String(),
  results: t.Array(SearchResultItemSchema), // Use updated item schema
});

export const searchRoutes = new Elysia({ prefix: '/api/search' })
  .model({
    searchQuery: SearchQuerySchema,
    searchResultItem: SearchResultItemSchema,
    searchResponse: SearchResponseSchema,
  })
  .group('', { detail: { tags: ['Search'] } }, (app) =>
    app.get(
      '/',
      async ({ query, set }) => {
        const searchQuery = query.q;
        const limit = Math.floor(query.limit ?? 20);

        console.log(
          `[API Search] Received search request: query="${searchQuery}", limit=${limit} (integer)`
        );

        try {
          // Results now include 'clientName' and 'tags'
          const results: FtsSearchResult[] = chatRepository.searchMessages(
            searchQuery,
            limit
          );

          // Map results based on type, ensuring clientName and tags are passed through
          const responseResults = results.map(
            (r: FtsSearchResult, index: number) => ({
              id: r.type === 'transcript' ? (r.paragraphIndex ?? -1) : r.id,
              type: r.type,
              chatId: r.chatId,
              sessionId: r.sessionId,
              clientName: r.clientName, // Pass clientName
              tags: r.tags, // Pass tags
              sender: r.sender,
              timestamp: r.timestamp,
              snippet: r.snippet,
              rank: index + 1,
            })
          );

          set.status = 200;
          return {
            query: searchQuery,
            results: responseResults,
          };
        } catch (error: any) {
          console.error(
            `[API Search] Error searching messages/transcripts with query "${searchQuery}":`,
            error
          );
          if (
            error instanceof Error &&
            error.message.includes('FTS query syntax error')
          ) {
            throw new BadRequestError(error.message);
          }
          throw new InternalServerError(
            'Failed to perform search',
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
          summary: 'Search chat messages and transcript paragraphs',
          description:
            'Performs a full-text search across message and transcript content. Returns relevant messages and paragraphs including associated client name and tags (if applicable).', // Updated description
        },
      }
    )
  );
// TODO comments should not be removed
