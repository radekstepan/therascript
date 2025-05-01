// =========================================
// File: packages/api/src/repositories/chatRepository.ts
// =========================================
/* packages/api/src/repositories/chatRepository.ts */
// Handles Chat entities and FTS Search across messages and transcripts
import { db, exec, run, all, get } from '../db/sqliteService.js';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
} from '../types/index.js';
import { Statement } from 'better-sqlite3';

// Helper to safely parse JSON tags column (unchanged)
const parseTags = (tagsJson: string | null): string[] | null => {
  if (!tagsJson) return null;
  try {
    const parsed = JSON.parse(tagsJson);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
    console.warn(
      `[ChatRepo] Invalid tags JSON found in DB: ${tagsJson}. Returning null.`
    );
    return null;
  } catch (e) {
    console.warn(
      `[ChatRepo] Error parsing tags JSON: ${tagsJson}. Error: ${e}. Returning null.`
    );
    return null;
  }
};

// Define an internal type that represents the raw DB row structure, including the JSON string for tags
type RawChatRow = Omit<BackendChatSession, 'tags' | 'messages'> & {
  tags: string | null;
};

// --- SQL Statements ---
const insertChatSql =
  'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)';
const selectChatsBySessionIdSql =
  'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectStandaloneChatsSql =
  'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId IS NULL ORDER BY timestamp DESC';
// --- Moved Message SQL to messageRepository ---
const selectMessagesByChatIdSql =
  'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC';
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?';
const updateChatDetailsSql = 'UPDATE chats SET name = ?, tags = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';

// --- FTS Search Statement (UPDATED with JOINs for clientName and tags) ---
const searchSql = `
    -- Select from Messages, joining chats and optionally sessions
    SELECT
        m.id,
        'chat' as type,
        m.chatId,
        c.sessionId,
        s.clientName AS clientName, -- Get clientName from sessions if available
        c.tags AS tags, -- Get tags JSON from chats
        m.sender,
        m.timestamp,
        m.text as snippet,
        m.starred,
        m.starredName,
        NULL as paragraphIndex
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.id
    JOIN chats c ON m.chatId = c.id
    LEFT JOIN sessions s ON c.sessionId = s.id -- LEFT JOIN for standalone chats (sessionId is NULL)
    WHERE messages_fts MATCH ?

    UNION ALL

    -- Select from Transcript Paragraphs, joining sessions
    SELECT
        tp.id,
        'transcript' as type,
        NULL as chatId,
        tp.sessionId,
        s.clientName AS clientName, -- Get clientName from sessions
        NULL AS tags, -- Transcripts don't have tags
        NULL as sender,
        tp.timestampMs as timestamp,
        tp.text as snippet,
        NULL as starred,
        NULL as starredName,
        tp.paragraphIndex
    FROM transcript_paragraphs_fts
    JOIN transcript_paragraphs tp ON transcript_paragraphs_fts.rowid = tp.id
    JOIN sessions s ON tp.sessionId = s.id -- Must have a session
    WHERE transcript_paragraphs_fts MATCH ?

    LIMIT ?;
`;
let searchStmt: Statement;
try {
  searchStmt = db.prepare(searchSql);
} catch (e) {
  console.error(
    'FATAL: Failed to prepare combined FTS search statement with joins:',
    e
  );
  throw new Error(
    'Failed to prepare database combined search statement with joins.'
  );
}

// Updated Interface for combined results (add clientName, tags)
export interface FtsSearchResult {
  id: number;
  type: 'chat' | 'transcript';
  chatId: number | null;
  sessionId: number | null;
  clientName: string | null; // Added
  tags: string[] | null; // Added (parsed from JSON)
  sender: 'user' | 'ai' | null;
  timestamp: number;
  snippet: string;
  paragraphIndex?: number | null;
  starred?: number | undefined;
  starredName?: string | null | undefined;
}

// Helper to combine chat row with its messages, parsing tags (unchanged)
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
  try {
    const chatRow = get<RawChatRow>(selectChatByIdSql, chatId);
    if (!chatRow) return null;
    const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
    const tagsArray = parseTags(chatRow.tags);
    const result: BackendChatSession = {
      id: chatRow.id,
      sessionId: chatRow.sessionId ?? null,
      timestamp: chatRow.timestamp,
      name: chatRow.name ?? null,
      tags: tagsArray,
      messages: messages ?? [],
    };
    return result;
  } catch (error) {
    console.error(`DB error fetching chat ${chatId}:`, error);
    throw new Error(`Database error fetching chat ${chatId}.`);
  }
};

