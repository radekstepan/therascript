# @therascript/elasticsearch-client — Developer Notes

Purpose: Shared Elasticsearch client, index mappings, and helpers for indexing/search.

## Key files
- Client singleton: `src/client.ts`
- Mappings: `src/mappings.ts` (TRANSCRIPTS_INDEX, MESSAGES_INDEX)
- Utils: `src/searchUtils.ts` (initializeIndices, bulk index, index/delete, deleteByQuery)

## Build
- Build: `yarn build`

## Usage
- API initializes indices on startup via `initializeIndices`
- Worker uses `bulkIndexDocuments` and `indexDocument` for transcripts/messages

## Gotchas
- Health checks are non-fatal; services should handle ES being down gracefully