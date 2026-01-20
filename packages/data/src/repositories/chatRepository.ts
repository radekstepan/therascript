import { db, run, all, get } from '@therascript/db';
import type {
  BackendChatSession,
  BackendChatMessage,
  ChatMetadata,
} from '@therascript/domain';

const parseTags = (tagsJson: string | null): string[] | null => {
  if (!tagsJson) return null;
  try {
    const parsed = JSON.parse(tagsJson);
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === 'string')
    ) {
      return parsed;
    }
    console.warn(
      `[ChatRepo] Invalid tags JSON found in DB: ${tagsJson}. Returning null.`
    );
    return null;
  } catch (e) {
    console.warn(
      `[ChatRepo] Error parsing tags JSON: ${tagsJson}. Error: ${e}. Returning null.`
    );
    return null;
  }
};

type RawChatRow = Omit<BackendChatSession, 'tags' | 'messages'> & {
  tags: string | null;
};

const insertChatSql =
  'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)';
const selectChatsBySessionIdSql =
  'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId = ? ORDER BY timestamp DESC';
const selectStandaloneChatsSql =
  'SELECT id, sessionId, timestamp, name, tags FROM chats WHERE sessionId IS NULL ORDER BY timestamp DESC';
const selectMessagesByChatIdSql =
  'SELECT * FROM messages WHERE chatId = ? ORDER BY id ASC';
const selectChatByIdSql = 'SELECT * FROM chats WHERE id = ?';
const updateChatDetailsSql = 'UPDATE chats SET name = ?, tags = ? WHERE id = ?';
const deleteChatSql = 'DELETE FROM chats WHERE id = ?';

const findChatWithMessages = (chatId: number): BackendChatSession | null => {
  try {
    const chatRow = get<RawChatRow>(selectChatByIdSql, chatId);
    if (!chatRow) return null;
    const messages = all<BackendChatMessage>(selectMessagesByChatIdSql, chatId);
    const tagsArray = parseTags(chatRow.tags);
    const result: BackendChatSession = {
      id: chatRow.id,
      sessionId: chatRow.sessionId ?? null,
      timestamp: chatRow.timestamp,
      name: chatRow.name ?? null,
      tags: tagsArray,
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
      const info = run(insertChatSql, sessionId, timestamp, null, null);
      const newChatId = info.lastInsertRowid as number;
      const newChatSession = findChatWithMessages(newChatId);
      if (!newChatSession)
        throw new Error(
          `Failed retrieve chat ${newChatId} immediately after creation.`
        );
      console.log(
        `[ChatRepo] Created ${sessionId ? 'session' : 'standalone'} chat ${newChatId}${sessionId ? ' in session ' + sessionId : ''}`
      );
      return newChatSession;
    } catch (error) {
      console.error(
        `DB error creating chat ${sessionId ? `for session ${sessionId}` : '(standalone)'}:`,
        error
      );
      throw new Error(
        `Database error creating chat: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  findChatsBySessionId: (
    sessionId: number
  ): (ChatMetadata & { sessionId: number })[] => {
    try {
      const chatRows = all<RawChatRow>(selectChatsBySessionIdSql, sessionId);
      return chatRows.map((chat) => ({
        id: chat.id,
        sessionId: chat.sessionId as number,
        timestamp: chat.timestamp,
        name: chat.name ?? null,
        tags: parseTags(chat.tags),
      }));
    } catch (error) {
      console.error(`DB error fetching chats for session ${sessionId}:`, error);
      throw new Error(`Database error fetching chats.`);
    }
  },

  findStandaloneChats: (): (ChatMetadata & { sessionId: null })[] => {
    try {
      const chatRows = all<RawChatRow>(selectStandaloneChatsSql);
      return chatRows.map((chat) => ({
        id: chat.id,
        sessionId: null,
        timestamp: chat.timestamp,
        name: chat.name ?? null,
        tags: parseTags(chat.tags),
      }));
    } catch (error) {
      console.error(`DB error fetching standalone chats:`, error);
      throw new Error(`Database error fetching standalone chats.`);
    }
  },

  findChatById: (chatId: number): BackendChatSession | null => {
    return findChatWithMessages(chatId);
  },

  updateChatDetails: (
    chatId: number,
    name: string | null,
    tags: string[] | null
  ): ChatMetadata | null => {
    try {
      const tagsJson = tags && tags.length > 0 ? JSON.stringify(tags) : null;
      run(updateChatDetailsSql, name, tagsJson, chatId);
      const updatedChatSession = findChatWithMessages(chatId);
      if (!updatedChatSession) return null;
      const { messages, ...metadata } = updatedChatSession;
      return metadata;
    } catch (error) {
      console.error(`DB error updating details for chat ${chatId}:`, error);
      throw new Error(`Database error updating chat details.`);
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
