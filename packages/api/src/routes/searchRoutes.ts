// packages/api/src/routes/searchRoutes.ts
import { Elysia, t } from 'elysia';
import { chatRepository } from '../repositories/chatRepository.js';
// Import type without rank (snippet is now full text)
import type { FtsSearchResult } from '../repositories/chatRepository.js';
import { InternalServerError, BadRequestError } from '../errors.js';

// --- Schemas ---
const SearchQuerySchema = t.Object({
    q: t.String({ minLength: 1, error: "Search query 'q' is required." }),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 }))
});

// Schema for response item (UI expects rank, snippet)
const SearchResultItemSchema = t.Object({
    id: t.Number(),
    chatId: t.Number(),
    sessionId: t.Union([t.Number(), t.Null()]),
    sender: t.Union([t.Literal('user'), t.Literal('ai')]),
    timestamp: t.Number(),
    snippet: t.String(), // Keep snippet, it will contain full text now
    rank: t.Number()
});

const SearchResponseSchema = t.Object({
    query: t.String(),
    results: t.Array(SearchResultItemSchema),
});

export const searchRoutes = new Elysia({ prefix: '/api/search' })
    .model({
        searchQuery: SearchQuerySchema,
        searchResultItem: SearchResultItemSchema,
        searchResponse: SearchResponseSchema,
    })
    .group('', { detail: { tags: ['Search'] } }, (app) => app
        .get('/', async ({ query, set }) => {
            const searchQuery = query.q;
            const limit = Math.floor(query.limit ?? 20);

            console.log(`[API Search] Received search request: query="${searchQuery}", limit=${limit} (integer)`);

            try {
                // Results now don't have rank/snippet from the repo
                const results: FtsSearchResult[] = chatRepository.searchMessages(searchQuery, limit);

                // Map results - rank is index, snippet is original text
                const responseResults = results.map((r: FtsSearchResult, index: number) => ({
                    id: r.id,
                    chatId: r.chatId,
                    sessionId: r.sessionId,
                    sender: r.sender as 'user' | 'ai',
                    timestamp: r.timestamp,
                    snippet: r.snippet, // This now contains the original text from the DB query
                    rank: index + 1,
                }));

                set.status = 200;
                return {
                    query: searchQuery,
                    results: responseResults,
                };
            } catch (error: any) {
                console.error(`[API Search] Error searching messages with query "${searchQuery}":`, error);
                throw new InternalServerError('Failed to perform search', error instanceof Error ? error : undefined);
            }
        }, {
            query: 'searchQuery',
            response: {
                200: 'searchResponse',
                400: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) }),
                500: t.Object({ error: t.String(), message: t.String(), details: t.Optional(t.Any()) })
            },
            detail: {
                summary: 'Search chat messages using Full-Text Search',
                description: 'Performs a full-text search across message content. Returns relevant messages (NOT ORDERED BY RELEVANCE), with full text content.', // Updated description
            }
        })
    );
