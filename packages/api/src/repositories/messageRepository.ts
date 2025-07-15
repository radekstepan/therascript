import { db, run, all, get } from '@therascript/db';
import type { BackendChatMessage } from '../types/index.js';

// --- SQL Statements ---
const insertMessageSql = `
    INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens)
    VALUES (?, ?, ?, ?, ?, ?)
`;
const selectMessagesByChatIdSql = `
    SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC
`;
const selectMessageByIdSql = `
    SELECT * FROM messages WHERE id = ?
`;
const selectAllMessagesSql = `SELECT * FROM messages ORDER BY id ASC`; // For backup

// --- End SQL Statements ---

export const messageRepository = {
  /**
   * Adds a new message to a chat.
   *
   * @param chatId - The ID of the chat to add the message to.
   * @param sender - The sender of the message ('user' or 'ai').
   * @param text - The content of the message.
   * @param promptTokens - Optional token count for the prompt leading to this message (if applicable).
   * @param completionTokens - Optional token count for the AI completion itself (if applicable).
   * @returns The newly created message object, fetched immediately after insertion.
   * @throws If there's a database error during insertion or immediate retrieval.
   */
  addMessage: (
    chatId: number,
    sender: 'user' | 'ai',
    text: string,
    promptTokens?: number | null,
    completionTokens?: number | null
  ): BackendChatMessage => {
    const timestamp = Date.now(); // Timestamp the message creation
    try {
      // Execute insert, using NULL for tokens if not provided
      const info = run(
        insertMessageSql,
        chatId,
        sender,
        text,
        timestamp,
        promptTokens ?? null,
        completionTokens ?? null
      );
      const newId = info.lastInsertRowid as number; // Get the ID of the inserted row
      // Fetch the newly inserted message to return the complete object
      const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
      // This should ideally never happen in a synchronous operation like this
      if (!newMsg)
        throw new Error('Failed retrieve msg immediately after insert');
      console.log(
        `[MessageRepo AddMessage] Inserted message ${newId} for chat ${chatId}.`
      );
      return newMsg;
    } catch (error) {
      console.error(`DB error adding message to chat ${chatId}:`, error);
      throw new Error('DB error adding message'); // Rethrow generic error for service layer
    }
  },

  /**
   * Finds all messages for a given chat ID, ordered by ID (creation order).
   *
   * @param chatId - The ID of the chat whose messages to retrieve.
   * @returns An array of message objects, or an empty array if none found or on error.
   * @throws If there's a database error during fetching.
   */
  findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
    try {
      const messages = all<BackendChatMessage>(
        selectMessagesByChatIdSql,
        chatId
      );
      return messages ?? []; // Return empty array if no messages found
    } catch (error) {
      console.error(`DB error fetching messages for chat ${chatId}:`, error);
      throw new Error(`Database error fetching messages.`); // Rethrow generic error
    }
  },

  /**
   * Finds a single message by its unique ID.
   *
   * @param messageId - The ID of the message to retrieve.
   * @returns The message object, or null if not found.
   * @throws If there's a database error during fetching.
   */
  findMessageById: (messageId: number): BackendChatMessage | null => {
    try {
      const messageRow = get<BackendChatMessage>(
        selectMessageByIdSql,
        messageId
      );
      return messageRow ?? null; // Return null if no message found
    } catch (error) {
      console.error(`DB error fetching message ${messageId}:`, error);
      throw new Error(`Database error fetching message.`); // Rethrow generic error
    }
  },

  /**
   * Finds all messages in the database.
   * @returns An array of all message objects.
   * @throws If there's a database error during fetching.
   */
  findAll: (): BackendChatMessage[] => {
    try {
      return all<BackendChatMessage>(selectAllMessagesSql);
    } catch (error) {
      console.error(`DB error fetching all messages:`, error);
      throw new Error(`Database error fetching all messages.`);
    }
  },
};
