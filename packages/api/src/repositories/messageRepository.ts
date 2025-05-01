// =========================================
// File: packages/api/src/repositories/messageRepository.ts
// NEW FILE
// =========================================
/* packages/api/src/repositories/messageRepository.ts */
// Handles Message entities
import { db, run, all, get } from '../db/sqliteService.js';
import type { BackendChatMessage } from '../types/index.js';

const insertMessageSql = `INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC';
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateMessageStarStatusSql = 'UPDATE messages SET starred = ?, starredName = ? WHERE id = ?';
const selectStarredMessagesSql = 'SELECT * FROM messages WHERE starred = 1 ORDER BY timestamp DESC';

export const messageRepository = {
    /**
     * Adds a new message to a chat.
     * @param chatId - The ID of the chat to add the message to.
     * @param sender - 'user' or 'ai'.
     * @param text - The content of the message.
     * @param promptTokens - Optional prompt token count.
     * @param completionTokens - Optional completion token count.
     * @returns The newly created message object.
     * @throws If there's a database error.
     */
    addMessage: ( chatId: number, sender: 'user' | 'ai', text: string, promptTokens?: number | null, completionTokens?: number | null ): BackendChatMessage => {
        const timestamp = Date.now();
         try {
            const info = run( insertMessageSql, chatId, sender, text, timestamp, promptTokens ?? null, completionTokens ?? null, 0, null ); // Starred defaults to 0, name to null
            const newId = info.lastInsertRowid as number;
            const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
            if(!newMsg) throw new Error("Failed retrieve msg immediately after insert");
            console.log(`[MessageRepo AddMessage] Inserted message ${newId}. FTS trigger should have fired.`);
            return newMsg;
         } catch (error) { console.error(`DB error adding message to chat ${chatId}:`, error); throw new Error("DB error adding message"); }
    },

    /**
     * Finds all messages for a given chat ID, ordered by ID (creation order).
     */
    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
        try {
            const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
            return messages ?? [];
        } catch (error) { console.error(`DB error fetching messages for chat ${chatId}:`, error); throw new Error(`Database error fetching messages.`); }
    },

    /**
     * Finds a single message by its ID.
     */
    findMessageById: (messageId: number): BackendChatMessage | null => {
        try {
            const messageRow = get<BackendChatMessage>(selectMessageByIdSql, messageId);
            return messageRow ?? null;
        } catch (error) { console.error(`DB error fetching message ${messageId}:`, error); throw new Error(`Database error fetching message.`); }
    },

    /**
     * Updates the star status and name of a message.
     */
    updateMessageStarStatus: ( messageId: number, starred: boolean, starredName?: string | null ): BackendChatMessage | null => {
        try { const nameToSave = starred ? (starredName ?? null) : null; const starredIntValue = starred ? 1 : 0; const info = run(updateMessageStarStatusSql, starredIntValue, nameToSave, messageId); if (info.changes === 0) { console.warn(`[MessageRepo] No message found with ID ${messageId} to update star status.`); return null; } const updatedMessage = get<BackendChatMessage>(selectMessageByIdSql, messageId); if (!updatedMessage) { console.error(`[MessageRepo] CRITICAL: Failed to retrieve message ${messageId} immediately after star update.`); return null; } return updatedMessage; } catch (error) { console.error(`DB error updating star status for message ${messageId}:`, error); throw new Error(`Database error updating message star status.`); }
    },

    /**
     * Finds all messages that have been starred.
     */
    findStarredMessages: (): BackendChatMessage[] => {
        try { const starredRows = all<BackendChatMessage>(selectStarredMessagesSql); return starredRows ?? []; }
        catch (error) { console.error(`DB error fetching starred messages:`, error); throw new Error(`Database error fetching starred messages.`); }
    },
};

// TODO comments should not be removed
