// packages/api/src/services/ftsSearchService.ts
//
// Vault search path: same route contract as the retired
// Elasticsearch query, served from the in-database FTS5 indexes. Excerpts
// carry `<mark>` highlights over RAW transcript text — the UI must escape
// text nodes before rendering (the old ES path used encoder: html).
import {
  db,
  searchTranscriptsFts,
  searchMessagesFts,
  type FtsTranscriptHit,
  type FtsMessageHit,
} from '@therascript/db';
import type {
  ApiSearchResultItem as UIApiSearchResultItem,
  ApiSearchResponse as UIApiSearchResponse,
} from '@therascript/domain';

export interface FtsSearchParams {
  query: string;
  limit: number;
  from: number;
  clientName?: string;
  searchType?: 'chat' | 'transcript' | 'all';
}

/** bm25 ranks lower-better; ES scores higher-better: negate to preserve order. */
function rankToScore(rank: number | null): number | undefined {
  return rank === null ? undefined : -rank;
}

function highlightsFor(excerpt: string): Record<string, string[]> | undefined {
  return excerpt.includes('<mark>') ? { text: [excerpt] } : undefined;
}

function parseTags(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function mapTranscriptHit(hit: FtsTranscriptHit): UIApiSearchResultItem {
  return {
    id: `${hit.sessionId}_${hit.paragraphId}`,
    type: 'transcript',
    chatId: null,
    sessionId: hit.sessionId,
    sender: null,
    timestamp: hit.timestampMs,
    snippet: hit.excerpt,
    score: rankToScore(hit.rank),
    highlights: highlightsFor(hit.excerpt),
    clientName: hit.clientName,
    tags: null,
  };
}

function mapMessageHit(
  hit: FtsMessageHit
): UIApiSearchResultItem & { rank: number | null } {
  return {
    id: String(hit.messageId),
    type: 'chat',
    chatId: hit.chatId,
    sessionId: hit.sessionId,
    sender: hit.sender as 'user' | 'ai' | 'system',
    timestamp: hit.timestamp,
    snippet: hit.excerpt,
    score: rankToScore(hit.rank),
    highlights: highlightsFor(hit.excerpt),
    clientName: hit.clientName ?? null,
    tags: parseTags(hit.tags),
    rank: hit.rank,
  };
}

export function searchAllFts(params: FtsSearchParams): UIApiSearchResponse {
  const searchType = params.searchType ?? 'all';
  const label =
    params.query || params.clientName
      ? 'Search/filter applied'
      : 'All entries (no query/filter)';

  if (searchType === 'transcript') {
    const { rows, total } = searchTranscriptsFts(db, {
      query: params.query,
      limit: params.limit,
      offset: params.from,
      clientName: params.clientName ?? null,
    });
    return { query: label, results: rows.map(mapTranscriptHit), total };
  }

  if (searchType === 'chat') {
    const { rows, total } = searchMessagesFts(db, {
      query: params.query,
      limit: params.limit,
      offset: params.from,
      clientName: params.clientName ?? null,
    });
    return {
      query: label,
      results: rows.map((hit) => {
        const { rank: _rank, ...item } = mapMessageHit(hit);
        return item;
      }),
      total,
    };
  }

  // 'all': over-fetch from both indexes, merge by bm25 rank (both
  // lower-better; scales differ across tables, so cross-type ordering is
  // approximate — a documented parity gap vs the old ES unified score).
  const window = params.from + params.limit;
  const transcripts = searchTranscriptsFts(db, {
    query: params.query,
    limit: window,
    offset: 0,
    clientName: params.clientName ?? null,
  });
  const messages = searchMessagesFts(db, {
    query: params.query,
    limit: window,
    offset: 0,
    clientName: params.clientName ?? null,
  });
  const merged: Array<{ rank: number | null; item: UIApiSearchResultItem }> = [
    ...transcripts.rows.map((hit) => ({
      rank: hit.rank,
      item: mapTranscriptHit(hit),
    })),
    ...messages.rows.map((hit) => {
      const { rank, ...item } = mapMessageHit(hit);
      return { rank, item };
    }),
  ];
  merged.sort((a, b) => {
    if (a.rank === null && b.rank === null) return 0;
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });
  return {
    query: label,
    results: merged
      .slice(params.from, params.from + params.limit)
      .map((entry) => entry.item),
    total: transcripts.total + messages.total,
  };
}
