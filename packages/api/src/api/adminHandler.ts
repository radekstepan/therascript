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
import { db, SYSTEM_PROMPT_TEMPLATES } from '@therascript/db';
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
} from '@therascript/domain';
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
      // Wipe user data children-first (foreign keys are ON). Tables are
      // never dropped, so the full migration-built schema — including the
      // verification tables, app_settings, and system templates — stays
      // intact and queryable after a reset, and user_version is untouched.
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
        verification_jobs: verificationRepository.findAllJobsForBackup(),
        message_verifications:
          verificationRepository.findAllMessageVerificationsForBackup(),
        verified_statements:
          verificationRepository.findAllVerifiedStatementsForBackup(),
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
  // Author-model attribution (messages.model). Optional so backups taken
  // before the field existed still import cleanly.
  model: z.string().nullable().optional(),
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

    await resetAllDataService();

    const oldToNewSessionIdMap: Record<number, number> = {};
    const oldToNewChatIdMap: Record<number, number> = {};
    const oldToNewMessageIdMap: Record<number, number> = {};
    const oldToNewAnalysisJobIdMap: Record<number, number> = {};
    const oldToNewVerificationJobIdMap: Record<number, number> = {};
    const oldToNewMessageVerificationIdMap: Record<number, number> = {};
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
        if (newCid) {
          const res = db
            .prepare(
              'INSERT INTO messages (chatId, sender, text, timestamp, promptTokens, completionTokens, model) VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .run(
              newCid,
              m.sender,
              m.text,
              m.timestamp,
              m.promptTokens ?? null,
              m.completionTokens ?? null,
              m.model ?? null
            );
          oldToNewMessageIdMap[m.id] = res.lastInsertRowid as number;
        }
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

      verification_jobs.forEach((job) => {
        const { id, ...rest } = job;
        const newChatId =
          rest.chat_id != null
            ? (oldToNewChatIdMap[rest.chat_id] ?? null)
            : null;
        // Active rows have no corresponding queue work after a restore,
        // so reconciling them to failed keeps hasActiveVerificationJobs()
        // from blocking new audits forever. Terminal rows keep their
        // original status and completion metadata verbatim.
        const wasInterrupted = INTERRUPTED_VERIFICATION_JOB_STATUSES.has(
          rest.status
        );
        const res = db
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
        const res = db
          .prepare(
            'INSERT INTO message_verifications (message_id, chat_id, session_id, verification_job_id, authored_model, judge_model, status, total_claims, supported_claims, partial_claims, contradicted_claims, fabricated_claims, omissions_count, accuracy_score, summary_assessment, prompt_tokens, completion_tokens, duration_ms, verified_at, error_message, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
            (mv as { error_code?: string | null }).error_code ?? null
          );
        oldToNewMessageVerificationIdMap[mv.id] = res.lastInsertRowid as number;
      });
      verified_statements.forEach((st) => {
        const newVerificationId =
          oldToNewMessageVerificationIdMap[st.message_verification_id];
        const newMessageId = oldToNewMessageIdMap[st.message_id];
        const newSessionId = oldToNewSessionIdMap[st.session_id];
        if (!newVerificationId || !newMessageId || !newSessionId) return;
        db.prepare(
          'INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
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
          st.created_at
        );
      });
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
