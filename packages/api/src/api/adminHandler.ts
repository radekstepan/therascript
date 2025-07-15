import {
  getElasticsearchClient,
  initializeIndices,
  deleteIndex,
  bulkIndexDocuments,
  TRANSCRIPTS_INDEX,
  MESSAGES_INDEX,
  type TranscriptSource,
  type MessageSource,
} from '@therascript/elasticsearch-client';
import config from '../config/index.js';
import { db, schema, verifySchemaVersion } from '@therascript/db';
import { sessionRepository } from '../repositories/sessionRepository.js';
import { transcriptRepository } from '../repositories/transcriptRepository.js';
import { chatRepository } from '../repositories/chatRepository.js';
import { messageRepository } from '../repositories/messageRepository.js';
import { templateRepository } from '../repositories/templateRepository.js';
import { InternalServerError } from '../errors.js';
import type {
  BackendSession,
  TranscriptParagraphData,
  BackendChatMessage,
} from '../types/index.js';
import { deleteAllUploads, getUploadsDir } from '../services/fileService.js';
import tar from 'tar-stream';
import { z } from 'zod';
import { Readable } from 'stream';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';

const esClient = getElasticsearchClient(config.elasticsearch.url);

// --- SERVICE-LEVEL FUNCTIONS (NO ELYSIA CONTEXT) ---

export interface ReindexResult {
  message: string;
  transcriptsIndexed: number;
  messagesIndexed: number;
  errors: string[];
}

export async function reindexElasticsearchService(): Promise<ReindexResult> {
  console.log('[Service] Re-indexing Elasticsearch data...');
  const errors: string[] = [];
  let transcriptsIndexed = 0;
  let messagesIndexed = 0;

  try {
    await deleteIndex(esClient, TRANSCRIPTS_INDEX).catch(() => {});
    await deleteIndex(esClient, MESSAGES_INDEX).catch(() => {});
    await initializeIndices(esClient);

    const allSessions = sessionRepository.findAll();
    const esTranscriptDocsToBulk: Array<{
      id: string;
      document: Partial<TranscriptSource>;
    }> = [];
    const esMessageDocsToBulk: Array<{
      id: string;
      document: Partial<MessageSource>;
    }> = [];

    for (const session of allSessions) {
      if (session.status === 'completed') {
        const paragraphs = transcriptRepository.findParagraphsBySessionId(
          session.id
        );
        for (const p of paragraphs) {
          esTranscriptDocsToBulk.push({
            id: `${session.id}_${p.id}`,
            document: {
              paragraph_id: `${session.id}_${p.id}`,
              session_id: session.id,
              paragraph_index: p.id,
              text: p.text,
              timestamp_ms: p.timestamp,
              client_name: session.clientName,
              session_name: session.sessionName,
              session_date: session.date,
              session_type: session.sessionType,
              therapy_type: session.therapy,
            },
          });
        }
      }
      const chats = chatRepository.findChatsBySessionId(session.id);
      for (const chat of chats) {
        const messages = messageRepository.findMessagesByChatId(chat.id);
        for (const m of messages) {
          esMessageDocsToBulk.push({
            id: String(m.id),
            document: {
              message_id: String(m.id),
              chat_id: m.chatId,
              session_id: session.id,
              sender: m.sender,
              text: m.text,
              timestamp: m.timestamp,
              client_name: session.clientName,
              session_name: session.sessionName,
              chat_name: null,
              tags: null,
            },
          });
        }
      }
    }
    const standaloneChats = chatRepository.findStandaloneChats();
    for (const chat of standaloneChats) {
      const messages = messageRepository.findMessagesByChatId(chat.id);
      for (const m of messages) {
        esMessageDocsToBulk.push({
          id: String(m.id),
          document: {
            message_id: String(m.id),
            chat_id: m.chatId,
            session_id: null,
            sender: m.sender,
            text: m.text,
            timestamp: m.timestamp,
            chat_name: chat.name,
            tags: chat.tags,
            client_name: null,
            session_name: null,
          },
        });
      }
    }
    if (esTranscriptDocsToBulk.length > 0) {
      await bulkIndexDocuments(
        esClient,
        TRANSCRIPTS_INDEX,
        esTranscriptDocsToBulk
      );
      transcriptsIndexed = esTranscriptDocsToBulk.length;
    }
    if (esMessageDocsToBulk.length > 0) {
      await bulkIndexDocuments(esClient, MESSAGES_INDEX, esMessageDocsToBulk);
      messagesIndexed = esMessageDocsToBulk.length;
    }
    return {
      message: `Re-indexing complete. Transcripts: ${transcriptsIndexed}, Messages: ${messagesIndexed}.`,
      transcriptsIndexed,
      messagesIndexed,
      errors,
    };
  } catch (error: any) {
    errors.push(error.message);
    return {
      message: 'Re-indexing failed critically.',
      transcriptsIndexed,
      messagesIndexed,
      errors,
    };
  }
}

