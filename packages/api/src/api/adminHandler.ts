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
import { db, schema } from '@therascript/db';
import {
  sessionRepository,
  transcriptRepository,
  chatRepository,
  messageRepository,
  templateRepository,
  analysisRepository,
} from '@therascript/data';
import { InternalServerError } from '../errors.js';
import type {
  BackendSession,
  TranscriptParagraphData,
  BackendChatMessage,
} from '@therascript/domain';
import { deleteAllUploads, getUploadsDir } from '@therascript/services';
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
      // Drop new tables first due to foreign key constraints
      db.exec('DROP TABLE IF EXISTS intermediate_summaries');
      db.exec('DROP TABLE IF EXISTS analysis_job_sessions');
      db.exec('DROP TABLE IF EXISTS analysis_jobs');
      // Drop old tables
      db.exec('DROP TABLE IF EXISTS messages');
      db.exec('DROP TABLE IF EXISTS chats');
      db.exec('DROP TABLE IF EXISTS transcript_paragraphs');
      db.exec('DROP TABLE IF EXISTS sessions');
      db.exec('DROP TABLE IF EXISTS templates');
      // This table is no longer used, but good to clean up from old versions
      db.exec('DROP TABLE IF EXISTS schema_metadata');
    })();

    // Re-create schema from scratch, mimicking the migration process
    // This establishes the "Version 1" state
    db.exec(schema);

    // Manually apply the "Version 2" migration
    db.exec(`
      -- Analysis Jobs Table
      CREATE TABLE IF NOT EXISTS analysis_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_prompt TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', -- e.g., pending, mapping, reducing, completed, failed
          final_result TEXT,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status ON analysis_jobs (status);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created_at ON analysis_jobs (created_at);

      -- Join table for Analysis Jobs and Sessions
      CREATE TABLE IF NOT EXISTS analysis_job_sessions (
          analysis_job_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          PRIMARY KEY (analysis_job_id, session_id),
          FOREIGN KEY (analysis_job_id) REFERENCES analysis_jobs (id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
      );

      -- Intermediate Summaries from the "Map" step
      CREATE TABLE IF NOT EXISTS intermediate_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          analysis_job_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          summary_text TEXT,
          status TEXT NOT NULL DEFAULT 'pending', -- e.g., pending, processing, completed, failed
          error_message TEXT,
          FOREIGN KEY (analysis_job_id) REFERENCES analysis_jobs (id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_intermediate_summaries_job_id ON intermediate_summaries (analysis_job_id);
    `);

    // Manually apply "Version 3" migration
    db.exec('ALTER TABLE analysis_jobs ADD COLUMN model_name TEXT');
    db.exec('ALTER TABLE analysis_jobs ADD COLUMN context_size INTEGER');

    // Set the database version to the latest known version
    db.pragma('user_version = 3');
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
        analysis_jobs: analysisRepository.listJobs(),
        analysis_job_sessions: analysisRepository.findAllJobSessions(),
        intermediate_summaries:
          analysisRepository.findAllIntermediateSummaries(),
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
const AnalysisJobSchema = z.object({
  id: z.number(),
  original_prompt: z.string(),
  status: z.enum([
    'pending',
    'mapping',
    'reducing',
    'completed',
    'failed',
    'canceling',
    'canceled',
  ]),
  final_result: z.string().nullable(),
  error_message: z.string().nullable(),
  created_at: z.number(),
  completed_at: z.number().nullable(),
  model_name: z.string().nullable(),
  context_size: z.number().nullable(),
});

const AnalysisJobSessionSchema = z.object({
  analysis_job_id: z.number(),
  session_id: z.number(),
});

const IntermediateSummarySchema = z.object({
  id: z.number(),
  analysis_job_id: z.number(),
  session_id: z.number(),
  summary_text: z.string().nullable(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  error_message: z.string().nullable(),
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
    const analysis_jobs = z
      .array(AnalysisJobSchema)
      .parse(dataFiles['analysis_jobs.json']);
    const analysis_job_sessions = z
      .array(AnalysisJobSessionSchema)
      .parse(dataFiles['analysis_job_sessions.json']);
    const intermediate_summaries = z
      .array(IntermediateSummarySchema)
      .parse(dataFiles['intermediate_summaries.json']);

    await resetAllDataService();

    const oldToNewSessionIdMap: Record<number, number> = {};
    const oldToNewChatIdMap: Record<number, number> = {};
    const oldToNewAnalysisJobIdMap: Record<number, number> = {};
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
      analysis_jobs.forEach((job) => {
        const { id, ...rest } = job;
        const res = db
          .prepare(
            'INSERT INTO analysis_jobs (original_prompt, status, final_result, error_message, created_at, completed_at, model_name, context_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            rest.original_prompt,
            rest.status,
            rest.final_result,
            rest.error_message,
            rest.created_at,
            rest.completed_at,
            rest.model_name,
            rest.context_size
          );
        oldToNewAnalysisJobIdMap[id] = res.lastInsertRowid as number;
      });
      analysis_job_sessions.forEach((ajs) => {
        const newJobId = oldToNewAnalysisJobIdMap[ajs.analysis_job_id];
        const newSessionId = oldToNewSessionIdMap[ajs.session_id];
        if (newJobId && newSessionId) {
          db.prepare(
            'INSERT INTO analysis_job_sessions (analysis_job_id, session_id) VALUES (?, ?)'
          ).run(newJobId, newSessionId);
        }
      });
      intermediate_summaries.forEach((is) => {
        const { id, ...rest } = is;
        const newJobId = oldToNewAnalysisJobIdMap[rest.analysis_job_id];
        const newSessionId = oldToNewSessionIdMap[rest.session_id];
        if (newJobId && newSessionId) {
          db.prepare(
            'INSERT INTO intermediate_summaries (analysis_job_id, session_id, summary_text, status, error_message) VALUES (?, ?, ?, ?, ?)'
          ).run(
            newJobId,
            newSessionId,
            rest.summary_text,
            rest.status,
            rest.error_message
          );
        }
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

      // --- FIX: Use UPSERT for templates to handle system prompts ---
      const upsertTemplateStmt = db.prepare(
        `INSERT INTO templates (title, text, createdAt) 
         VALUES (?, ?, ?) 
         ON CONFLICT(title) DO UPDATE SET 
           text=excluded.text, 
           createdAt=excluded.createdAt`
      );
      for (const t of templates) {
        upsertTemplateStmt.run(t.title, t.text, t.createdAt);
      }
      // --- END FIX ---
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
