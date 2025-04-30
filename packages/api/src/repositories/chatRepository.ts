/* packages/api/src/repositories/chatRepository.ts */
import { db, exec, run, all, get } from '../db/sqliteService.js';
import type { BackendChatSession, BackendChatMessage, ChatMetadata } from '../types/index.js';
import { Statement } from 'better-sqlite3';

// Helper to safely parse JSON tags column
const parseTags = (tagsJson: string | null): string[] | null => {
    if (!tagsJson) return null;
    try {
        const parsed = JSON.parse(tagsJson);
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
            return parsed;
        }
        console.warn(`[ChatRepo] Invalid tags JSON found in DB: ${tagsJson}. Returning null.`);
        return null;
    } catch (e) {
        console.warn(`[ChatRepo] Error parsing tags JSON: ${tagsJson}. Error: ${e}. Returning null.`);
        return null;
    }
};

// Define an internal type that represents the raw DB row structure, including the JSON string for tags
type RawChatRow = Omit<BackendChatSession, 'tags' | 'messages'> & { tags: string | null };

// --- SQL Statements ---
const insertChatSql = 'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)';
const insertMessageSql = `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const selectChatsBySessionIdSql = 'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectStandaloneChatsSql = 'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId IS NULL ORDER BY timestamp DESC';
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC';
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?';
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateChatDetailsSql = 'UPDATE chats SET name = ?, tags = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';
const updateMessageStarStatusSql = 'UPDATE messages SET starred = ?, starredName = ? WHERE id = ?';
const selectStarredMessagesSql = 'SELECT * FROM messages WHERE starred = 1 ORDER BY timestamp DESC';


// --- FTS Search Statement (UPDATED for UNION ALL) ---
// Combine results from messages and transcript paragraphs
const searchSql = `
    -- Select from Messages
    SELECT
        m.id,
        'chat' as type,
        m.chatId,
        c.sessionId,
        m.sender,
        m.timestamp,
        m.text as snippet, -- Use original text as snippet
        m.starred,
        m.starredName,
        NULL as paragraphIndex -- Placeholder for paragraph index
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.id
    JOIN chats c ON m.chatId = c.id
    WHERE messages_fts MATCH ?

    UNION ALL

    -- Select from Transcript Paragraphs
    SELECT
        tp.id,
        'transcript' as type,
        NULL as chatId, -- No chatId for paragraphs
        tp.sessionId,
        NULL as sender, -- No sender for paragraphs
        tp.timestampMs as timestamp, -- Use paragraph timestamp
        tp.text as snippet, -- Use original text as snippet
        NULL as starred, -- No starring for paragraphs
        NULL as starredName,
        tp.paragraphIndex -- Include paragraph index
    FROM transcript_paragraphs_fts
    JOIN transcript_paragraphs tp ON transcript_paragraphs_fts.rowid = tp.id
    WHERE transcript_paragraphs_fts MATCH ?

    -- TODO: Add relevance ordering later if possible (e.g., using BM25 scores if switching FTS implementation)
    -- For now, limit the combined results
    LIMIT ?;
