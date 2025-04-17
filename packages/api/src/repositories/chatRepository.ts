import { get, all, run } from '../db/sqliteService.js'; // Use synchronous helpers
import type { BackendChatSession, BackendChatMessage } from '../types/index.js';

// --- SQL Statements ---
const insertChatSql = 'INSERT INTO chats (sessionId, timestamp, name) VALUES (?, ?, ?)';
// --- Modified INSERT statement for messages ---
const insertMessageSql = `
    INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens)
    VALUES (?, ?, ?, ?, ?, ?)
`;
// --- End Modification ---
const selectChatsBySessionIdSql = 'SELECT * FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC'; // Keep sort by ID
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?';
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateChatNameSql = 'UPDATE chats SET name = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';

// Helper to combine chat row with its messages (now synchronous)
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
    try {
        const chatRow = get<Omit<BackendChatSession, 'messages'>>(selectChatByIdSql, chatId);
        if (!chatRow) return null;
        // Use the modified SQL query here
        const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
        console.log(`[findChatWithMessages DEBUG] Fetched ${messages.length} messages for Chat ID ${chatId} using ORDER BY id ASC.`); // Add log
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

    // --- Modified addMessage to include optional tokens ---
    addMessage: (
        chatId: number,
        sender: 'user' | 'ai',
        text: string,
        promptTokens?: number | null, // Optional
        completionTokens?: number | null // Optional
    ): BackendChatMessage => {
        const timestamp = Date.now(); // Keep timestamp for potential display or other uses
        try {
            // Pass tokens (or null if undefined/null) to the SQL query
            const info = run(
                insertMessageSql,
                chatId,
                sender,
                text,
                timestamp,
                promptTokens ?? null,
                completionTokens ?? null
            );
            const newMessageId = info.lastInsertRowid as number;
            const newMessage = get<BackendChatMessage>(selectMessageByIdSql, newMessageId);
            if (!newMessage) throw new Error(`Failed retrieve message ${newMessageId} immediately after creation.`);
            // Log the inserted message details including tokens
            console.log(`[chatRepository.addMessage DEBUG] Inserted Msg ID: ${newMessage.id}, Sender: ${newMessage.sender}, Tokens: P${newMessage.promptTokens ?? '-'}/C${newMessage.completionTokens ?? '-'}`);
            return newMessage;
        } catch (error) {
            console.error(`DB error adding message to chat ${chatId}:`, error);
            throw new Error(`Database error adding message.`);
        }
    },
    // --- End Modification ---

    findChatsBySessionId: (sessionId: number): BackendChatSession[] => {
        try {
            const chatRows = all<Omit<BackendChatSession, 'messages'>>(selectChatsBySessionIdSql, sessionId);
            // This map will now use the helper findChatWithMessages which uses the corrected ORDER BY id
            const chatsWithMessages = chatRows.map((chatRow) => {
                return findChatWithMessages(chatRow.id);
            }).filter((chat): chat is BackendChatSession => chat !== null); // Filter out nulls just in case find fails
            return chatsWithMessages;
        } catch (error) {
            console.error(`DB error fetching chats for session ${sessionId}:`, error);
            throw new Error(`Database error fetching chats.`);
        }
    },

    findChatById: (chatId: number): BackendChatSession | null => {
        // This already uses findChatWithMessages, which now uses the corrected ORDER BY id
        return findChatWithMessages(chatId);
    },

    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
        try {
             // Use the modified SQL query here too
            const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
            console.log(`[findMessagesByChatId DEBUG] Fetched ${messages.length} messages for Chat ID ${chatId} using ORDER BY id ASC.`); // Add log
            // Log timestamps and tokens for debugging if needed
            messages.slice(-5).forEach(m => console.log(`[findMessagesByChatId DEBUG] Msg ID=${m.id}, Sender=${m.sender}, TS=${m.timestamp}, Tokens=P${m.promptTokens ?? '-'}/C${m.completionTokens ?? '-'}`));
            return messages;
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
