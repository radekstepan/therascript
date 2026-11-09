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
import config from '@therascript/config';
import {
  db,
  SYSTEM_PROMPT_TEMPLATES,
  rebuildAllSearchIndexes,
  rebuildTranscriptSearch,
  rebuildMessageSearch,
  type SQLiteDatabase,
} from '@therascript/db';
import {
  sessionRepository,
  transcriptRepository,
  chatRepository,
  messageRepository,
  templateRepository,
  analysisRepository,
  verificationRepository,
} from '@therascript/data';
import {
  verificationJobSchema,
  messageVerificationSchema,
  verifiedStatementSchema,
  statementReviewSchema,
} from '@therascript/domain';
import {
  BadRequestError,
  InternalServerError,
  UnauthorizedError,
} from '../errors.js';
import type {
  BackendSession,
  TranscriptParagraphData,
  BackendChatMessage,
} from '@therascript/domain';
import { deleteAllUploads, getUploadsDir } from '@therascript/services';
import {
  encryptBackupStream,
  decryptBackupStream,
  isEncryptedBackup,
  validateArchiveEntry,
  resolveArchiveEntryPath,
  encryptRecording,
  decryptRecording,
  VaultAuthError,
  VaultFormatError,
  VaultLockedError,
  type VaultKdfParams,
} from '@therascript/vault';
import { getVaultManager } from '../services/vaultManager.js';
import tar from 'tar-stream';
import { z } from 'zod';
import { Readable } from 'stream';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  // Vault mode has no Elasticsearch index: rebuild the in-database FTS
  // indexes instead (same response contract for the admin UI).
  if (getVaultManager().isProtectionActive()) {
    console.log('[Service] Rebuilding FTS search indexes...');
    try {
      rebuildAllSearchIndexes();
      const transcripts = transcriptRepository.findAll();
      const messages = messageRepository.findAll();
      return {
        message: `Re-indexing complete. Transcripts: ${transcripts.length}, Messages: ${messages.length}.`,
        transcriptsIndexed: transcripts.length,
        messagesIndexed: messages.length,
        errors: [],
      };
    } catch (error: any) {
      return {
        message: 'Re-indexing failed critically.',
        transcriptsIndexed: 0,
        messagesIndexed: 0,
        errors: [error.message],
      };
    }
  }
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
  // Vault mode keeps no Elasticsearch index; the FTS triggers clean the
  // in-database indexes automatically as rows are deleted below.
  if (!getVaultManager().isProtectionActive()) {
    try {
      await deleteIndex(esClient, TRANSCRIPTS_INDEX).catch(() => {});
      await deleteIndex(esClient, MESSAGES_INDEX).catch(() => {});
      await initializeIndices(esClient);
    } catch (e: any) {
      errors.push(`Error resetting Elasticsearch: ${e.message || String(e)}`);
    }
  }
  try {
    db.transaction(() => {
      // Wipe user data children-first (foreign keys are ON). Tables are
      // never dropped, so the full migration-built schema — including the
      // verification tables, app_settings, and system templates — stays
      // intact and queryable after a reset, and user_version is untouched.
      db.exec('DELETE FROM verification_statement_reviews');
      db.exec('DELETE FROM verified_statements');
      db.exec('DELETE FROM message_verifications');
      db.exec('DELETE FROM verification_jobs');
      db.exec('DELETE FROM intermediate_summaries');
      db.exec('DELETE FROM analysis_job_sessions');
      db.exec('DELETE FROM analysis_jobs');
      db.exec('DELETE FROM messages');
      db.exec('DELETE FROM chats');
      db.exec('DELETE FROM transcript_paragraphs');
      db.exec('DELETE FROM sessions');
      db.exec('DELETE FROM usage_logs');
      // Delete only non-system templates; seeded system prompts
      // (system_prompt, system_verification_judge, ...) survive a reset.
      const systemTitles = Object.values(SYSTEM_PROMPT_TEMPLATES).map(
        (t) => t.title
      );
      const placeholders = systemTitles.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM templates WHERE title NOT IN (${placeholders})`
      ).run(...systemTitles);
      // Restart AUTOINCREMENT counters so a fresh start begins at id 1.
      db.exec('DELETE FROM sqlite_sequence');
      // This table is no longer used, but good to clean up from old versions
      db.exec('DROP TABLE IF EXISTS schema_metadata');
    })();
  } catch (e: any) {
    errors.push(`Error resetting SQLite database: ${e.message || String(e)}`);
  }
  try {
    // Vault recordings live in the active generation, not the legacy
    // uploads dir: clear the encrypted payloads in place.
    if (getVaultManager().isProtectionActive()) {
      const generation = getVaultManager().getActiveGenerationPaths();
      if (generation) {
        const entries = await fs.readdir(generation.recordingsDir);
        for (const entry of entries) {
          await fs.rm(path.join(generation.recordingsDir, entry), {
            recursive: true,
            force: true,
          });
        }
      }
    } else {
      await deleteAllUploads();
    }
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

/**
 * Logical database snapshot shared by the plaintext and encrypted
 * exporters: table name → pretty-printed JSON payload.
 */
const buildDbSnapshotJson = (): Record<string, string> => {
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
    intermediate_summaries: analysisRepository.findAllIntermediateSummaries(),
    verification_jobs: verificationRepository.findAllJobsForBackup(),
    message_verifications:
      verificationRepository.findAllMessageVerificationsForBackup(),
    verified_statements:
      verificationRepository.findAllVerifiedStatementsForBackup(),
    verification_statement_reviews:
      verificationRepository.findAllStatementReviewsForBackup(),
  };
  return Object.fromEntries(
    Object.entries(dbData).map(([key, value]) => [
      `${key}.json`,
      JSON.stringify(value, null, 2),
    ])
  );
};

export const exportDataService = async (): Promise<Readable> => {
  const pack = tar.pack();
  const readable = Readable.from(pack);
  const createTarballPromise = async () => {
    try {
      const snapshotJson = buildDbSnapshotJson();
      for (const [name, json] of Object.entries(snapshotJson)) {
        pack.entry({ name }, json);
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
  status: z.enum(['pending', 'queued', 'transcribing', 'completed', 'failed']),
  whisperJobId: z.string().nullable(),
  transcriptTokenCount: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  showSpeakers: z.number().nullable().optional(),
  numSpeakers: z.number().nullable().optional(),
  therapistNote: z.string().nullable().optional(),
  therapistNoteUpdatedAt: z.number().nullable().optional(),
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
  sender: z.enum(['user', 'ai', 'system']),
  text: z.string(),
  timestamp: z.number(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
  // Author-model attribution (messages.model). Optional so backups taken
  // before the field existed still import cleanly.
  model: z.string().nullable().optional(),
  duration: z.number().nullable().optional(),
  // The repository maps the column to boolean on read; legacy backups
  // may carry the raw number. Normalized back to 0/1 on insert.
  isTruncated: z.union([z.number(), z.boolean()]).nullable().optional(),
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
  speaker: z.string().nullable().optional(),
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
  short_prompt: z.string().nullable().optional(),
  strategy_json: z.string().nullable().optional(),
  thinking_budget: z.number().nullable().optional(),
  temperature: z.number().nullable().optional(),
  top_p: z.number().nullable().optional(),
  repeat_penalty: z.number().nullable().optional(),
  num_gpu_layers: z.number().nullable().optional(),
  map_phase_system_prompt: z.string().nullable().optional(),
  llm_base_url: z.string().nullable().optional(),
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

// Remaps the old session ids stored in a verification job's
// `session_ids_json` array through the import's old-to-new id map.
// Unparseable or non-array payloads pass through untouched.
// Verification job statuses that the hasActiveVerificationJobs() guard
// treats as running. A backup taken mid-audit contains such rows, but
// the restore target has an empty queue with no worker processing
// them, so they must be reconciled into a terminal state on import.
const INTERRUPTED_VERIFICATION_JOB_STATUSES = new Set([
  'pending',
  'processing',
  'canceling',
]);

const INTERRUPTED_RESTORE_ERROR_MESSAGE =
  'Job interrupted by backup restore: it was still active when the backup was taken, and the restored queue has no worker running it. Start a new audit to retry.';

const remapSessionIdsJson = (
  value: string | null,
  oldToNewSessionIdMap: Record<number, number>
): string | null => {
  if (value == null) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return value;
    return JSON.stringify(
      parsed.map((id) =>
        typeof id === 'number' ? (oldToNewSessionIdMap[id] ?? id) : id
      )
    );
  } catch {
    return value;
  }
};

// --- BACKUP SNAPSHOT (shared by the legacy and staged import paths) ---

interface BackupSnapshot {
  sessions: z.infer<typeof SessionSchema>[];
  chats: z.infer<typeof ChatSchema>[];
  messages: z.infer<typeof MessageSchema>[];
  templates: z.infer<typeof TemplateSchema>[];
  transcript_paragraphs: z.infer<typeof TranscriptParagraphSchema>[];
  analysis_jobs: z.infer<typeof AnalysisJobSchema>[];
  analysis_job_sessions: z.infer<typeof AnalysisJobSessionSchema>[];
  intermediate_summaries: z.infer<typeof IntermediateSummarySchema>[];
  verification_jobs: z.infer<typeof verificationJobSchema>[];
  message_verifications: z.infer<typeof messageVerificationSchema>[];
  verified_statements: z.infer<typeof verifiedStatementSchema>[];
  verification_statement_reviews: z.infer<typeof statementReviewSchema>[];
}

export interface RestoreIdMaps {
  sessions: Record<number, number>;
  chats: Record<number, number>;
  messages: Record<number, number>;
  analysisJobs: Record<number, number>;
  verificationJobs: Record<number, number>;
  messageVerifications: Record<number, number>;
  statements: Record<number, number>;
}

const parseBackupDataFiles = (
  dataFiles: Record<string, any>
): BackupSnapshot => {
  const sessions = z.array(SessionSchema).parse(dataFiles['sessions.json']);
  const chats = z.array(ChatSchema).parse(dataFiles['chats.json']);
  const messages = z.array(MessageSchema).parse(dataFiles['messages.json']);
  const templates = z.array(TemplateSchema).parse(dataFiles['templates.json']);
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
  // Verification files are optional so backups created before the audit
  // feature still import cleanly.
  const verification_jobs = z
    .array(verificationJobSchema)
    .optional()
    .default([])
    .parse(dataFiles['verification_jobs.json']);
  const message_verifications = z
    .array(messageVerificationSchema)
    .optional()
    .default([])
    .parse(dataFiles['message_verifications.json']);
  const verified_statements = z
    .array(verifiedStatementSchema)
    .optional()
    .default([])
    .parse(dataFiles['verified_statements.json']);
  // Human confirmations are optional: legacy backups predate reviews and
  // import as an empty set.
  const verification_statement_reviews = z
    .array(statementReviewSchema)
    .optional()
    .default([])
    .parse(dataFiles['verification_statement_reviews.json']);

  return {
    sessions,
    chats,
    messages,
    templates,
    transcript_paragraphs,
    analysis_jobs,
    analysis_job_sessions,
    intermediate_summaries,
    verification_jobs,
    message_verifications,
    verified_statements,
    verification_statement_reviews,
  };
};

/**
 * Restores a validated snapshot into `target` (the live database for the
 * legacy path, a staged generation database for the vault path) with
 * old-to-new id remapping. Audio references are normalized for the
 * target: vault rows always end in `.enc`, legacy rows never do.
 */
const restoreSnapshotToDb = (
  target: SQLiteDatabase,
  snapshot: BackupSnapshot,
  options: { audioPathSuffix: '.enc' | '' }
): RestoreIdMaps => {
  const {
    sessions,
    chats,
    messages,
    templates,
    transcript_paragraphs,
    analysis_jobs,
    analysis_job_sessions,
    intermediate_summaries,
    verification_jobs,
    message_verifications,
    verified_statements,
    verification_statement_reviews,
  } = snapshot;
  const mapAudioPath = (audioPath: string | null): string | null => {
    if (audioPath === null) return null;
    if (options.audioPathSuffix === '.enc') {
      return audioPath.endsWith('.enc') ? audioPath : `${audioPath}.enc`;
    }
    return audioPath.endsWith('.enc')
      ? audioPath.slice(0, -'.enc'.length)
      : audioPath;
  };
  const oldToNewSessionIdMap: Record<number, number> = {};
  const oldToNewChatIdMap: Record<number, number> = {};
  const oldToNewMessageIdMap: Record<number, number> = {};
  const oldToNewAnalysisJobIdMap: Record<number, number> = {};
  const oldToNewVerificationJobIdMap: Record<number, number> = {};
  const oldToNewMessageVerificationIdMap: Record<number, number> = {};
  const oldToNewStatementIdMap: Record<number, number> = {};
  target.transaction(() => {
    sessions.forEach((s) => {
      const { id, ...rest } = s;
      const res = target
        .prepare(
          'INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath, status, whisperJobId, transcriptTokenCount, duration, errorMessage, showSpeakers, numSpeakers, therapistNote, therapistNoteUpdatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          rest.fileName,
          rest.clientName,
          rest.sessionName,
          rest.date,
          rest.sessionType,
          rest.therapy,
          mapAudioPath(rest.audioPath),
          rest.status,
          rest.whisperJobId,
          rest.transcriptTokenCount ?? null,
          rest.duration ?? null,
          rest.errorMessage ?? null,
          rest.showSpeakers ?? 1,
          rest.numSpeakers ?? null,
          rest.therapistNote ?? null,
          rest.therapistNoteUpdatedAt ?? null
        );
      oldToNewSessionIdMap[id] = res.lastInsertRowid as number;
    });
    analysis_jobs.forEach((job) => {
      const { id, ...rest } = job;
      const res = target
        .prepare(
          'INSERT INTO analysis_jobs (original_prompt, status, final_result, error_message, created_at, completed_at, model_name, context_size, short_prompt, strategy_json, thinking_budget, temperature, top_p, repeat_penalty, num_gpu_layers, map_phase_system_prompt, llm_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          rest.original_prompt,
          rest.status,
          rest.final_result,
          rest.error_message,
          rest.created_at,
          rest.completed_at,
          rest.model_name,
          rest.context_size,
          rest.short_prompt ?? 'Analysis Job',
          rest.strategy_json ?? null,
          rest.thinking_budget ?? null,
          rest.temperature ?? null,
          rest.top_p ?? null,
          rest.repeat_penalty ?? null,
          rest.num_gpu_layers ?? null,
          rest.map_phase_system_prompt ?? null,
          rest.llm_base_url ?? null
        );
      oldToNewAnalysisJobIdMap[id] = res.lastInsertRowid as number;
    });
    analysis_job_sessions.forEach((ajs) => {
      const newJobId = oldToNewAnalysisJobIdMap[ajs.analysis_job_id];
      const newSessionId = oldToNewSessionIdMap[ajs.session_id];
      if (newJobId && newSessionId) {
        target
          .prepare(
            'INSERT INTO analysis_job_sessions (analysis_job_id, session_id) VALUES (?, ?)'
          )
          .run(newJobId, newSessionId);
      }
    });
    intermediate_summaries.forEach((is) => {
      const { id, ...rest } = is;
      const newJobId = oldToNewAnalysisJobIdMap[rest.analysis_job_id];
      const newSessionId = oldToNewSessionIdMap[rest.session_id];
      if (newJobId && newSessionId) {
        target
          .prepare(
            'INSERT INTO intermediate_summaries (analysis_job_id, session_id, summary_text, status, error_message) VALUES (?, ?, ?, ?, ?)'
          )
          .run(
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
      const res = target
        .prepare(
          'INSERT INTO chats (sessionId, timestamp, name, tags) VALUES (?, ?, ?, ?)'
        )
        .run(newSid, rest.timestamp, rest.name, tagsJson);
      oldToNewChatIdMap[id] = res.lastInsertRowid as number;
    });
    messages.forEach((m) => {
      const newCid = oldToNewChatIdMap[m.chatId];
      if (newCid) {
        const res = target
          .prepare(
            'INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, model, duration, isTruncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(
            newCid,
            m.sender,
            m.text,
            m.timestamp,
            m.promptTokens ?? null,
            m.completionTokens ?? null,
            m.model ?? null,
            m.duration ?? null,
            m.isTruncated == null ? null : m.isTruncated ? 1 : 0
          );
        oldToNewMessageIdMap[m.id] = res.lastInsertRowid as number;
      }
    });
    transcript_paragraphs.forEach((p) => {
      const newSid = oldToNewSessionIdMap[p.sessionId];
      if (newSid)
        target
          .prepare(
            'INSERT INTO transcript_paragraphs (sessionId, paragraphIndex, timestampMs, text, speaker) VALUES (?, ?, ?, ?, ?)'
          )
          .run(
            newSid,
            p.paragraphIndex,
            p.timestampMs,
            p.text,
            p.speaker ?? null
          );
    });

    // --- FIX: Use UPSERT for templates to handle system prompts ---
    const upsertTemplateStmt = target.prepare(
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

    verification_jobs.forEach((job) => {
      const { id, ...rest } = job;
      const newChatId =
        rest.chat_id != null ? (oldToNewChatIdMap[rest.chat_id] ?? null) : null;
      // Active rows have no corresponding queue work after a restore,
      // so reconciling them to failed keeps hasActiveVerificationJobs()
      // from blocking new audits forever. Terminal rows keep their
      // original status and completion metadata verbatim.
      const wasInterrupted = INTERRUPTED_VERIFICATION_JOB_STATUSES.has(
        rest.status
      );
      const res = target
        .prepare(
          'INSERT INTO verification_jobs (status, scope, session_ids_json, chat_id, skip_verified, total_messages, processed_messages, succeeded_messages, failed_messages, skipped_messages, total_statements, flagged_statements, omissions_count, created_at, completed_at, error_message, model_name, context_size, thinking_budget, temperature, top_p, repeat_penalty, num_gpu_layers, llm_base_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          wasInterrupted ? 'failed' : rest.status,
          rest.scope,
          remapSessionIdsJson(rest.session_ids_json, oldToNewSessionIdMap),
          newChatId,
          rest.skip_verified ? 1 : 0,
          rest.total_messages,
          rest.processed_messages,
          // Pre-V21 backups lack outcome counters; inactive rows keep
          // whatever was backed up while interrupted rows are already
          // terminal `failed` with their attempts preserved.
          (rest as { succeeded_messages?: number }).succeeded_messages ?? 0,
          (rest as { failed_messages?: number }).failed_messages ?? 0,
          (rest as { skipped_messages?: number }).skipped_messages ?? 0,
          rest.total_statements,
          rest.flagged_statements,
          rest.omissions_count,
          rest.created_at,
          wasInterrupted
            ? (rest.completed_at ?? Date.now())
            : rest.completed_at,
          wasInterrupted
            ? INTERRUPTED_RESTORE_ERROR_MESSAGE
            : rest.error_message,
          rest.model_name,
          rest.context_size,
          rest.thinking_budget,
          rest.temperature,
          rest.top_p,
          rest.repeat_penalty,
          rest.num_gpu_layers,
          rest.llm_base_url
        );
      oldToNewVerificationJobIdMap[id] = res.lastInsertRowid as number;
    });
    message_verifications.forEach((mv) => {
      const newMessageId = oldToNewMessageIdMap[mv.message_id];
      const newChatId = oldToNewChatIdMap[mv.chat_id];
      const newSessionId = oldToNewSessionIdMap[mv.session_id];
      if (!newMessageId || !newChatId || !newSessionId) return;
      const newJobId =
        mv.verification_job_id != null
          ? (oldToNewVerificationJobIdMap[mv.verification_job_id] ?? null)
          : null;
      const res = target
        .prepare(
          'INSERT INTO message_verifications (message_id, chat_id, session_id, verification_job_id, authored_model, judge_model, status, total_claims, supported_claims, partial_claims, contradicted_claims, fabricated_claims, omissions_count, accuracy_score, summary_assessment, prompt_tokens, completion_tokens, duration_ms, verified_at, error_message, error_code, material_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          newMessageId,
          newChatId,
          newSessionId,
          newJobId,
          mv.authored_model,
          mv.judge_model,
          mv.status,
          mv.total_claims,
          mv.supported_claims,
          mv.partial_claims,
          mv.contradicted_claims,
          mv.fabricated_claims,
          mv.omissions_count,
          mv.accuracy_score,
          mv.summary_assessment,
          mv.prompt_tokens,
          mv.completion_tokens,
          mv.duration_ms,
          mv.verified_at,
          mv.error_message,
          // Pre-V21 backups lack failure codes.
          (mv as { error_code?: string | null }).error_code ?? null,
          // Pre-V22 backups lack material revisions; recompute backfills.
          (mv as { material_revision?: string | null }).material_revision ??
            null
        );
      oldToNewMessageVerificationIdMap[mv.id] = res.lastInsertRowid as number;
    });
    verified_statements.forEach((st) => {
      const newVerificationId =
        oldToNewMessageVerificationIdMap[st.message_verification_id];
      const newMessageId = oldToNewMessageIdMap[st.message_id];
      const newSessionId = oldToNewSessionIdMap[st.session_id];
      if (!newVerificationId || !newMessageId || !newSessionId) return;
      const res = target
        .prepare(
          'INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json, created_at, finding_key, context_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          newVerificationId,
          newMessageId,
          newSessionId,
          st.statement_index,
          st.kind,
          st.exact_quote,
          st.normalized_claim,
          st.start_char,
          st.end_char,
          st.verdict,
          st.severity,
          st.confidence,
          st.reasoning,
          st.transcript_evidence_json,
          st.created_at,
          // Pre-V22 backups lack finding identity; recompute below
          // backfills from content.
          (st as { finding_key?: string | null }).finding_key ?? null,
          (st as { context_revision?: string | null }).context_revision ?? null
        );
      oldToNewStatementIdMap[st.id] = res.lastInsertRowid as number;
    });
    verification_statement_reviews.forEach((review) => {
      const newMessageId = oldToNewMessageIdMap[review.message_id];
      const newSessionId = oldToNewSessionIdMap[review.session_id];
      if (!newMessageId || !newSessionId) return;
      // Content fingerprints (context_revision/finding_key) survive
      // remapping verbatim; only message/session/statement associations
      // are remapped. Snapshots import without requiring an extant old
      // statement row; ambiguous row associations that cannot be remapped
      // become inert history (NULL) rather than pointing at a wrong row.
      const newStatementId =
        review.confirmed_statement_id != null
          ? (oldToNewStatementIdMap[review.confirmed_statement_id] ?? null)
          : null;
      target
        .prepare(
          'INSERT INTO verification_statement_reviews (message_id, session_id, identity_version, context_revision, finding_key, reusable, confirmed_statement_id, confirmed_at, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          newMessageId,
          newSessionId,
          review.identity_version,
          review.context_revision,
          review.finding_key,
          review.reusable ? 1 : 0,
          newStatementId,
          review.confirmed_at,
          review.kind,
          review.exact_quote,
          review.normalized_claim,
          review.start_char,
          review.end_char,
          review.verdict,
          review.severity,
          review.confidence,
          review.reasoning,
          review.transcript_evidence_json
        );
    });
  })();

  return {
    sessions: oldToNewSessionIdMap,
    chats: oldToNewChatIdMap,
    messages: oldToNewMessageIdMap,
    analysisJobs: oldToNewAnalysisJobIdMap,
    verificationJobs: oldToNewVerificationJobIdMap,
    messageVerifications: oldToNewMessageVerificationIdMap,
    statements: oldToNewStatementIdMap,
  };
};

export const importDataService = async (
  backupFile: File,
  options: { backupPassword?: string } = {}
): Promise<{ message: string }> => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'therascript-import-')
  );
  try {
    const source = await readBackupFileStream(
      backupFile,
      options.backupPassword
    );
    const { dataFiles, uploadsDir } = await extractBackupArchive(source, {
      stagingDir: tempDir,
    });
    const snapshot = parseBackupDataFiles(dataFiles);

    if (getVaultManager().isProtectionActive()) {
      return await importSnapshotIntoVault(snapshot, uploadsDir);
    }

    await resetAllDataService();
    const maps = restoreSnapshotToDb(db, snapshot, { audioPathSuffix: '' });

    // Restored effective aggregates are recomputed (not trusted blindly):
    // matching reviews re-apply through content fingerprints, so confirmed
    // findings stay confirmed with correct counts after remapping.
    for (const mv of snapshot.message_verifications) {
      const newMessageId = maps.messages[mv.message_id];
      if (newMessageId) {
        verificationRepository.recomputeEffectiveVerificationForMessage(
          newMessageId
        );
      }
    }

    const uploadsDestDir = getUploadsDir();
    const audioFiles = await fs.readdir(uploadsDir).catch(() => []);
    for (const file of audioFiles) {
      await fs.copyFile(
        path.join(uploadsDir, file),
        path.join(uploadsDestDir, file)
      );
    }
    await reindexElasticsearchService();

    return { message: 'Import successful. Data has been restored.' };
  } catch (error) {
    // Vault path: staged generations are already discarded by the import
    // orchestration, so the live vault is untouched — just map the error.
    if (getVaultManager().isProtectionActive()) {
      if (error instanceof VaultAuthError) {
        throw new UnauthorizedError('Incorrect backup password');
      }
      if (error instanceof VaultFormatError) {
        throw new BadRequestError(error.message);
      }
      if (error instanceof z.ZodError) {
        throw new BadRequestError(
          'Invalid backup archive contents',
          JSON.stringify(error.issues.slice(0, 5))
        );
      }
      throw new InternalServerError(
        `Failed to import backup: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
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

// --- ENCRYPTED BACKUP ---

const TOP_LEVEL_JSON_PATTERN = /^[^/]+\.json$/;
const MAX_BACKUP_ENTRIES = 100_000;
const MAX_BACKUP_TOTAL_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

/**
 * Reads an uploaded backup file as a plaintext tar stream, decrypting
 * encrypted (`.tvbak`) archives with the backup password first. The
 * authenticated end-of-stream is verified as the stream is consumed, so
 * import commits only after the whole archive authenticated.
 */
const readBackupFileStream = async (
  backupFile: File,
  backupPassword?: string
): Promise<Readable> => {
  const webStream = Readable.fromWeb(backupFile.stream() as any);
  const reader = webStream[Symbol.asyncIterator]();
  let head = Buffer.alloc(0);
  while (head.length < 6) {
    const next = await reader.next();
    if (next.done) break;
    head = Buffer.concat([head, Buffer.from(next.value as Buffer)]);
  }
  async function* full(): AsyncGenerator<Buffer> {
    if (head.length > 0) yield head;
    for (;;) {
      const next = await reader.next();
      if (next.done) break;
      yield Buffer.from(next.value as Buffer);
    }
  }
  if (isEncryptedBackup(head)) {
    if (!backupPassword) {
      throw new VaultAuthError('Backup password required');
    }
    return decryptBackupStream(full(), backupPassword);
  }
  return Readable.from(full());
};

export interface ExtractedBackup {
  dataFiles: Record<string, any>;
  uploadsDir: string;
}

/**
 * Extracts a plaintext tar stream into `stagingDir`, validating every
 * entry (path, type, size) before it touches disk. Only top-level
 * `*.json` tables and `uploads/*` payloads are accepted.
 */
export const extractBackupArchive = async (
  source: Readable,
  options: {
    stagingDir: string;
    maxEntryBytes?: number;
    maxTotalBytes?: number;
    maxEntries?: number;
  }
): Promise<ExtractedBackup> => {
  const maxEntryBytes = options.maxEntryBytes ?? 1024 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_BACKUP_TOTAL_BYTES;
  const maxEntries = options.maxEntries ?? MAX_BACKUP_ENTRIES;
  const uploadsDir = path.join(options.stagingDir, 'uploads');
  const dataFiles: Record<string, any> = {};
  let totalBytes = 0;
  let entryCount = 0;
  let failed: Error | null = null;

  const extract = tar.extract();
  const pendingWrites: Promise<void>[] = [];
  // NOTE: failures are recorded and thrown after the pipeline drains.
  // Destroying the extractor from inside its own 'entry' emit throws
  // synchronously out of the emitter (uncaught) instead of rejecting
  // the pipeline — so hostile entries are skipped here and fail below.
  const skipEntry = (stream: NodeJS.ReadableStream, next: () => void): void => {
    stream.resume();
    next();
  };
  extract.on('entry', (header, stream, next) => {
    if (failed) {
      skipEntry(stream, next);
      return;
    }
    entryCount += 1;
    if (entryCount > maxEntries) {
      failed = new VaultFormatError('Backup has too many entries');
      skipEntry(stream, next);
      return;
    }
    try {
      validateArchiveEntry(
        header.name,
        header.size ?? 0,
        header.type ?? undefined,
        {
          maxEntryBytes,
        }
      );
    } catch (error) {
      failed = error as Error;
      skipEntry(stream, next);
      return;
    }
    totalBytes += header.size ?? 0;
    if (totalBytes > maxTotalBytes) {
      failed = new VaultFormatError('Backup exceeds the size limit');
      skipEntry(stream, next);
      return;
    }
    if (header.type === 'directory' || header.name.endsWith('/')) {
      pendingWrites.push(
        fs
          .mkdir(resolveArchiveEntryPath(options.stagingDir, header.name), {
            recursive: true,
          })
          .then(() => undefined)
      );
      stream.resume();
      next();
      return;
    }
    if (TOP_LEVEL_JSON_PATTERN.test(header.name)) {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size > maxEntryBytes && !failed) {
          failed = new VaultFormatError(
            `Backup entry ${JSON.stringify(header.name)} exceeds the size limit`
          );
        }
      });
      stream.on('end', () => {
        if (!failed) {
          try {
            dataFiles[header.name] = JSON.parse(
              Buffer.concat(chunks).toString('utf8')
            );
          } catch (e) {
            console.error(`Error parsing JSON from ${header.name}:`, e);
          }
        }
        next();
      });
      stream.on('error', (error: Error) => {
        if (!failed) failed = error;
      });
      stream.resume();
      return;
    }
    if (header.name.startsWith('uploads/')) {
      const target = resolveArchiveEntryPath(options.stagingDir, header.name);
      const write = (async () => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await pipeline(stream, createWriteStream(target));
      })().then(
        () => next(),
        (error: Error) => {
          if (!failed) failed = error;
          next();
        }
      );
      pendingWrites.push(write);
      return;
    }
    failed = new VaultFormatError(
      `Unexpected backup entry ${JSON.stringify(header.name)}`
    );
    skipEntry(stream, next);
  });
  await pipeline(source, extract);
  await Promise.all(pendingWrites);
  if (failed) throw failed;
  return { dataFiles, uploadsDir };
};