export interface ResetResult {
  message: string;
  errors: string[];
}

export async function resetAllDataService(): Promise<ResetResult> {
  const errors: string[] = [];
  try {
    await deleteIndex(esClient, TRANSCRIPTS_INDEX).catch(() => {});
    await deleteIndex(esClient, MESSAGES_INDEX).catch(() => {});
    await initializeIndices(esClient);
  } catch (e: any) {
    errors.push(`Error resetting Elasticsearch: ${e.message || String(e)}`);
  }
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS messages');
      db.exec('DROP TABLE IF EXISTS chats');
      db.exec('DROP TABLE IF EXISTS transcript_paragraphs');
      db.exec('DROP TABLE IF EXISTS sessions');
      db.exec('DROP TABLE IF EXISTS templates');
      db.exec('DROP TABLE IF EXISTS schema_metadata');
    })();
    db.exec(schema);
    verifySchemaVersion(db, schema);
  } catch (e: any) {
    errors.push(`Error resetting SQLite database: ${e.message || String(e)}`);
  }
  try {
    await deleteAllUploads();
  } catch (e: any) {
    errors.push(`Error deleting uploaded files: ${e.message || String(e)}`);
  }
  if (errors.length > 0) {
    return { message: 'Failed to reset all data. See errors.', errors };
  }
  return {
    message: 'Application data and search index have been reset successfully.',
    errors: [],
  };
}

export const exportDataService = async (): Promise<Readable> => {
  const pack = tar.pack();
  const readable = Readable.from(pack);
  const createTarballPromise = async () => {
    try {
      const dbData = {
        sessions: sessionRepository.findAll(),
        chats: [
          ...chatRepository.findStandaloneChats(),
          ...sessionRepository
            .findAll()
            .flatMap((s) => chatRepository.findChatsBySessionId(s.id)),
        ],
        messages: messageRepository.findAll(),
        templates: templateRepository.findAll(),
        transcript_paragraphs: transcriptRepository.findAll(),
      };
      for (const [key, value] of Object.entries(dbData)) {
        pack.entry({ name: `${key}.json` }, JSON.stringify(value, null, 2));
      }
      const uploadsDir = getUploadsDir();
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        const stat = await fs.stat(filePath);
        const fileStream = createReadStream(filePath);
        const entry = pack.entry({ name: `uploads/${file}`, size: stat.size });
        fileStream.pipe(entry);
      }
    } catch (error) {
      pack.destroy(
        error instanceof Error ? error : new Error('Tarball creation failed')
      );
    } finally {
      pack.finalize();
    }
  };
  createTarballPromise();
  return readable;
};

