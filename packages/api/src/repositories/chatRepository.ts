import { get, all, run } from '../db/sqliteService.js'; // Use synchronous helpers
import type { BackendChatSession, BackendChatMessage } from '../types/index.js';

// SQL statements (prepared later by sqliteService helpers)
const insertChatSql = 'INSERT INTO chats (sessionId, timestamp, name) VALUES (?, ?, ?)';
const insertMessageSql = 'INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, ?, ?, ?)';
const selectChatsBySessionIdSql = 'SELECT * FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC, id ASC';
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?';
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateChatNameSql = 'UPDATE chats SET name = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';

// Helper to combine chat row with its messages (now synchronous)
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
    try {
        const chatRow = get<Omit<BackendChatSession, 'messages'>>(selectChatByIdSql, chatId);
        if (!chatRow) return null;
        const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
        return { ...chatRow, messages };
    } catch (error) {
        console.error(`DB error fetching chat ${chatId}:`, error);
        throw new Error(`Database error fetching chat ${chatId}.`);
    }
};

export const chatRepository = {
    createChat: (sessionId: number): BackendChatSession => {
        const timestamp = Date.now();
        try {
            const info = run(insertChatSql, sessionId, timestamp, null);
            const newChatId = info.lastInsertRowid as number;
            const newChat = findChatWithMessages(newChatId);
            if (!newChat) throw new Error(`Failed retrieve chat ${newChatId} immediately after creation.`);
            return newChat;
        } catch (error) {
            console.error(`DB error creating chat for session ${sessionId}:`, error);
            throw new Error(`Database error creating chat.`);
        }
    },

    addMessage: (chatId: number, sender: 'user' | 'ai', text: string): BackendChatMessage => {
        const timestamp = Date.now();
        try {
            const info = run(insertMessageSql, chatId, sender, text, timestamp);
            const newMessageId = info.lastInsertRowid as number;
            const newMessage = get<BackendChatMessage>(selectMessageByIdSql, newMessageId);
            if (!newMessage) throw new Error(`Failed retrieve message ${newMessageId} immediately after creation.`);
            return newMessage;
        } catch (error) {
            console.error(`DB error adding message to chat ${chatId}:`, error);
            throw new Error(`Database error adding message.`);
        }
    },

    findChatsBySessionId: (sessionId: number): BackendChatSession[] => {
        try {
            const chatRows = all<Omit<BackendChatSession, 'messages'>>(selectChatsBySessionIdSql, sessionId);
            const chatsWithMessages = chatRows.map((chatRow) => {
                const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatRow.id);
                return { ...chatRow, messages };
            });
            return chatsWithMessages;
        } catch (error) {
            console.error(`DB error fetching chats for session ${sessionId}:`, error);
            throw new Error(`Database error fetching chats.`);
        }
    },

    findChatById: (chatId: number): BackendChatSession | null => {
        return findChatWithMessages(chatId);
    },

    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
        try {
            return all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
        } catch (error) {
            console.error(`DB error fetching messages for chat ${chatId}:`, error);
            throw new Error(`Database error fetching messages.`);
        }
    },

    // Explicitly accept null for name parameter
    updateChatName: (chatId: number, name: string | null): BackendChatSession | null => {
        try {
            // Pass name directly (which can be null)
             run(updateChatNameSql, name, chatId);
            return findChatWithMessages(chatId);
        } catch (error) {
            console.error(`DB error updating name for chat ${chatId}:`, error);
            throw new Error(`Database error updating chat name.`);
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
};
