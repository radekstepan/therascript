// src/repositories/chatRepository.ts
import { db } from '../db/sqliteService'; // Relative
import type { BackendChatSession, BackendChatMessage } from '../types'; // Relative
import { Statement, RunResult } from 'better-sqlite3';

// Helper function to safely prepare statements
const prepareStmt = (sql: string): Statement => {
    try {
        return db.prepare(sql);
    } catch (error) {
        console.error(`[db]: Failed to prepare statement: ${sql}`, error);
        throw new Error('Database statement preparation failed.');
    }
};

// Prepare statements
const insertChatStmt = prepareStmt(
    'INSERT INTO chats (sessionId, timestamp, name) VALUES (?, ?, ?)'
);
const insertMessageStmt = prepareStmt(
    'INSERT INTO messages (chatId, sender, text, timestamp) VALUES (?, ?, ?, ?)'
);
const selectChatsBySessionIdStmt = prepareStmt(
    'SELECT * FROM chats WHERE sessionId = ? ORDER BY timestamp DESC'
);
const selectMessagesByChatIdStmt = prepareStmt(
    'SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC'
);
const selectChatByIdStmt = prepareStmt('SELECT * FROM chats WHERE id = ?');
const selectMessageByIdStmt = prepareStmt('SELECT * FROM messages WHERE id = ?');
const updateChatNameStmt = prepareStmt(
    'UPDATE chats SET name = ? WHERE id = ?'
);
const deleteChatStmt = prepareStmt('DELETE FROM chats WHERE id = ?');


// Helper to combine chat row with its messages (can be expensive if many chats/messages)
// Consider fetching messages only when a specific chat is requested if performance is an issue.
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
     try {
        const chatRow = selectChatByIdStmt.get(chatId) as Omit<BackendChatSession, 'messages'> | undefined;
        if (!chatRow) {
            return null;
        }
        const messages = selectMessagesByChatIdStmt.all(chatId) as BackendChatMessage[];
        return { ...chatRow, messages };
    } catch (error) {
         console.error(`[db]: Error finding chat with messages (ID: ${chatId}):`, error);
         throw new Error('Database error fetching chat details.');
    }
};

export const chatRepository = {
    createChat: (sessionId: number): BackendChatSession => {
        const timestamp = Date.now();
         try {
            const info: RunResult = insertChatStmt.run(sessionId, timestamp, undefined); // Initially no name
            const newChatId = info.lastInsertRowid as number;
            const newChat = findChatWithMessages(newChatId);
            if (!newChat) {
                 throw new Error(`Failed to retrieve chat immediately after creation (ID: ${newChatId})`);
            }
            console.log(`[db]: Created chat ${newChatId} for session ${sessionId}`);
            return newChat;
        } catch (error) {
             console.error(`[db]: Error creating chat for session ${sessionId}:`, error);
             throw new Error('Database error during chat creation.');
        }
    },

    addMessage: (chatId: number, sender: 'user' | 'ai', text: string): BackendChatMessage => {
        const timestamp = Date.now();
        try {
            const info: RunResult = insertMessageStmt.run(chatId, sender, text, timestamp);
            const newMessageId = info.lastInsertRowid as number;
            const newMessage = selectMessageByIdStmt.get(newMessageId) as BackendChatMessage | undefined;
            if (!newMessage) {
                 throw new Error(`Failed to retrieve message immediately after insertion (ID: ${newMessageId})`);
            }
             // Do not log message text here for privacy
             console.log(`[db]: Added ${sender} message ${newMessageId} to chat ${chatId}`);
            return newMessage;
        } catch (error) {
             console.error(`[db]: Error adding message to chat ${chatId}:`, error);
             throw new Error('Database error adding message.');
        }
    },

    findChatsBySessionId: (sessionId: number): BackendChatSession[] => {
        try {
            const chatRows = selectChatsBySessionIdStmt.all(sessionId) as Omit<BackendChatSession, 'messages'>[];
            // Fetch messages for each chat - potentially optimize later if needed
            return chatRows.map(chatRow => {
                const messages = selectMessagesByChatIdStmt.all(chatRow.id) as BackendChatMessage[];
                return { ...chatRow, messages };
            });
        } catch (error) {
             console.error(`[db]: Error finding chats for session ${sessionId}:`, error);
             throw new Error('Database error fetching chats.');
        }
    },

    findChatById: (chatId: number): BackendChatSession | null => {
        // Uses helper which includes error handling
        return findChatWithMessages(chatId);
    },

    // Returns messages only for a specific chat
    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
         try {
             return selectMessagesByChatIdStmt.all(chatId) as BackendChatMessage[];
         } catch (error) {
             console.error(`[db]: Error finding messages for chat ${chatId}:`, error);
             throw new Error('Database error fetching messages.');
         }
     },


    updateChatName: (chatId: number, name: string | undefined): BackendChatSession | null => {
        try {
            const info: RunResult = updateChatNameStmt.run(name, chatId);
            if (info.changes > 0) {
                 console.log(`[db]: Updated name for chat ${chatId}`);
                // Refetch the chat to get the updated name and messages
                return findChatWithMessages(chatId);
            } else {
                console.warn(`[db]: Chat ${chatId} not found for name update or name unchanged.`);
                // Attempt to return current state if found, otherwise null
                 return findChatWithMessages(chatId);
            }
        } catch (error) {
             console.error(`[db]: Error updating name for chat ${chatId}:`, error);
             throw new Error('Database error updating chat name.');
        }
    },

    deleteChatById: (chatId: number): boolean => {
         try {
            // Note: ON DELETE CASCADE handles messages deletion in SQLite
            const info: RunResult = deleteChatStmt.run(chatId);
            if (info.changes > 0) {
                 console.log(`[db]: Deleted chat ${chatId} and associated messages.`);
                 return true;
            } else {
                console.warn(`[db]: Chat ${chatId} not found for deletion.`);
                return false;
            }
        } catch (error) {
             console.error(`[db]: Error deleting chat ${chatId}:`, error);
             throw new Error('Database error deleting chat.');
        }
    },
};
