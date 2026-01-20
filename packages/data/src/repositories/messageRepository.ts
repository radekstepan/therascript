import { db, run, all, get } from '@therascript/db';
import type { BackendChatMessage } from '@therascript/domain';

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
const selectAllMessagesSql = `SELECT * FROM messages ORDER BY id ASC`;

export const messageRepository = {
  addMessage: (
    chatId: number,
    sender: 'user' | 'ai' | 'system',
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
      const newId = info.lastInsertRowid as number;
      const newMsg = get<BackendChatMessage>(selectMessageByIdSql, newId);
      if (!newMsg)
        throw new Error('Failed retrieve msg immediately after insert');
      console.log(
        `[MessageRepo AddMessage] Inserted message ${newId} for chat ${chatId}.`
      );
      return newMsg;
    } catch (error) {
      console.error(`DB error adding message to chat ${chatId}:`, error);
      throw new Error('DB error adding message');
    }
  },

  findMessagesByChatId: (chatId: number): BackendChatMessage[] => {
    try {
      const messages = all<BackendChatMessage>(
        selectMessagesByChatIdSql,
        chatId
      );
      return messages ?? [];
    } catch (error) {
      console.error(`DB error fetching messages for chat ${chatId}:`, error);
      throw new Error(`Database error fetching messages.`);
    }
  },

  findMessageById: (messageId: number): BackendChatMessage | null => {
    try {
      const messageRow = get<BackendChatMessage>(
        selectMessageByIdSql,
        messageId
      );
      return messageRow ?? null;
    } catch (error) {
      console.error(`DB error fetching message ${messageId}:`, error);
      throw new Error(`Database error fetching message.`);
    }
  },

  findAll: (): BackendChatMessage[] => {
    try {
      return all<BackendChatMessage>(selectAllMessagesSql);
    } catch (error) {
      console.error(`DB error fetching all messages:`, error);
      throw new Error(`Database error fetching all messages.`);
    }
  },
};
