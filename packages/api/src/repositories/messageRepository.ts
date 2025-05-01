import { db, run, all, get } from '../db/sqliteService.js';
import type { BackendChatMessage } from '../types/index.js';

// --- SQL Statements ---
const insertMessageSql = `
    INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, starred, starredName)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`;
const selectMessagesByChatIdSql = `
    SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC
`;
const selectMessageByIdSql = `
    SELECT * FROM messages WHERE id = ?
`;
const updateMessageStarStatusSql = `
    UPDATE messages SET starred = ?, starredName = ? WHERE id = ?
`;
const selectStarredMessagesSql = `
    SELECT * FROM messages WHERE starred = 1 ORDER BY timestamp DESC
`;
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
      // Execute insert, using NULL for tokens if not provided, default starred to 0 (false), name to null
      const info = run(
        insertMessageSql,
        chatId,
        sender,
        text,
        timestamp,
        promptTokens ?? null,
        completionTokens ?? null,
        0,
        null
      );
      const newId = info.lastInsertRowid as number; // Get the ID of the inserted row
      // Fetch the newly inserted message to return the complete object
      const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
      // This should ideally never happen in a synchronous operation like this
      if (!newMsg)
        throw new Error('Failed retrieve msg immediately after insert');
      console.log(
        `[MessageRepo AddMessage] Inserted message ${newId} for chat ${chatId}. FTS trigger should have fired.`
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
   * Updates the star status and associated name of a message.
   * If starring, `starredName` can be provided.
   * If unstarring, `starredName` is ignored and set to null in the DB.
   *
   * @param messageId - The ID of the message to update.
   * @param starred - Boolean indicating the new star status.
   * @param starredName - Optional name to associate with the star (only used if `starred` is true).
   * @returns The updated message object, or null if the message was not found or retrieval failed post-update.
   * @throws If there's a database error during the update.
   */
  updateMessageStarStatus: (
    messageId: number,
    starred: boolean,
    starredName?: string | null
  ): BackendChatMessage | null => {
    try {
      // Determine the name to save: null if unstarring, provided name (or null) if starring
      const nameToSave = starred ? (starredName ?? null) : null;
      const starredIntValue = starred ? 1 : 0; // Convert boolean to DB integer (0/1)
      // Execute the update
      const info = run(
        updateMessageStarStatusSql,
        starredIntValue,
        nameToSave,
        messageId
      );
      // Check if any row was actually updated
      if (info.changes === 0) {
        console.warn(
          `[MessageRepo] No message found with ID ${messageId} to update star status.`
        );
        return null;
      }
      // Fetch the updated message to return the complete object
      const updatedMessage = get<BackendChatMessage>(
        selectMessageByIdSql,
        messageId
      );
      if (!updatedMessage) {
        // This is unexpected and suggests a potential issue
        console.error(
          `[MessageRepo] CRITICAL: Failed to retrieve message ${messageId} immediately after star update.`
        );
        return null;
      }
      console.log(
        `[MessageRepo UpdateStar] Updated star status for message ${messageId} to starred=${starredIntValue}, name=${nameToSave}`
      );
      return updatedMessage;
    } catch (error) {
      console.error(
        `DB error updating star status for message ${messageId}:`,
        error
      );
      throw new Error(`Database error updating message star status.`); // Rethrow generic error
    }
  },

  /**
   * Finds all messages that have been starred (starred = 1).
   * Ordered by timestamp descending (most recently starred first, although timestamp is message creation time).
   *
   * @returns An array of starred message objects, or an empty array if none found or on error.
   * @throws If there's a database error during fetching.
   */
  findStarredMessages: (): BackendChatMessage[] => {
    try {
      const starredRows = all<BackendChatMessage>(selectStarredMessagesSql);
      return starredRows ?? []; // Return empty array if no starred messages found
    } catch (error) {
      console.error(`DB error fetching starred messages:`, error);
      throw new Error(`Database error fetching starred messages.`); // Rethrow generic error
    }
  },
};
