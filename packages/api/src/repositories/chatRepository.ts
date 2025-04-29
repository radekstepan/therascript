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


// --- FTS Search Statement (REMOVED rank, ORDER BY, and snippet) ---
const searchMessagesSql = `
    SELECT
        m.id,
        m.chatId,
        c.sessionId,
        m.sender,
        m.timestamp,
        -- snippet(messages_fts, 0, '[HL]', '[/HL]', '...', 25) as snippet, -- <-- REMOVED snippet()
        m.text as snippet, -- <-- Use original text as fallback for now
        m.starred,
        m.starredName
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.id
    JOIN chats c ON m.chatId = c.id
    WHERE messages_fts MATCH ?
    LIMIT ?;
`;
let searchMessagesStmt: Statement;
try {
    searchMessagesStmt = db.prepare(searchMessagesSql);
} catch (e) {
    console.error("FATAL: Failed to prepare FTS search statement:", e);
    throw new Error("Failed to prepare database search statement.");
}

// Interface for results coming *from this query* (no rank)
export interface FtsSearchResult {
    id: number;
    chatId: number;
    sessionId: number | null;
    sender: 'user' | 'ai';
    timestamp: number;
    snippet: string; // Will contain full text for now
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

    // --- FTS Search Function (Corrected Logic v4) ---
    searchMessages: (query: string, limit: number = 20): FtsSearchResult[] => {
         const trimmedQuery = query?.trim() ?? '';
         if (!trimmedQuery) {
             return [];
         }

         // 1. Split into potential keywords by whitespace
         const tokens = trimmedQuery.split(/\s+/);

         // 2. Process each token
         const processedTokens = tokens
             .map(token => {
                 let processed = token.trim();
                 // Remove only leading asterisks
                 processed = processed.replace(/^\*+/, '');

                 // **Filter out tokens consisting only of typical FTS punctuation/operators**
                 // This aims to remove isolated problematic characters like standalone quotes.
                 // Regex includes: *, ", ', (, ), +, -, ^, !, &, |, <, >, = and whitespace (though split should handle ws)
                 // We keep alphanumeric characters and potentially internal hyphens/apostrophes if needed.
                 if (!processed || /^[\\*"'()+\-^!&|<>=\s]+$/.test(processed)) {
                     console.log(`[ChatRepo:searchMessages] Filtering out potentially problematic token: "${token}" -> "${processed}"`);
                     return null;
                 }

                 // Escape internal double quotes *only*
                 // Single quotes inside a double-quoted FTS term are typically treated literally
                 processed = processed.replace(/"/g, '""');

                 // Wrap the entire processed token in double quotes and add the prefix asterisk *inside*
                 // This handles spaces, single quotes, hyphens etc., within the term safely for FTS5.
                 return `"${processed}*"`;
             })
             .filter((token): token is string => token !== null); // Filter out nulls (empty or punctuation-only tokens)

         // 3. If no valid tokens remain, return empty
         if (processedTokens.length === 0) {
             console.log(`[ChatRepo:searchMessages] No valid search tokens derived from query: "${query}"`);
             return [];
         }

         // 4. Join the valid, quoted tokens with a space (implicit AND in FTS)
         const ftsQuery = processedTokens.join(' ');

         const integerLimit = Math.floor(limit); // Ensure integer limit

         console.log(`[ChatRepo:searchMessages] Executing FTS query: '${ftsQuery}', LIMIT: ${integerLimit}`);
         try {
             // Query now doesn't select rank, snippet, or order by rank
             const results = searchMessagesStmt.all(ftsQuery, integerLimit);
             console.log(`[ChatRepo:searchMessages] Found ${results.length} results.`);
             return results as FtsSearchResult[];
         } catch (error) {
             console.error(`DB error searching messages with FTS query '${ftsQuery}' derived from original query "${query}":`, error);
             if (error instanceof Error && (error.message.includes('malformed MATCH expression') || error.message.includes('fts5: syntax error'))) {
                 // Provide more context in the error message
                 throw new Error(`Database FTS query syntax error for query: "${query}". Processed FTS query: '${ftsQuery}'`);
             }
             // Re-throwing the original error might give more clues if it's not the match expression
             throw new Error(`Database error searching messages: ${error instanceof Error ? error.message : String(error)}`);
         }
    },
    // TODO comments should not be removed
};