/** Encrypts staged uploads into the staged generation's recordings dir. */
const restoreRecordingsIntoEncryptedStorage = async (
  staged: {
    id: string;
    dir: string;
    dbPath: string;
    keysPath: string;
    sealedPath: string;
    recordingsDir: string;
  },
  uploadsDir: string,
  recordingsKey: Buffer
): Promise<void> => {
  const files = await fs.readdir(uploadsDir).catch(() => []);
  for (const file of files) {
    const source = path.join(uploadsDir, file);
    const stat = await fs.stat(source);
    if (!stat.isFile()) continue;
    const plaintext = await fs.readFile(source);
    if (plaintext.length === 0) {
      throw new VaultFormatError(
        `Backup recording ${JSON.stringify(file)} is empty`
      );
    }
    const encrypted = encryptRecording(plaintext, recordingsKey);
    const target = path.join(staged.recordingsDir, `${file}.enc`);
    await fs.writeFile(target, encrypted, { mode: 0o600 });
    await fs.chmod(target, 0o600);
  }
};

/**
 * Content verification before the staged import commits: integrity +
 * foreign keys, per-table counts against the snapshot, and every audio
 * reference resolving to an encrypted payload.
 */
const verifyRestoredStaged = (
  stagedDb: SQLiteDatabase,
  staged: { recordingsDir: string },
  snapshot: BackupSnapshot
): void => {
  const integrity = stagedDb.prepare('PRAGMA integrity_check').all() as {
    integrity_check: string;
  }[];
  if (
    integrity.length === 0 ||
    integrity.some((row) => row.integrity_check !== 'ok')
  ) {
    throw new VaultFormatError('Staged import failed integrity_check');
  }
  const foreignKeys = stagedDb.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeys.length > 0) {
    throw new VaultFormatError(
      `Staged import has ${foreignKeys.length} foreign-key violation(s)`
    );
  }
  const expectCount = (table: string, expected: number): void => {
    const row = stagedDb
      .prepare(`SELECT COUNT(*) AS total FROM "${table}"`)
      .get() as { total: number };
    if (row.total !== expected) {
      throw new VaultFormatError(
        `Staged import count mismatch on ${table}: expected=${expected} actual=${row.total}`
      );
    }
  };
  expectCount('sessions', snapshot.sessions.length);
  expectCount('chats', snapshot.chats.length);
  expectCount('messages', snapshot.messages.length);
  expectCount('transcript_paragraphs', snapshot.transcript_paragraphs.length);
  expectCount('analysis_jobs', snapshot.analysis_jobs.length);
  expectCount('analysis_job_sessions', snapshot.analysis_job_sessions.length);
  expectCount('intermediate_summaries', snapshot.intermediate_summaries.length);
  expectCount('verification_jobs', snapshot.verification_jobs.length);
  expectCount('message_verifications', snapshot.message_verifications.length);
  expectCount('verified_statements', snapshot.verified_statements.length);
  expectCount(
    'verification_statement_reviews',
    snapshot.verification_statement_reviews.length
  );
  // Templates upsert (system rows merge), so every snapshot title must
  // exist rather than counts matching exactly.
  const titles = (
    stagedDb.prepare('SELECT title FROM templates').all() as {
      title: string;
    }[]
  ).map((row) => row.title);
  for (const template of snapshot.templates) {
    if (!titles.includes(template.title)) {
      throw new VaultFormatError(
        `Staged import lost template ${JSON.stringify(template.title)}`
      );
    }
  }
  const sessions = stagedDb
    .prepare('SELECT audioPath FROM sessions WHERE audioPath IS NOT NULL')
    .all() as { audioPath: string | null }[];
  for (const row of sessions) {
    const base = row.audioPath ? path.basename(row.audioPath) : '';
    if (
      !base.endsWith('.enc') ||
      !existsSync(path.join(staged.recordingsDir, base))
    ) {
      throw new VaultFormatError(
        `Staged import is missing recording for ${JSON.stringify(row.audioPath)}`
      );
    }
  }
};