// Export the repository object
export const chatRepository = {
  // ... (createChat, addMessage, findChatsBySessionId, findStandaloneChats, etc. remain unchanged) ...
  createChat: (sessionId: number | null): BackendChatSession => {
    const timestamp = Date.now();
    try {
      const info = run(insertChatSql, sessionId, timestamp, null, null); // Pass null for tags initially
      const newChatId = info.lastInsertRowid as number;
      const newChatSession = findChatWithMessages(newChatId);
      if (!newChatSession)
        throw new Error(
          `Failed retrieve chat ${newChatId} immediately after creation.`
        );
      console.log(
        `[ChatRepo] Created ${sessionId ? 'session' : 'standalone'} chat ${newChatId}${sessionId ? ' in session ' + sessionId : ''}`
      );
      return newChatSession;
    } catch (error) {
      console.error(
        `DB error creating chat ${sessionId ? `for session ${sessionId}` : '(standalone)'}:`,
        error
      );
      throw new Error(
        `Database error creating chat: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  // --- Moved addMessage, findMessagesByChatId, findMessageById, updateMessageStarStatus, findStarredMessages to messageRepository ---
  findChatsBySessionId: (
    sessionId: number
  ): (ChatMetadata & { sessionId: number })[] => {
    try {
      const chatRows = all<RawChatRow>(selectChatsBySessionIdSql, sessionId);
      return chatRows.map((chat) => ({
        id: chat.id,
        sessionId: chat.sessionId as number,
        timestamp: chat.timestamp,
        name: chat.name ?? null,
        tags: parseTags(chat.tags),
      }));
    } catch (error) {
      console.error(`DB error fetching chats for session ${sessionId}:`, error);
      throw new Error(`Database error fetching chats.`);
    }
  },
  findStandaloneChats: (): (ChatMetadata & { sessionId: null })[] => {
    try {
      const chatRows = all<RawChatRow>(selectStandaloneChatsSql);
      return chatRows.map((chat) => ({
        id: chat.id,
        sessionId: null,
        timestamp: chat.timestamp,
        name: chat.name ?? null,
        tags: parseTags(chat.tags),
      }));
    } catch (error) {
      console.error(`DB error fetching standalone chats:`, error);
      throw new Error(`Database error fetching standalone chats.`);
    }
  },
  findChatById: (chatId: number): BackendChatSession | null => {
    return findChatWithMessages(chatId);
  },
  updateChatDetails: (
    chatId: number,
    name: string | null,
    tags: string[] | null
  ): ChatMetadata | null => {
    // Takes sorted tags
    try {
      const tagsJson = tags && tags.length > 0 ? JSON.stringify(tags) : null;
      run(updateChatDetailsSql, name, tagsJson, chatId);
      const updatedChatSession = findChatWithMessages(chatId);
      if (!updatedChatSession) return null;
      const { messages, ...metadata } = updatedChatSession;
      return metadata;
    } catch (error) {
      console.error(`DB error updating details for chat ${chatId}:`, error);
      throw new Error(`Database error updating chat details.`);
    }
  },
  deleteChatById: (chatId: number): boolean => {
    try {
      const info = run(deleteChatSql, chatId);
      return info.changes > 0;
    } catch (error) {
      console.error(`DB error deleting chat ${chatId}:`, error);
      throw new Error(`Database error deleting chat.`);
    }
  },
  // --- FTS Search Function (UPDATED mapping logic) ---
  searchMessages: (query: string, limit: number = 20): FtsSearchResult[] => {
    const trimmedQuery = query?.trim() ?? '';
    if (!trimmedQuery) {
      return [];
    }

    // Process query for FTS5 syntax (unchanged)
    const tokens = trimmedQuery.split(/\s+/);
    const processedTokens = tokens
      .map((token) => {
        let processed = token.trim().replace(/^\*+/, '');
        if (!processed || /^[\\*"'()+\-^!&|<>=\s]+$/.test(processed)) {
          console.log(
            `[ChatRepo:searchMessages] Filtering out potentially problematic token: "${token}" -> "${processed}"`
          );
          return null;
        }
        processed = processed.replace(/"/g, '""');
        return `"${processed}*"`;
      })
      .filter((token): token is string => token !== null);

    if (processedTokens.length === 0) {
      console.log(
        `[ChatRepo:searchMessages] No valid search tokens derived from query: "${query}"`
      );
      return [];
    }

    const ftsQuery = processedTokens.join(' ');
    const integerLimit = Math.floor(limit);

    console.log(
      `[ChatRepo:searchMessages] Executing combined FTS query: '${ftsQuery}', LIMIT: ${integerLimit}`
    );
    try {
      // Execute the UNION query, passing the query term twice
      const results = searchStmt.all(ftsQuery, ftsQuery, integerLimit);
      console.log(
        `[ChatRepo:searchMessages] Found ${results.length} combined results.`
      );

      // Map results to ensure correct types, INCLUDING parsing tags
      return (results as any[]).map((row) => ({
        id: row.id,
        type: row.type, // 'chat' or 'transcript'
        chatId: row.chatId ?? null,
        sessionId: row.sessionId ?? null,
        clientName: row.clientName ?? null, // Added clientName
        tags: parseTags(row.tags), // Added parsed tags
        sender: row.sender ?? null,
        timestamp: row.timestamp,
        snippet: row.snippet,
        paragraphIndex: row.paragraphIndex ?? null,
        starred: row.starred,
        starredName: row.starredName,
      }));
    } catch (error) {
      console.error(
        `DB error searching combined messages/transcripts with FTS query '${ftsQuery}' derived from original query "${query}":`,
        error
      );
      if (
        error instanceof Error &&
        (error.message.includes('malformed MATCH expression') ||
          error.message.includes('fts5: syntax error'))
      ) {
        throw new Error(
          `Database FTS query syntax error for query: "${query}". Processed FTS query: '${ftsQuery}'`
        );
      }
      throw new Error(
        `Database error searching messages/transcripts: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },
  // TODO comments should not be removed
};
