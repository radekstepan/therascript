/* packages/api/src/repositories/chatRepository.ts */
import { get, all, run } from '../db/sqliteService.js';
import type { BackendChatSession, BackendChatMessage, ChatMetadata } from '../types/index.js';

// Helper to safely parse JSON tags column
const parseTags = (tagsJson: string | null): string[] | null => {
    if (!tagsJson) return null;
    try {
        const parsed = JSON.parse(tagsJson);
        // Basic validation
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
            return parsed; // Return the parsed array (should be alphabetically sorted from DB)
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

// --- SQL Statements (Unchanged) ---
const insertChatSql = 'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)';
const insertMessageSql = `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const selectChatsBySessionIdSql = 'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectStandaloneChatsSql = 'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId IS NULL ORDER BY timestamp DESC';
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC';
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?'; // Includes tags column as TEXT
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateChatDetailsSql = 'UPDATE chats SET name = ?, tags = ? WHERE id = ?'; // Updates name and tags string
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';
const updateMessageStarStatusSql = 'UPDATE messages SET starred = ?, starredName = ? WHERE id = ?';
const selectStarredMessagesSql = 'SELECT * FROM messages WHERE starred = 1 ORDER BY timestamp DESC';


// Helper to combine chat row with its messages, parsing tags
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
    try {
        const chatRow = get<RawChatRow>(selectChatByIdSql, chatId);
        if (!chatRow) return null;
        const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
        const tagsArray = parseTags(chatRow.tags); // Parse stored JSON string
        const result: BackendChatSession = {
            id: chatRow.id,
            sessionId: chatRow.sessionId ?? null,
            timestamp: chatRow.timestamp,
            name: chatRow.name ?? null,
            tags: tagsArray, // Assign the parsed array (or null)
            messages: messages ?? [],
        };
        return result;
    } catch (error) {
        console.error(`DB error fetching chat ${chatId}:`, error);
        throw new Error(`Database error fetching chat ${chatId}.`);
    }
};

export const chatRepository = {
    createChat: (sessionId: number | null): BackendChatSession => {
        const timestamp = Date.now();
        try {
            const info = run(insertChatSql, sessionId, timestamp, null, null); // Tags start as NULL
            const newChatId = info.lastInsertRowid as number;
            const newChatSession = findChatWithMessages(newChatId); // Use helper
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
            const info = run( insertMessageSql, chatId, sender, text, timestamp, promptTokens ?? null, completionTokens ?? null, 0, null );
            const newId = info.lastInsertRowid as number;
            const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
            if(!newMsg) throw new Error("Failed retrieve msg");
            // console.log(`[chatRepository.addMessage DEBUG] Inserted Msg ID: ${newMsg.id}`); // Reduce logging
            return newMsg;
         } catch (error) { console.error(`DB error adding message to chat ${chatId}:`, error); throw new Error("DB error adding message"); }
    },

    // findChatsBySessionId parses tags
    findChatsBySessionId: (sessionId: number): (ChatMetadata & { sessionId: number })[] => {
        try {
            const chatRows = all<RawChatRow>(selectChatsBySessionIdSql, sessionId);
            // Map and parse tags
            return chatRows.map(chat => ({
                id: chat.id,
                sessionId: chat.sessionId as number,
                timestamp: chat.timestamp,
                name: chat.name ?? null,
                tags: parseTags(chat.tags) // Parse tags JSON
            }));
        } catch (error) { console.error(`DB error fetching chats for session ${sessionId}:`, error); throw new Error(`Database error fetching chats.`); }
    },

    // findStandaloneChats parses tags
    findStandaloneChats: (): (ChatMetadata & { sessionId: null })[] => {
        try {
            const chatRows = all<RawChatRow>(selectStandaloneChatsSql);
            // console.log(`[ChatRepo] Found ${chatRows.length} standalone chats.`); // Reduce logging
            // Map and parse tags
            return chatRows.map(chat => ({
                id: chat.id,
                sessionId: null,
                timestamp: chat.timestamp,
                name: chat.name ?? null,
                tags: parseTags(chat.tags) // Parse tags JSON
            }));
        } catch (error) { console.error(`DB error fetching standalone chats:`, error); throw new Error(`Database error fetching standalone chats.`); }
    },

    findChatById: (chatId: number): BackendChatSession | null => {
        return findChatWithMessages(chatId); // Helper handles parsing
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

    // Updates name and tags (expects tags to be pre-sorted alphabetically by handler)
    updateChatDetails: (chatId: number, name: string | null, tags: string[] | null): ChatMetadata | null => {
        try {
            const tagsJson = (tags && tags.length > 0) ? JSON.stringify(tags) : null; // Stringify the already sorted array
            run(updateChatDetailsSql, name, tagsJson, chatId);
            const updatedChatSession = findChatWithMessages(chatId); // Use helper
            if (!updatedChatSession) return null;
            const { messages, ...metadata } = updatedChatSession; // Extract metadata
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
};