const importSnapshotIntoVault = async (
  snapshot: BackupSnapshot,
  uploadsDir: string
): Promise<{ message: string }> => {
  const manager = getVaultManager();
  const maps = await manager.importIntoStagedGeneration(
    async (staged, stagedDb) => {
      const restored = restoreSnapshotToDb(stagedDb, snapshot, {
        audioPathSuffix: '.enc',
      });
      await restoreRecordingsIntoEncryptedStorage(
        staged,
        uploadsDir,
        manager.getRecordingsKey()
      );
      rebuildTranscriptSearch(stagedDb);
      rebuildMessageSearch(stagedDb);
      verifyRestoredStaged(stagedDb, staged, snapshot);
      return restored;
    }
  );
  // Aggregates recompute against the now-live database: the existing
  // inserts, ID remapping, and verification recomputation run against
  // staging, then go live on cutover.
  for (const mv of snapshot.message_verifications) {
    const newMessageId = maps.messages[mv.message_id];
    if (newMessageId) {
      verificationRepository.recomputeEffectiveVerificationForMessage(
        newMessageId
      );
    }
  }
  return { message: 'Import successful. Data has been restored.' };
};

const stripEncSuffix = (name: string): string =>
  name.endsWith('.enc') ? name.slice(0, -'.enc'.length) : name;