`;
let searchStmt: Statement;
try {
    searchStmt = db.prepare(searchSql);
} catch (e) {
    console.error("FATAL: Failed to prepare combined FTS search statement:", e);
    throw new Error("Failed to prepare database combined search statement.");
}

// Updated Interface for combined results
export interface FtsSearchResult {
    id: number; // message.id or paragraph.id (DB primary key)
    type: 'chat' | 'transcript';
    chatId: number | null;
    sessionId: number | null;
    sender: 'user' | 'ai' | null;
    timestamp: number;
    snippet: string;
    paragraphIndex?: number | null; // paragraphIndex can be null for chat results
    starred?: number | undefined;
    starredName?: string | null | undefined;
}


// Helper to combine chat row with its messages, parsing tags
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
    // ... (other methods remain unchanged) ...
    createChat: (sessionId: number | null): BackendChatSession => {
        const timestamp = Date.now();
        try {
            const info = run(insertChatSql, sessionId, timestamp, null, null);
            const newChatId = info.lastInsertRowid as number;
            const newChatSession = findChatWithMessages(newChatId);
            if (!newChatSession) throw new Error(`Failed retrieve chat ${newChatId} immediately after creation.`);
            console.log(`[ChatRepo] Created ${sessionId ? 'session' : 'standalone'} chat ${newChatId}${sessionId ? ' in session ' + sessionId : ''}`);
            return newChatSession;
        } catch (error) {
            console.error(`DB error creating chat ${sessionId ? `for session ${sessionId}` : '(standalone)'}:`, error);
            throw new Error(`Database error creating chat: ${error instanceof Error ? error.message : String(error)}`);
        }
    },
    addMessage: ( chatId: number, sender: 'user' | 'ai', text: string, promptTokens?: number | null, completionTokens?: number | null ): BackendChatMessage => {
        const timestamp = Date.now();
         try {
            // The insertMessage trigger (messages_ai) should automatically update messages_fts
            const info = run( insertMessageSql, chatId, sender, text, timestamp, promptTokens ?? null, completionTokens ?? null, 0, null );
            const newId = info.lastInsertRowid as number;
            const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
            if(!newMsg) throw new Error("Failed retrieve msg");
            console.log(`[ChatRepo AddMessage] Inserted message ${newId}. FTS trigger should have fired.`);
            return newMsg;
         } catch (error) { console.error(`DB error adding message to chat ${chatId}:`, error); throw new Error("DB error adding message"); }
    },
    findChatsBySessionId: (sessionId: number): (ChatMetadata & { sessionId: number })[] => {
        try {
            const chatRows = all<RawChatRow>(selectChatsBySessionIdSql, sessionId);
            return chatRows.map(chat => ({
                id: chat.id,
                sessionId: chat.sessionId as number,
                timestamp: chat.timestamp,
                name: chat.name ?? null,
                tags: parseTags(chat.tags)
            }));
        } catch (error) { console.error(`DB error fetching chats for session ${sessionId}:`, error); throw new Error(`Database error fetching chats.`); }
    },
    findStandaloneChats: (): (ChatMetadata & { sessionId: null })[] => {
        try {
            const chatRows = all<RawChatRow>(selectStandaloneChatsSql);
            return chatRows.map(chat => ({
                id: chat.id,
                sessionId: null,
                timestamp: chat.timestamp,
                name: chat.name ?? null,
                tags: parseTags(chat.tags)
            }));
        } catch (error) { console.error(`DB error fetching standalone chats:`, error); throw new Error(`Database error fetching standalone chats.`); }
    },
    findChatById: (chatId: number): BackendChatSession | null => {
        return findChatWithMessages(chatId);
    },
    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
        try {
            const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
            return messages ?? [];
        } catch (error) { console.error(`DB error fetching messages for chat ${chatId}:`, error); throw new Error(`Database error fetching messages.`); }
    },
    findMessageById: (messageId: number): BackendChatMessage | null => {
        try {
            const messageRow = get<BackendChatMessage>(selectMessageByIdSql, messageId);
            return messageRow ?? null;
        } catch (error) { console.error(`DB error fetching message ${messageId}:`, error); throw new Error(`Database error fetching message.`); }
    },
    updateChatDetails: (chatId: number, name: string | null, tags: string[] | null): ChatMetadata | null => {
        try {
            const tagsJson = (tags && tags.length > 0) ? JSON.stringify(tags) : null;
            run(updateChatDetailsSql, name, tagsJson, chatId);
            const updatedChatSession = findChatWithMessages(chatId);
            if (!updatedChatSession) return null;
            const { messages, ...metadata } = updatedChatSession;
            return metadata;
        } catch (error) { console.error(`DB error updating details for chat ${chatId}:`, error); throw new Error(`Database error updating chat details.`); }
    },
    deleteChatById: (chatId: number): boolean => {
        try { const info = run(deleteChatSql, chatId); return info.changes > 0; }
        catch (error) { console.error(`DB error deleting chat ${chatId}:`, error); throw new Error(`Database error deleting chat.`); }
    },
    updateMessageStarStatus: ( messageId: number, starred: boolean, starredName?: string | null ): BackendChatMessage | null => {
        try { const nameToSave = starred ? (starredName ?? null) : null; const starredIntValue = starred ? 1 : 0; const info = run(updateMessageStarStatusSql, starredIntValue, nameToSave, messageId); if (info.changes === 0) { console.warn(`[ChatRepo] No message found with ID ${messageId} to update star status.`); return null; } const updatedMessage = get<BackendChatMessage>(selectMessageByIdSql, messageId); if (!updatedMessage) { console.error(`[ChatRepo] CRITICAL: Failed to retrieve message ${messageId} immediately after star update.`); return null; } return updatedMessage; } catch (error) { console.error(`DB error updating star status for message ${messageId}:`, error); throw new Error(`Database error updating message star status.`); }
    },
    findStarredMessages: (): BackendChatMessage[] => {
        try { const starredRows = all<BackendChatMessage>(selectStarredMessagesSql); return starredRows ?? []; }
        catch (error) { console.error(`DB error fetching starred messages:`, error); throw new Error(`Database error fetching starred messages.`); }
    },

    // --- FTS Search Function (UPDATED for UNION) ---
    searchMessages: (query: string, limit: number = 20): FtsSearchResult[] => {
         const trimmedQuery = query?.trim() ?? '';
         if (!trimmedQuery) {
             return [];
         }

         // Process query for FTS5 syntax
         const tokens = trimmedQuery.split(/\s+/);
         const processedTokens = tokens
             .map(token => {
                 let processed = token.trim().replace(/^\*+/, '');
                 if (!processed || /^[\\*"'()+\-^!&|<>=\s]+$/.test(processed)) {
                     console.log(`[ChatRepo:searchMessages] Filtering out potentially problematic token: "${token}" -> "${processed}"`);
                     return null;
                 }
                 processed = processed.replace(/"/g, '""');
                 return `"${processed}*"`;
             })
             .filter((token): token is string => token !== null);

         if (processedTokens.length === 0) {
             console.log(`[ChatRepo:searchMessages] No valid search tokens derived from query: "${query}"`);
             return [];
         }

         const ftsQuery = processedTokens.join(' ');
         const integerLimit = Math.floor(limit);

         console.log(`[ChatRepo:searchMessages] Executing combined FTS query: '${ftsQuery}', LIMIT: ${integerLimit}`);
         try {
             // Execute the UNION query, passing the query term twice
             const results = searchStmt.all(ftsQuery, ftsQuery, integerLimit);
             console.log(`[ChatRepo:searchMessages] Found ${results.length} combined results.`);
             // Map results to ensure correct types (e.g., nulls for fields not present in one source)
             return (results as any[]).map(row => ({
                 id: row.id,
                 type: row.type, // 'chat' or 'transcript'
                 chatId: row.chatId ?? null,
                 sessionId: row.sessionId ?? null,
                 sender: row.sender ?? null,
                 timestamp: row.timestamp,
                 snippet: row.snippet,
                 paragraphIndex: row.paragraphIndex ?? null,
                 starred: row.starred,
                 starredName: row.starredName,
             }));
         } catch (error) {
             console.error(`DB error searching combined messages/transcripts with FTS query '${ftsQuery}' derived from original query "${query}":`, error);
             if (error instanceof Error && (error.message.includes('malformed MATCH expression') || error.message.includes('fts5: syntax error'))) {
                 throw new Error(`Database FTS query syntax error for query: "${query}". Processed FTS query: '${ftsQuery}'`);
             }
             throw new Error(`Database error searching messages/transcripts: ${error instanceof Error ? error.message : String(error)}`);
         }
    },
    // TODO comments should not be removed
};
