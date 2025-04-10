// src/repositories/chatRepository.ts
import { db } from '../db/sqliteService.js'; // ADDED .js
import type { BackendChatSession, BackendChatMessage } from '../types/index.js'; // ADDED .js
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try { return db.prepare(sql); }
    catch (error) { throw new Error(`DB stmt prep failed: ${sql}. Error: ${error}`); }
};

// Prepare statements
const insertChatStmt = prepareStmt('INSERT INTO chats (sessionId, timestamp, name) VALUES (?, ?, ?)');
const insertMessageStmt = prepareStmt('INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, ?, ?, ?)');
const selectChatsBySessionIdStmt = prepareStmt('SELECT * FROM chats WHERE sessionId = ? ORDER BY timestamp DESC');
const selectMessagesByChatIdStmt = prepareStmt('SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC');
const selectChatByIdStmt = prepareStmt('SELECT * FROM chats WHERE id = ?');
const selectMessageByIdStmt = prepareStmt('SELECT * FROM messages WHERE id = ?');
const updateChatNameStmt = prepareStmt('UPDATE chats SET name = ? WHERE id = ?');
const deleteChatStmt = prepareStmt('DELETE FROM chats WHERE id = ?');

// Helper to combine chat row with its messages
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
     try {
        const chatRow = selectChatByIdStmt.get(chatId) as Omit<BackendChatSession, 'messages'> | undefined;
        if (!chatRow) return null;
        const messages = selectMessagesByChatIdStmt.all(chatId) as BackendChatMessage[];
        return { ...chatRow, messages };
    } catch (error) { throw new Error(`DB error fetching chat ${chatId}: ${error}`); }
};

export const chatRepository = {
    createChat: (sessionId: number): BackendChatSession => {
        const timestamp = Date.now();
         try {
            const info: RunResult = insertChatStmt.run(sessionId, timestamp, undefined);
            const newChatId = info.lastInsertRowid as number;
            const newChat = findChatWithMessages(newChatId); // Includes messages (will be empty)
            if (!newChat) throw new Error(`Failed retrieve chat ${newChatId}`);
            return newChat;
        } catch (error) { throw new Error(`DB error creating chat: ${error}`); }
    },

    addMessage: (chatId: number, sender: 'user' | 'ai', text: string): BackendChatMessage => {
        const timestamp = Date.now();
        try {
            const info: RunResult = insertMessageStmt.run(chatId, sender, text, timestamp);
            const newMessageId = info.lastInsertRowid as number;
             const newMessage = selectMessageByIdStmt.get(newMessageId) as BackendChatMessage | undefined;
             if (!newMessage) throw new Error(`Failed retrieve message ${newMessageId}`);
            return newMessage;
        } catch (error) { throw new Error(`DB error adding message: ${error}`); }
    },

    findChatsBySessionId: (sessionId: number): BackendChatSession[] => {
        try {
            const chatRows = selectChatsBySessionIdStmt.all(sessionId) as Omit<BackendChatSession, 'messages'>[];
            // Fetch messages for each chat - consider performance implications
            return chatRows.map(chatRow => {
                const messages = selectMessagesByChatIdStmt.all(chatRow.id) as BackendChatMessage[];
                return { ...chatRow, messages };
            });
        } catch (error) { throw new Error(`DB error fetching chats: ${error}`); }
    },

    findChatById: (chatId: number): BackendChatSession | null => {
        return findChatWithMessages(chatId);
    },

    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
         try {
             return selectMessagesByChatIdStmt.all(chatId) as BackendChatMessage[];
         } catch (error) { throw new Error(`DB error fetching messages: ${error}`); }
     },

    updateChatName: (chatId: number, name: string | undefined): BackendChatSession | null => {
        try {
            const info: RunResult = updateChatNameStmt.run(name, chatId);
            // Refetch even if changes = 0 to return current state, or null if truly gone
            return findChatWithMessages(chatId);
        } catch (error) { throw new Error(`DB error updating chat name: ${error}`); }
    },

    deleteChatById: (chatId: number): boolean => {
         try {
            const info: RunResult = deleteChatStmt.run(chatId);
            return info.changes > 0;
        } catch (error) { throw new Error(`DB error deleting chat: ${error}`); }
    },
};