/**
 * Encrypted backup export: the same logical snapshot as
 * the plaintext exporter, with recordings decrypted from vault storage
 * (or read from legacy uploads), then sealed under the backup password.
 * Fails when any referenced recording is missing — the export promises
 * a restorable archive.
 */
export const exportVaultBackupService = async (
  backupPassword: string,
  kdfParams?: VaultKdfParams
): Promise<Readable> => {
  if (typeof backupPassword !== 'string' || backupPassword.length === 0) {
    throw new BadRequestError('Backup password is required');
  }
  const manager = getVaultManager();
  const vaultActive = manager.isProtectionActive();
  const pack = tar.pack();
  const readable = Readable.from(pack);
  const produceTarball = async () => {
    try {
      const snapshotJson = buildDbSnapshotJson();
      for (const [name, json] of Object.entries(snapshotJson)) {
        pack.entry({ name }, json);
      }
      const sessions = sessionRepository.findAll() as BackendSession[];
      const missing: string[] = [];
      for (const session of sessions) {
        if (!session.audioPath) continue;
        const base = path.basename(session.audioPath);
        if (vaultActive) {
          const generation = manager.getActiveGenerationPaths();
          if (!generation) throw new VaultLockedError();
          let encrypted: Buffer;
          try {
            encrypted = await fs.readFile(
              path.join(generation.recordingsDir, base)
            );
          } catch {
            missing.push(session.audioPath);
            continue;
          }
          const plaintext = decryptRecording(
            encrypted,
            manager.getRecordingsKey()
          );
          pack.entry({ name: `uploads/${stripEncSuffix(base)}` }, plaintext);
        } else {
          let bytes: Buffer;
          try {
            bytes = await fs.readFile(path.join(getUploadsDir(), base));
          } catch {
            missing.push(session.audioPath);
            continue;
          }
          pack.entry({ name: `uploads/${base}` }, bytes);
        }
      }
      if (missing.length > 0) {
        throw new InternalServerError(
          `Backup incomplete: ${missing.length} recording(s) missing (${missing.slice(0, 5).join(', ')})`
        );
      }
    } catch (error) {
      pack.destroy(
        error instanceof Error ? error : new Error('Backup export failed')
      );
      return;
    }
    pack.finalize();
  };
  produceTarball();
  return encryptBackupStream(readable, backupPassword, kdfParams);
};
