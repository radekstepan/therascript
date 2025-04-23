import { get, all, run } from '../db/sqliteService.js'; // Keep .js extension
import type { BackendChatSession, BackendChatMessage, ChatMetadata } from '../types/index.js'; // Keep .js extension

// --- SQL Statements ---
const insertChatSql = 'INSERT INTO chats (sessionId, timestamp, name) VALUES (?, ?, ?)';
const insertMessageSql = `
    INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens)
    VALUES (?, ?, ?, ?, ?, ?)
`;
const selectChatsBySessionIdSql = 'SELECT id, sessionId, timestamp, name FROM chats WHERE sessionId = ? ORDER BY timestamp DESC'; // Select only metadata
const selectStandaloneChatsSql = 'SELECT id, sessionId, timestamp, name FROM chats WHERE sessionId IS NULL ORDER BY timestamp DESC'; // Select only metadata
const selectMessagesByChatIdSql = 'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC'; // Keep sort by ID
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?'; // Fetch full row for single chat lookup
const selectMessageByIdSql = 'SELECT * FROM messages WHERE id = ?';
const updateChatNameSql = 'UPDATE chats SET name = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';

// Helper to combine chat row with its messages (now synchronous)
const findChatWithMessages = (chatId: number): BackendChatSession | null => {
    try {
        const chatRow = get<BackendChatSession>(selectChatByIdSql, chatId); // Fetch full chat row
        if (!chatRow) return null;
        const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
        console.log(`[findChatWithMessages DEBUG] Fetched ${messages.length} messages for Chat ID ${chatId} using ORDER BY id ASC.`);
        // Ensure messages is always an array and sessionId can be null
        return {
            ...chatRow,
            sessionId: chatRow.sessionId ?? null, // Ensure null if DB returns null
            name: chatRow.name ?? null, // Ensure null if DB returns null
            messages: messages ?? [] // Ensure array
        };
    } catch (error) {
        console.error(`DB error fetching chat ${chatId}:`, error);
        throw new Error(`Database error fetching chat ${chatId}.`);
    }
};

export const chatRepository = {
    // createChat returns the full BackendChatSession now
    createChat: (sessionId: number | null): BackendChatSession => {
        const timestamp = Date.now();
        try {
            const info = run(insertChatSql, sessionId, timestamp, null);
            const newChatId = info.lastInsertRowid as number;
            const newChatRow = get<BackendChatSession>(selectChatByIdSql, newChatId); // Fetch the full row
            if (!newChatRow) throw new Error(`Failed retrieve chat ${newChatId} immediately after creation.`);
            console.log(`[ChatRepo] Created ${sessionId ? 'session' : 'standalone'} chat ${newChatId}${sessionId ? ' in session ' + sessionId : ''}`);
            // Return the full chat structure, ensuring messages is an empty array and sessionId nullability
            return {
                ...newChatRow,
                sessionId: newChatRow.sessionId ?? null,
                name: newChatRow.name ?? null,
                messages: []
            };
        } catch (error) {
            console.error(`DB error creating chat ${sessionId ? `for session ${sessionId}` : '(standalone)'}:`, error);
            // Throw the original error to potentially catch constraint violations upstream
            throw new Error(`Database error creating chat: ${error instanceof Error ? error.message : String(error)}`);
        }
    },

    addMessage: (
        chatId: number,
        sender: 'user' | 'ai',
        text: string,
        promptTokens?: number | null,
        completionTokens?: number | null
    ): BackendChatMessage => {
        const timestamp = Date.now();
        try {
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
            console.log(`[chatRepository.addMessage DEBUG] Inserted Msg ID: ${newMessage.id}, ChatID: ${chatId}, Sender: ${newMessage.sender}, Tokens: P${newMessage.promptTokens ?? '-'}/C${newMessage.completionTokens ?? '-'}`);
            return newMessage;
        } catch (error) {
            console.error(`DB error adding message to chat ${chatId}:`, error);
            throw new Error(`Database error adding message.`);
        }
    },

    // Returns ChatMetadata for session chats (sessionId guaranteed to be number)
    findChatsBySessionId: (sessionId: number): (ChatMetadata & { sessionId: number })[] => {
        try {
            const chatRows = all<ChatMetadata>(selectChatsBySessionIdSql, sessionId);
            // Ensure sessionId is typed as number and name is not undefined
            // Add type annotation for map parameter 'chat'
            return chatRows.map((chat: ChatMetadata) => ({
                id: chat.id,
                sessionId: chat.sessionId as number, // Assert non-null sessionId for session chats
                timestamp: chat.timestamp,
                name: chat.name ?? null // Ensure name is null if undefined
            }));
        } catch (error) {
            console.error(`DB error fetching chats for session ${sessionId}:`, error);
            throw new Error(`Database error fetching chats.`);
        }
    },

    // Returns ChatMetadata with sessionId guaranteed null for standalone chats
    findStandaloneChats: (): (ChatMetadata & { sessionId: null })[] => {
        try {
            const chatRows = all<ChatMetadata>(selectStandaloneChatsSql);
            console.log(`[ChatRepo] Found ${chatRows.length} standalone chats.`);
            // Add type annotation for map parameter 'chat'
            return chatRows.map((chat: ChatMetadata): ChatMetadata & { sessionId: null } => ({
                id: chat.id,
                sessionId: null, // Explicitly set to null
                timestamp: chat.timestamp,
                name: chat.name ?? null, // Ensure name is null if undefined
            }));
        } catch (error) {
            console.error(`DB error fetching standalone chats:`, error);
            throw new Error(`Database error fetching standalone chats.`);
        }
    },

    // findChatById returns full BackendChatSession
    findChatById: (chatId: number): BackendChatSession | null => {
        return findChatWithMessages(chatId);
    },

    findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
        try {
            const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
            console.log(`[findMessagesByChatId DEBUG] Fetched ${messages.length} messages for Chat ID ${chatId} using ORDER BY id ASC.`);
            return messages ?? []; // Ensure array return
        } catch (error) {
            console.error(`DB error fetching messages for chat ${chatId}:`, error);
            throw new Error(`Database error fetching messages.`);
        }
    },

    // updateChatName now returns ChatMetadata
    updateChatName: (chatId: number, name: string | null): ChatMetadata | null => {
        try {
             run(updateChatNameSql, name, chatId);
             const updatedChatRow = get<BackendChatSession>(selectChatByIdSql, chatId); // Fetch full row to get sessionId
             if (!updatedChatRow) return null;
             // Construct ChatMetadata, ensuring sessionId type is preserved
             const finalMetadata: ChatMetadata = {
                 id: updatedChatRow.id,
                 sessionId: updatedChatRow.sessionId ?? null, // Preserve null for standalone
                 timestamp: updatedChatRow.timestamp,
                 name: updatedChatRow.name ?? null,
             };
             return finalMetadata;
        } catch (error) {
            console.error(`DB error updating name for chat ${chatId}:`, error);
            throw new Error(`Database error updating chat name.`);
        }
    },

    deleteChatById: (chatId: number): boolean => {
        try {
            console.log(`[chatRepository:deleteChatById] Executing DELETE for chat ID: ${chatId}`);
            const info = run(deleteChatSql, chatId);
            console.log(`[chatRepository:deleteChatById] Delete result for chat ID ${chatId}: ${info.changes} row(s) affected.`);
            return info.changes > 0;
        } catch (error) {
            console.error(`DB error deleting chat ${chatId}:`, error);
            throw new Error(`Database error deleting chat.`);
        }
    },
};