const SessionSchema = z.object({
  id: z.number(),
  fileName: z.string(),
  clientName: z.string(),
  sessionName: z.string(),
  date: z.string(),
  sessionType: z.string(),
  therapy: z.string(),
  audioPath: z.string().nullable(),
  status: z.enum(['pending', 'transcribing', 'completed', 'failed']),
  whisperJobId: z.string().nullable(),
  transcriptTokenCount: z.number().nullable().optional(),
});
const ChatSchema = z.object({
  id: z.number(),
  sessionId: z.number().nullable(),
  timestamp: z.number(),
  name: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
});
const MessageSchema = z.object({
  id: z.number(),
  chatId: z.number(),
  sender: z.enum(['user', 'ai']),
  text: z.string(),
  timestamp: z.number(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
});
const TemplateSchema = z.object({
  id: z.number(),
  title: z.string(),
  text: z.string(),
  createdAt: z.number(),
});
const TranscriptParagraphSchema = z.object({
  id: z.number(),
  sessionId: z.number(),
  paragraphIndex: z.number(),
  timestampMs: z.number(),
  text: z.string(),
});

export const importDataService = async (
  backupFile: File
): Promise<{ message: string }> => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'therascript-import-')
  );
  try {
    const extract = tar.extract();
    const dataFiles: Record<string, any> = {};
    const audioFilesToWrite: Promise<void>[] = [];
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        if (header.name.endsWith('.json')) {
          try {
            dataFiles[header.name] = JSON.parse(
              Buffer.concat(chunks).toString('utf8')
            );
          } catch (e) {
            console.error(`Error parsing JSON from ${header.name}:`, e);
          }
        } else if (header.name.startsWith('uploads/')) {
          const uploadsDir = path.join(tempDir, 'uploads');
          const filePath = path.join(tempDir, header.name);
          audioFilesToWrite.push(
            fs
              .mkdir(uploadsDir, { recursive: true })
              .then(() => fs.writeFile(filePath, Buffer.concat(chunks)))
          );
        }
        next();
      });
      stream.resume();
    });
    await pipeline(Readable.fromWeb(backupFile.stream() as any), extract);
    await Promise.all(audioFilesToWrite);

    const sessions = z.array(SessionSchema).parse(dataFiles['sessions.json']);
    const chats = z.array(ChatSchema).parse(dataFiles['chats.json']);
    const messages = z.array(MessageSchema).parse(dataFiles['messages.json']);
    const templates = z
      .array(TemplateSchema)
      .parse(dataFiles['templates.json']);
    const transcript_paragraphs = z
      .array(TranscriptParagraphSchema)
      .parse(dataFiles['transcript_paragraphs.json']);

    await resetAllDataService();

    const oldToNewSessionIdMap: Record<number, number> = {};
    const oldToNewChatIdMap: Record<number, number> = {};
    db.transaction(() => {
      sessions.forEach((s) => {
        const { id, ...rest } = s;
        const res = db
          .prepare(
            'INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            rest.fileName,
            rest.clientName,
            rest.sessionName,
            rest.date,
            rest.sessionType,
            rest.therapy,
            rest.audioPath,
            rest.status,
            rest.whisperJobId,
            rest.transcriptTokenCount
          );
        oldToNewSessionIdMap[id] = res.lastInsertRowid as number;
      });
      chats.forEach((c) => {
        const { id, ...rest } = c;
        const newSid = rest.sessionId
          ? oldToNewSessionIdMap[rest.sessionId]
          : null;
        if (rest.sessionId && !newSid) return;
        const tagsJson = rest.tags ? JSON.stringify(rest.tags) : null;
        const res = db
          .prepare(
            'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)'
          )
          .run(newSid, rest.timestamp, rest.name, tagsJson);
        oldToNewChatIdMap[id] = res.lastInsertRowid as number;
      });
      messages.forEach((m) => {
        const newCid = oldToNewChatIdMap[m.chatId];
        if (newCid)
          db.prepare(
            'INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            newCid,
            m.sender,
            m.text,
            m.timestamp,
            m.promptTokens,
            m.completionTokens
          );
      });
      transcript_paragraphs.forEach((p) => {
        const newSid = oldToNewSessionIdMap[p.sessionId];
        if (newSid)
          db.prepare(
            'INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text) VALUES (?, ?, ?, ?)'
          ).run(newSid, p.paragraphIndex, p.timestampMs, p.text);
      });
      templates.forEach((t) =>
        db
          .prepare(
            'INSERT INTO templates (title, text, createdAt) VALUES (?, ?, ?)'
          )
          .run(t.title, t.text, t.createdAt)
      );
    })();

    const uploadsSrcDir = path.join(tempDir, 'uploads');
    const uploadsDestDir = getUploadsDir();
    const audioFiles = await fs.readdir(uploadsSrcDir).catch(() => []);
    for (const file of audioFiles) {
      await fs.copyFile(
        path.join(uploadsSrcDir, file),
        path.join(uploadsDestDir, file)
      );
    }
    await reindexElasticsearchService();

    return { message: 'Import successful. Data has been restored.' };
  } catch (error) {
    console.error('[Import] FATAL ERROR during import:', error);
    await resetAllDataService().catch((e) => {});
    throw new InternalServerError(
      `Failed to import backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error instanceof Error ? error : undefined
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch((e) => {});
  }
};
