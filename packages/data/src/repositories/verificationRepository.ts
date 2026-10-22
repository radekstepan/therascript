import { db, run, all, get } from '@therascript/db';
import type {
  BackendChatMessage,
  BackendMessageVerification,
  BackendVerificationJob,
  BackendVerifiedStatement,
  ModelAccuracyStat,
  MessageVerificationRow,
  SessionVerificationSummary,
  StatementKind,
  StatementSeverity,
  StatementVerdict,
  TranscriptEvidenceItem,
  VerificationGlobalStats,
  VerifiedStatementRow,
  VerificationJobScope,
  VerificationJobStatus,
  VerificationTimepointStat,
} from '@therascript/domain';

export interface CreateVerificationJobOptions {
  scope: VerificationJobScope;
  sessionIds?: number[] | null;
  chatId?: number | null;
  skipVerified?: boolean;
  modelName?: string | null;
  contextSize?: number | null;
  thinkingBudget?: number | null;
  temperature?: number | null;
  topP?: number | null;
  repeatPenalty?: number | null;
  numGpuLayers?: number | null;
  llmBaseUrl?: string | null;
}

export interface UpdateVerificationJobFields {
  errorMessage?: string | null;
  totalMessages?: number;
  processedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  completedAt?: number | null;
}

export interface VerificationJobCounterDeltas {
  totalMessages?: number;
  processedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
}

export interface VerificationCandidateFilters {
  scope: VerificationJobScope;
  sessionIds?: number[] | null;
  chatId?: number | null;
  skipVerified?: boolean;
  limit?: number | null;
}

export interface VerificationCandidateMessage extends BackendChatMessage {
  sessionId: number;
  userQuestion: string | null;
}

export interface VerificationStatementInput {
  statementIndex: number;
  kind: StatementKind;
  exactQuote: string;
  normalizedClaim: string;
  startChar?: number | null;
  endChar?: number | null;
  verdict: StatementVerdict;
  severity?: StatementSeverity;
  confidence?: number;
  reasoning: string;
  evidence?: TranscriptEvidenceItem[] | null;
}

export interface SaveMessageVerificationInput {
  messageId: number;
  chatId: number;
  sessionId: number;
  verificationJobId?: number | null;
  authoredModel?: string | null;
  judgeModel: string;
  status?: 'completed' | 'failed' | 'skipped';
  totalClaims?: number;
  supportedClaims?: number;
  partialClaims?: number;
  contradictedClaims?: number;
  fabricatedClaims?: number;
  omissionsCount?: number;
  accuracyScore?: number;
  summaryAssessment?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  statements?: VerificationStatementInput[];
}

export interface SessionVerificationDetail {
  sessionId: number;
  totalAiMessages: number;
  verifiedAiMessages: number;
  failedAiMessages: number;
  /** Mean per-message accuracy on the 0–100 percent scale (null when nothing verified). */
  averageAccuracy: number | null;
  flaggedIssues: number;
  omissions: number;
  verifications: BackendMessageVerification[];
}

export interface VerificationAnalyticsFilters {
  sessionIds?: number[] | null;
  model?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface FlaggedStatementsQuery {
  verdicts?: StatementVerdict[];
  severities?: StatementSeverity[];
  authoredModel?: string | null;
  sessionId?: number | null;
  clientName?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface FlaggedStatementItem extends BackendVerifiedStatement {
  sessionName: string;
  clientName: string;
  chatId: number;
  authoredModel: string | null;
  judgeModel: string;
  verifiedAt: number;
}

export interface FlaggedStatementsResult {
  items: FlaggedStatementItem[];
  total: number;
  limit: number;
  offset: number;
}

// Matches the automatic welcome message inserted by transcriptionProcessor.ts:
// `Session "<name>" has been transcribed and is ready for analysis.`
// Such messages have completionTokens NULL and must never be audited.
const WELCOME_MESSAGE_LIKE_PATTERN =
  'Session "%" has been transcribed and is ready for analysis.';

// Shared filter (aliased on `m`) for AI messages that are eligible for
// verification: non-empty text, excluding the automatic welcome message,
// and only when the message answers a preceding user message in the same
// chat (welcome-only / default chats with no user turn are never audited).
const VERIFIABLE_AI_MESSAGE_FILTER = `
  m.sender = 'ai'
  AND TRIM(m.text) <> ''
  AND NOT (m.completionTokens IS NULL AND m.text LIKE '${WELCOME_MESSAGE_LIKE_PATTERN}')
  AND EXISTS (
    SELECT 1 FROM messages u
    WHERE u.chatId = m.chatId AND u.sender = 'user' AND u.id < m.id
  )
`;

const FLAGGED_VERDICTS: StatementVerdict[] = [
  'fabricated',
  'contradicted',
  'partially_supported',
  'omission',
];

const TERMINAL_JOB_STATUSES: VerificationJobStatus[] = [
  'completed',
  'failed',
  'canceled',
];

const UNKNOWN_MODEL_LABEL = 'Unknown Model';

const insertJobSql = `
    INSERT INTO verification_jobs (status, scope, session_ids_json, chat_id, skip_verified, created_at, model_name, context_size, thinking_budget, temperature, top_p, repeat_penalty, num_gpu_layers, llm_base_url)
    VALUES ('pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const selectJobByIdSql = 'SELECT * FROM verification_jobs WHERE id = ?';

const upsertMessageVerificationSql = `
    INSERT INTO message_verifications (message_id, chat_id, session_id, verification_job_id, authored_model, judge_model, status, total_claims, supported_claims, partial_claims, contradicted_claims, fabricated_claims, omissions_count, accuracy_score, summary_assessment, prompt_tokens, completion_tokens, duration_ms, verified_at, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      session_id = excluded.session_id,
      verification_job_id = excluded.verification_job_id,
      authored_model = excluded.authored_model,
      judge_model = excluded.judge_model,
      status = excluded.status,
      total_claims = excluded.total_claims,
      supported_claims = excluded.supported_claims,
      partial_claims = excluded.partial_claims,
      contradicted_claims = excluded.contradicted_claims,
      fabricated_claims = excluded.fabricated_claims,
      omissions_count = excluded.omissions_count,
      accuracy_score = excluded.accuracy_score,
      summary_assessment = excluded.summary_assessment,
      prompt_tokens = excluded.prompt_tokens,
      completion_tokens = excluded.completion_tokens,
      duration_ms = excluded.duration_ms,
      verified_at = excluded.verified_at,
      error_message = excluded.error_message
`;
const selectVerificationIdByMessageIdSql =
  'SELECT id FROM message_verifications WHERE message_id = ?';
const deleteStatementsByMessageIdSql =
  'DELETE FROM verified_statements WHERE message_id = ?';
const insertStatementSql = `
    INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const mapJobRow = (row: any): BackendVerificationJob => ({
  ...(row as Omit<BackendVerificationJob, 'skip_verified'>),
  skip_verified: row.skip_verified === 1,
});

const mapMessageRow = (row: any): BackendChatMessage => ({
  ...(row as BackendChatMessage),
  isTruncated:
    row.isTruncated === 1
      ? true
      : row.isTruncated === 0
        ? false
        : !!row.isTruncated,
});

const parseEvidenceJson = (value: string | null): TranscriptEvidenceItem[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as TranscriptEvidenceItem[]) : [];
  } catch {
    return [];
  }
};

const mapStatementRow = (row: any): BackendVerifiedStatement => ({
  ...(row as Omit<BackendVerifiedStatement, 'evidence'>),
  evidence: parseEvidenceJson(row.transcript_evidence_json ?? null),
});

const escapeLikePattern = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

const buildInClause = (
  values: (number | string)[],
  params: unknown[]
): string => {
  const placeholders = values.map(() => '?').join(', ');
  params.push(...values);
  return `(${placeholders})`;
};

const safePercent = (numerator: number, denominator: number): number =>
  denominator > 0 ? (numerator / denominator) * 100 : 0;

const pooledAccuracyPercent = (
  supported: number,
  partial: number,
  totalClaims: number,
  omissions: number
): number => safePercent(supported + 0.5 * partial, totalClaims + omissions);

/**
 * Resolves the effective skip-verified behavior for a verification scope.
 * The global scopes own their semantics: `all_force` always re-audits
 * completed verifications and `all_unverified` always skips them,
 * regardless of an omitted or conflicting `skipVerified` flag, so a
 * force audit can never silently behave like an unverified-only one.
 * The narrowed scopes (`selected_sessions`, `single_chat`) honor the
 * flag explicitly, defaulting to skip when it is omitted.
 */
export const resolveVerificationSkipVerified = (
  scope: VerificationJobScope,
  skipVerified?: boolean | null
): boolean => {
  if (scope === 'all_force') return false;
  if (scope === 'all_unverified') return true;
  return skipVerified !== false;
};

export const verificationRepository = {
  createVerificationJob: (
    options: CreateVerificationJobOptions
  ): BackendVerificationJob => {
    try {
      const createdAt = Date.now();
      const info = run(
        insertJobSql,
        options.scope,
        options.sessionIds && options.sessionIds.length > 0
          ? JSON.stringify(options.sessionIds)
          : null,
        options.chatId ?? null,
        options.skipVerified === false ? 0 : 1,
        createdAt,
        options.modelName ?? null,
        options.contextSize ?? null,
        options.thinkingBudget ?? null,
        options.temperature ?? null,
        options.topP ?? null,
        options.repeatPenalty ?? null,
        options.numGpuLayers ?? null,
        options.llmBaseUrl ?? null
      );
      const jobId = info.lastInsertRowid as number;
      const job = get<any>(selectJobByIdSql, jobId);
      if (!job) {
        throw new Error(
          'Failed to retrieve verification job immediately after creation.'
        );
      }
      return mapJobRow(job);
    } catch (error) {
      console.error(
        '[VerificationRepo] Error creating verification job:',
        error
      );
      throw new Error('Database error while creating verification job.');
    }
  },

  findVerificationJobById: (jobId: number): BackendVerificationJob | null => {
    try {
      const job = get<any>(selectJobByIdSql, jobId);
      return job ? mapJobRow(job) : null;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error finding verification job ${jobId}:`,
        error
      );
      throw new Error('Database error fetching verification job.');
    }
  },

  findAllVerificationJobs: (limit: number = 50): BackendVerificationJob[] => {
    try {
      const rows = all<any>(
        'SELECT * FROM verification_jobs ORDER BY created_at DESC, id DESC LIMIT ?',
        limit
      );
      return rows.map(mapJobRow);
    } catch (error) {
      console.error(
        '[VerificationRepo] Error listing verification jobs:',
        error
      );
      throw new Error('Database error fetching verification jobs.');
    }
  },

  hasActiveVerificationJobs: (): boolean => {
    try {
      const row = get<{ active: number }>(
        `SELECT 1 AS active FROM verification_jobs
         WHERE status IN ('pending', 'processing', 'canceling') LIMIT 1`
      );
      return row?.active === 1;
    } catch (error) {
      console.error(
        '[VerificationRepo] Error checking for active verification jobs:',
        error
      );
      throw new Error('Database error checking active verification jobs.');
    }
  },

  updateJobStatus: (
    jobId: number,
    status: VerificationJobStatus,
    fields: UpdateVerificationJobFields = {}
  ): boolean => {
    try {
      const completedAt =
        fields.completedAt !== undefined
          ? fields.completedAt
          : TERMINAL_JOB_STATUSES.includes(status)
            ? Date.now()
            : null;
      const sets: string[] = ['status = ?', 'completed_at = ?'];
      const params: unknown[] = [status, completedAt];
      if (fields.errorMessage !== undefined) {
        sets.push('error_message = ?');
        params.push(fields.errorMessage);
      }
      if (fields.totalMessages !== undefined) {
        sets.push('total_messages = ?');
        params.push(fields.totalMessages);
      }
      if (fields.processedMessages !== undefined) {
        sets.push('processed_messages = ?');
        params.push(fields.processedMessages);
      }
      if (fields.totalStatements !== undefined) {
        sets.push('total_statements = ?');
        params.push(fields.totalStatements);
      }
      if (fields.flaggedStatements !== undefined) {
        sets.push('flagged_statements = ?');
        params.push(fields.flaggedStatements);
      }
      if (fields.omissionsCount !== undefined) {
        sets.push('omissions_count = ?');
        params.push(fields.omissionsCount);
      }
      params.push(jobId);
      const info = run(
        `UPDATE verification_jobs SET ${sets.join(', ')} WHERE id = ?`,
        ...params
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error updating verification job ${jobId} status to ${status}:`,
        error
      );
      throw new Error('Database error updating verification job status.');
    }
  },

  /**
   * Conditional `pending -> processing` transition. The `WHERE` clause
   * refuses to revive terminal rows (`completed`/`failed`/`canceled`), so a
   * cancellation that lands between the worker's last status re-read and this
   * write cannot be overwritten. Returns `true` when the row transitioned.
   */
  transitionJobToProcessing: (
    jobId: number,
    fields: Pick<UpdateVerificationJobFields, 'totalMessages'> = {}
  ): boolean => {
    try {
      const sets: string[] = ['status = ?', 'completed_at = ?'];
      const params: unknown[] = ['processing', null];
      if (fields.totalMessages !== undefined) {
        sets.push('total_messages = ?');
        params.push(fields.totalMessages);
      }
      params.push(jobId);
      const info = run(
        `UPDATE verification_jobs SET ${sets.join(', ')} WHERE id = ? AND status NOT IN ('completed', 'failed', 'canceled')`,
        ...params
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error transitioning verification job ${jobId} to processing:`,
        error
      );
      throw new Error('Database error updating verification job status.');
    }
  },

  incrementJobCounters: (
    jobId: number,
    deltas: VerificationJobCounterDeltas
  ): boolean => {
    try {
      const sets: string[] = [];
      const params: unknown[] = [];
      const add = (column: string, delta: number | undefined) => {
        if (delta !== undefined && delta !== 0) {
          sets.push(`${column} = ${column} + ?`);
          params.push(delta);
        }
      };
      add('total_messages', deltas.totalMessages);
      add('processed_messages', deltas.processedMessages);
      add('total_statements', deltas.totalStatements);
      add('flagged_statements', deltas.flaggedStatements);
      add('omissions_count', deltas.omissionsCount);
      if (sets.length === 0) return true;
      params.push(jobId);
      const info = run(
        `UPDATE verification_jobs SET ${sets.join(', ')} WHERE id = ?`,
        ...params
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error incrementing counters for job ${jobId}:`,
        error
      );
      throw new Error('Database error incrementing verification job counters.');
    }
  },

  findCandidateMessagesForVerification: (
    filters: VerificationCandidateFilters
  ): VerificationCandidateMessage[] => {
    try {
      const params: unknown[] = [];
      const conditions: string[] = [
        VERIFIABLE_AI_MESSAGE_FILTER,
        'c.sessionId IS NOT NULL',
        "s.status = 'completed'",
      ];
      // Scope is authoritative for the global audits: a contradictory
      // stored flag (e.g. a pre-fix or restored all_force row with
      // skip_verified=true) must not downgrade a force re-audit into an
      // unverified-only one at selection time.
      if (
        resolveVerificationSkipVerified(filters.scope, filters.skipVerified)
      ) {
        conditions.push(
          `NOT EXISTS (SELECT 1 FROM message_verifications mv WHERE mv.message_id = m.id AND mv.status = 'completed')`
        );
      }
      if (
        filters.scope === 'selected_sessions' &&
        filters.sessionIds &&
        filters.sessionIds.length > 0
      ) {
        conditions.push(
          `c.sessionId IN ${buildInClause(filters.sessionIds, params)}`
        );
      }
      if (filters.scope === 'single_chat' && filters.chatId != null) {
        conditions.push('m.chatId = ?');
        params.push(filters.chatId);
      }
      let sql = `
        SELECT m.*, c.sessionId AS sessionId,
          (SELECT u.text FROM messages u WHERE u.chatId = m.chatId AND u.sender = 'user' AND u.id < m.id ORDER BY u.id DESC LIMIT 1) AS userQuestion
        FROM messages m
        INNER JOIN chats c ON c.id = m.chatId
        INNER JOIN sessions s ON s.id = c.sessionId
        WHERE ${conditions.join(' AND ')}
        ORDER BY m.timestamp DESC, m.id DESC
      `;
      if (filters.limit != null) {
        sql += ' LIMIT ?';
        params.push(filters.limit);
      }
      const rows = all<any>(sql, ...params);
      return rows.map(
        (row): VerificationCandidateMessage => ({
          ...mapMessageRow(row),
          sessionId: row.sessionId as number,
          userQuestion: (row.userQuestion as string | null | undefined) ?? null,
        })
      );
    } catch (error) {
      console.error(
        '[VerificationRepo] Error finding candidate messages:',
        error
      );
      throw new Error('Database error finding verification candidates.');
    }
  },

  saveMessageVerificationResult: (
    payload: SaveMessageVerificationInput
  ): BackendMessageVerification => {
    try {
      const status = payload.status ?? 'completed';
      const totalClaims = payload.totalClaims ?? 0;
      const supportedClaims = payload.supportedClaims ?? 0;
      const partialClaims = payload.partialClaims ?? 0;
      const contradictedClaims = payload.contradictedClaims ?? 0;
      const fabricatedClaims = payload.fabricatedClaims ?? 0;
      const omissionsCount = payload.omissionsCount ?? 0;
      const statements = payload.statements ?? [];
      const verificationJobId = payload.verificationJobId ?? null;

      const verificationId = db.transaction(() => {
        run(
          upsertMessageVerificationSql,
          payload.messageId,
          payload.chatId,
          payload.sessionId,
          verificationJobId,
          payload.authoredModel ?? null,
          payload.judgeModel,
          status,
          totalClaims,
          supportedClaims,
          partialClaims,
          contradictedClaims,
          fabricatedClaims,
          omissionsCount,
          payload.accuracyScore ?? 1.0,
          payload.summaryAssessment ?? null,
          payload.promptTokens ?? null,
          payload.completionTokens ?? null,
          payload.durationMs ?? null,
          Date.now(),
          payload.errorMessage ?? null
        );
        const idRow = get<{ id: number }>(
          selectVerificationIdByMessageIdSql,
          payload.messageId
        );
        if (!idRow) {
          throw new Error(
            `Failed to retrieve verification id for message ${payload.messageId}.`
          );
        }
        run(deleteStatementsByMessageIdSql, payload.messageId);
        if (statements.length > 0) {
          const createdAt = Date.now();
          const stmt = db.prepare(insertStatementSql);
          for (const s of statements) {
            stmt.run(
              idRow.id,
              payload.messageId,
              payload.sessionId,
              s.statementIndex,
              s.kind,
              s.exactQuote,
              s.normalizedClaim,
              s.startChar ?? null,
              s.endChar ?? null,
              s.verdict,
              s.severity ?? 'none',
              s.confidence ?? 1.0,
              s.reasoning,
              s.evidence && s.evidence.length > 0
                ? JSON.stringify(s.evidence)
                : null,
              createdAt
            );
          }
        }
        if (verificationJobId != null) {
          const flaggedDelta =
            contradictedClaims + fabricatedClaims + partialClaims;
          run(
            `UPDATE verification_jobs
             SET processed_messages = processed_messages + 1,
                 total_statements = total_statements + ?,
                 flagged_statements = flagged_statements + ?,
                 omissions_count = omissions_count + ?
             WHERE id = ?`,
            totalClaims + omissionsCount,
            flaggedDelta,
            omissionsCount,
            verificationJobId
          );
        }
        return idRow.id;
      })();

      const saved = get<any>(
        'SELECT * FROM message_verifications WHERE id = ?',
        verificationId
      );
      if (!saved) {
        throw new Error('Failed to retrieve verification after save.');
      }
      const statementRows = all<any>(
        'SELECT * FROM verified_statements WHERE message_verification_id = ? ORDER BY statement_index ASC, id ASC',
        verificationId
      );
      return {
        ...(saved as Omit<BackendMessageVerification, 'statements'>),
        statements: statementRows.map(mapStatementRow),
      };
    } catch (error) {
      console.error(
        `[VerificationRepo] Error saving verification for message ${payload.messageId}:`,
        error
      );
      throw new Error('Database error saving message verification result.');
    }
  },

  findVerificationsByChatId: (chatId: number): BackendMessageVerification[] => {
    try {
      const verifications = all<any>(
        'SELECT * FROM message_verifications WHERE chat_id = ? ORDER BY message_id ASC',
        chatId
      );
      if (verifications.length === 0) return [];
      const statementRows = all<any>(
        `SELECT vs.* FROM verified_statements vs
         INNER JOIN message_verifications mv ON mv.id = vs.message_verification_id
         WHERE mv.chat_id = ?
         ORDER BY vs.message_id ASC, vs.statement_index ASC, vs.id ASC`,
        chatId
      );
      const byVerificationId = new Map<number, BackendVerifiedStatement[]>();
      for (const row of statementRows) {
        const list = byVerificationId.get(row.message_verification_id) ?? [];
        list.push(mapStatementRow(row));
        byVerificationId.set(row.message_verification_id, list);
      }
      return verifications.map(
        (v): BackendMessageVerification => ({
          ...(v as Omit<BackendMessageVerification, 'statements'>),
          statements: byVerificationId.get(v.id) ?? [],
        })
      );
    } catch (error) {
      console.error(
        `[VerificationRepo] Error finding verifications for chat ${chatId}:`,
        error
      );
      throw new Error('Database error fetching chat verifications.');
    }
  },

  findVerificationsBySessionId: (
    sessionId: number
  ): SessionVerificationDetail => {
    try {
      const verifications = all<any>(
        `SELECT mv.* FROM message_verifications mv
         INNER JOIN messages m ON m.id = mv.message_id
         WHERE mv.session_id = ?
         ORDER BY m.timestamp ASC, mv.message_id ASC`,
        sessionId
      );
      const statementRows =
        verifications.length === 0
          ? []
          : all<any>(
              'SELECT * FROM verified_statements WHERE session_id = ? ORDER BY message_id ASC, statement_index ASC, id ASC',
              sessionId
            );
      const byVerificationId = new Map<number, BackendVerifiedStatement[]>();
      for (const row of statementRows) {
        const list = byVerificationId.get(row.message_verification_id) ?? [];
        list.push(mapStatementRow(row));
        byVerificationId.set(row.message_verification_id, list);
      }
      const totalRow = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages m
         INNER JOIN chats c ON c.id = m.chatId
         WHERE c.sessionId = ? AND ${VERIFIABLE_AI_MESSAGE_FILTER}`,
        sessionId
      );
      const aggregateRow = get<{
        verified: number;
        failed: number;
        averageAccuracy: number | null;
        omissions: number;
      }>(
        `SELECT COUNT(CASE WHEN status = 'completed' THEN 1 ELSE NULL END) AS verified,
                COUNT(CASE WHEN status = 'failed' THEN 1 ELSE NULL END) AS failed,
                AVG(CASE WHEN status = 'completed' THEN accuracy_score ELSE NULL END) * 100.0 AS averageAccuracy,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN omissions_count ELSE 0 END), 0) AS omissions
         FROM message_verifications WHERE session_id = ?`,
        sessionId
      );
      const flaggedRow = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM verified_statements
         WHERE session_id = ? AND verdict IN ('fabricated', 'contradicted', 'partially_supported', 'omission')`,
        sessionId
      );
      return {
        sessionId,
        totalAiMessages: totalRow?.count ?? 0,
        verifiedAiMessages: aggregateRow?.verified ?? 0,
        failedAiMessages: aggregateRow?.failed ?? 0,
        averageAccuracy: aggregateRow?.averageAccuracy ?? null,
        flaggedIssues: flaggedRow?.count ?? 0,
        omissions: aggregateRow?.omissions ?? 0,
        verifications: verifications.map(
          (v): BackendMessageVerification => ({
            ...(v as Omit<BackendMessageVerification, 'statements'>),
            statements: byVerificationId.get(v.id) ?? [],
          })
        ),
      };
    } catch (error) {
      console.error(
        `[VerificationRepo] Error finding verifications for session ${sessionId}:`,
        error
      );
      throw new Error('Database error fetching session verifications.');
    }
  },

  getGlobalVerificationAnalytics: (
    filters: VerificationAnalyticsFilters = {}
  ): VerificationGlobalStats => {
    try {
      const params: unknown[] = [];
      const filterConditions: string[] = [];
      if (filters.sessionIds && filters.sessionIds.length > 0) {
        filterConditions.push(
          `mv.session_id IN ${buildInClause(filters.sessionIds, params)}`
        );
      }
      if (filters.model) {
        filterConditions.push('COALESCE(mv.authored_model, m.model, ?) = ?');
        params.push(UNKNOWN_MODEL_LABEL, filters.model);
      }
      if (filters.startDate) {
        filterConditions.push(
          "date(m.timestamp / 1000, 'unixepoch') >= date(?)"
        );
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        filterConditions.push(
          "date(m.timestamp / 1000, 'unixepoch') <= date(?)"
        );
        params.push(filters.endDate);
      }
      const where = ["mv.status = 'completed'", ...filterConditions].join(
        ' AND '
      );
      const failedWhere = ["mv.status = 'failed'", ...filterConditions].join(
        ' AND '
      );

      const kpi = get<{
        totalMessagesAudited: number;
        totalClaims: number;
        supportedClaims: number;
        partialClaims: number;
        contradictedClaims: number;
        fabricatedClaims: number;
        omissions: number;
      }>(
        `SELECT COUNT(*) AS totalMessagesAudited,
                COALESCE(SUM(mv.total_claims), 0) AS totalClaims,
                COALESCE(SUM(mv.supported_claims), 0) AS supportedClaims,
                COALESCE(SUM(mv.partial_claims), 0) AS partialClaims,
                COALESCE(SUM(mv.contradicted_claims), 0) AS contradictedClaims,
                COALESCE(SUM(mv.fabricated_claims), 0) AS fabricatedClaims,
                COALESCE(SUM(mv.omissions_count), 0) AS omissions
         FROM message_verifications mv
         INNER JOIN messages m ON m.id = mv.message_id
         WHERE ${where}`,
        ...params
      );

      const failedRow = get<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM message_verifications mv
         INNER JOIN messages m ON m.id = mv.message_id
         WHERE ${failedWhere}`,
        ...params
      );

      const unverifiedParams: unknown[] = [];
      let unverifiedSessionFilter = '';
      if (filters.sessionIds && filters.sessionIds.length > 0) {
        unverifiedSessionFilter = `AND c.sessionId IN ${buildInClause(filters.sessionIds, unverifiedParams)}`;
      }
      const unverifiedRow = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM messages m
         INNER JOIN chats c ON c.id = m.chatId
         INNER JOIN sessions s ON s.id = c.sessionId
         WHERE ${VERIFIABLE_AI_MESSAGE_FILTER}
           AND c.sessionId IS NOT NULL
           AND s.status = 'completed'
           ${unverifiedSessionFilter}
           AND NOT EXISTS (SELECT 1 FROM message_verifications mv WHERE mv.message_id = m.id AND mv.status = 'completed')`,
        ...unverifiedParams
      );

      const modelRows = all<{
        model: string;
        messagesAudited: number;
        totalClaims: number;
        supportedClaims: number;
        partialClaims: number;
        contradictedClaims: number;
        fabricatedClaims: number;
        omissions: number;
        averageAccuracyScore: number;
      }>(
        `SELECT COALESCE(mv.authored_model, m.model, '${UNKNOWN_MODEL_LABEL}') AS model,
                COUNT(*) AS messagesAudited,
                COALESCE(SUM(mv.total_claims), 0) AS totalClaims,
                COALESCE(SUM(mv.supported_claims), 0) AS supportedClaims,
                COALESCE(SUM(mv.partial_claims), 0) AS partialClaims,
                COALESCE(SUM(mv.contradicted_claims), 0) AS contradictedClaims,
                COALESCE(SUM(mv.fabricated_claims), 0) AS fabricatedClaims,
                COALESCE(SUM(mv.omissions_count), 0) AS omissions,
                COALESCE(AVG(mv.accuracy_score), 1.0) AS averageAccuracyScore
         FROM message_verifications mv
         INNER JOIN messages m ON m.id = mv.message_id
         WHERE ${where}
         GROUP BY model
         ORDER BY messagesAudited DESC, model ASC`,
        ...params
      );

      const timeRows = all<{
        date: string;
        messagesAudited: number;
        totalClaims: number;
        supportedClaims: number;
        partialClaims: number;
        fabrications: number;
        contradictions: number;
        omissions: number;
      }>(
        `SELECT strftime('%Y-%m-%d', m.timestamp / 1000, 'unixepoch') AS date,
                COUNT(*) AS messagesAudited,
                COALESCE(SUM(mv.total_claims), 0) AS totalClaims,
                COALESCE(SUM(mv.supported_claims), 0) AS supportedClaims,
                COALESCE(SUM(mv.partial_claims), 0) AS partialClaims,
                COALESCE(SUM(mv.fabricated_claims), 0) AS fabrications,
                COALESCE(SUM(mv.contradicted_claims), 0) AS contradictions,
                COALESCE(SUM(mv.omissions_count), 0) AS omissions
         FROM message_verifications mv
         INNER JOIN messages m ON m.id = mv.message_id
         WHERE ${where}
         GROUP BY date
         ORDER BY date ASC`,
        ...params
      );

      const sessionParams: unknown[] = [];
      let sessionFilter = '';
      if (filters.sessionIds && filters.sessionIds.length > 0) {
        sessionFilter = `AND s.id IN ${buildInClause(filters.sessionIds, sessionParams)}`;
      }
      const sessionRows = all<{
        sessionId: number;
        sessionName: string;
        clientName: string;
        date: string;
        totalAiMessages: number;
        verifiedAiMessages: number;
        failedAiMessages: number;
        flaggedIssues: number;
        averageAccuracy: number | null;
      }>(
        `SELECT s.id AS sessionId, s.sessionName, s.clientName, s.date,
                (SELECT COUNT(*) FROM messages m
                 INNER JOIN chats c ON c.id = m.chatId
                 WHERE c.sessionId = s.id AND ${VERIFIABLE_AI_MESSAGE_FILTER}) AS totalAiMessages,
                (SELECT COUNT(*) FROM message_verifications mv
                 WHERE mv.session_id = s.id AND mv.status = 'completed') AS verifiedAiMessages,
                (SELECT COUNT(*) FROM message_verifications mv
                 WHERE mv.session_id = s.id AND mv.status = 'failed') AS failedAiMessages,
                (SELECT COUNT(*) FROM verified_statements vs
                 WHERE vs.session_id = s.id
                   AND vs.verdict IN ('fabricated', 'contradicted', 'partially_supported', 'omission')) AS flaggedIssues,
                (SELECT AVG(mv2.accuracy_score) * 100.0 FROM message_verifications mv2
                 WHERE mv2.session_id = s.id AND mv2.status = 'completed') AS averageAccuracy
         FROM sessions s
         WHERE s.status = 'completed' ${sessionFilter}
           AND EXISTS (
             SELECT 1 FROM messages m
             INNER JOIN chats c ON c.id = m.chatId
             WHERE c.sessionId = s.id AND ${VERIFIABLE_AI_MESSAGE_FILTER}
           )
         ORDER BY s.date DESC, s.id DESC`,
        ...sessionParams
      );

      const totalMessagesAudited = kpi?.totalMessagesAudited ?? 0;
      const totalClaims = kpi?.totalClaims ?? 0;
      const omissions = kpi?.omissions ?? 0;
      const overallAccuracyPercent =
        totalMessagesAudited === 0
          ? 0
          : totalClaims + omissions === 0
            ? 100
            : pooledAccuracyPercent(
                kpi?.supportedClaims ?? 0,
                kpi?.partialClaims ?? 0,
                totalClaims,
                omissions
              );

      const byModel: ModelAccuracyStat[] = modelRows.map((r) => ({
        model: r.model,
        messagesAudited: r.messagesAudited,
        totalClaims: r.totalClaims,
        supportedClaims: r.supportedClaims,
        partialClaims: r.partialClaims,
        contradictedClaims: r.contradictedClaims,
        fabricatedClaims: r.fabricatedClaims,
        omissions: r.omissions,
        accuracyPercent:
          r.totalClaims + r.omissions === 0
            ? 100
            : pooledAccuracyPercent(
                r.supportedClaims,
                r.partialClaims,
                r.totalClaims,
                r.omissions
              ),
        fabricationRate: safePercent(r.fabricatedClaims, r.totalClaims),
        contradictionRate: safePercent(r.contradictedClaims, r.totalClaims),
        omissionsPerMessage:
          r.messagesAudited > 0 ? r.omissions / r.messagesAudited : 0,
        averageAccuracyScore: r.averageAccuracyScore,
      }));

      const overTime: VerificationTimepointStat[] = timeRows.map((r) => ({
        date: r.date,
        messagesAudited: r.messagesAudited,
        totalClaims: r.totalClaims,
        accuracyPercent:
          r.totalClaims + r.omissions === 0
            ? 100
            : pooledAccuracyPercent(
                r.supportedClaims,
                r.partialClaims,
                r.totalClaims,
                r.omissions
              ),
        fabrications: r.fabrications,
        contradictions: r.contradictions,
        omissions: r.omissions,
      }));

      const sessionsSummary: SessionVerificationSummary[] = sessionRows.map(
        (r) => ({
          sessionId: r.sessionId,
          sessionName: r.sessionName,
          clientName: r.clientName,
          date: r.date,
          totalAiMessages: r.totalAiMessages,
          verifiedAiMessages: r.verifiedAiMessages,
          failedAiMessages: r.failedAiMessages,
          isFullyVerified:
            r.totalAiMessages > 0 && r.verifiedAiMessages >= r.totalAiMessages,
          flaggedIssues: r.flaggedIssues,
          averageAccuracy: r.averageAccuracy,
        })
      );

      return {
        totalMessagesAudited,
        overallAccuracyPercent,
        totalClaims,
        supportedClaims: kpi?.supportedClaims ?? 0,
        partialClaims: kpi?.partialClaims ?? 0,
        contradictedClaims: kpi?.contradictedClaims ?? 0,
        fabricatedClaims: kpi?.fabricatedClaims ?? 0,
        omissions,
        unverifiedMessagesCount: unverifiedRow?.count ?? 0,
        failedMessagesCount: failedRow?.count ?? 0,
        byModel,
        overTime,
        sessionsSummary,
      };
    } catch (error) {
      console.error('[VerificationRepo] Error computing analytics:', error);
      throw new Error('Database error computing verification analytics.');
    }
  },

  findFlaggedStatements: (
    query: FlaggedStatementsQuery = {}
  ): FlaggedStatementsResult => {
    try {
      const limit = query.limit ?? 50;
      const offset = query.offset ?? 0;
      const verdicts =
        query.verdicts && query.verdicts.length > 0
          ? query.verdicts
          : FLAGGED_VERDICTS;
      const params: unknown[] = [];
      const conditions: string[] = [
        `vs.verdict IN ${buildInClause(verdicts, params)}`,
      ];
      if (query.severities && query.severities.length > 0) {
        conditions.push(
          `vs.severity IN ${buildInClause(query.severities, params)}`
        );
      }
      if (query.authoredModel) {
        conditions.push('COALESCE(mv.authored_model, m.model) = ?');
        params.push(query.authoredModel);
      }
      if (query.sessionId != null) {
        conditions.push('vs.session_id = ?');
        params.push(query.sessionId);
      }
      if (query.clientName) {
        conditions.push('s.clientName = ?');
        params.push(query.clientName);
      }
      if (query.search && query.search.trim() !== '') {
        const like = `%${escapeLikePattern(query.search.trim())}%`;
        conditions.push(
          "(vs.normalized_claim LIKE ? ESCAPE '\\' OR vs.exact_quote LIKE ? ESCAPE '\\' OR vs.reasoning LIKE ? ESCAPE '\\')"
        );
        params.push(like, like, like);
      }
      const where = conditions.join(' AND ');
      const from = `verified_statements vs
        INNER JOIN message_verifications mv ON mv.id = vs.message_verification_id
        INNER JOIN sessions s ON s.id = vs.session_id
        INNER JOIN messages m ON m.id = vs.message_id`;
      const totalRow = get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ${from} WHERE ${where}`,
        ...params
      );
      const rows = all<any>(
        `SELECT vs.*, s.sessionName, s.clientName, mv.chat_id AS chatId,
                COALESCE(mv.authored_model, m.model) AS authoredModel,
                mv.judge_model AS judgeModel, mv.verified_at AS verifiedAt
         FROM ${from}
         WHERE ${where}
         ORDER BY vs.created_at DESC, vs.id DESC
         LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset
      );
      return {
        items: rows.map(
          (row): FlaggedStatementItem => ({
            ...mapStatementRow(row),
            sessionName: row.sessionName as string,
            clientName: row.clientName as string,
            chatId: row.chatId as number,
            authoredModel: (row.authoredModel as string | null) ?? null,
            judgeModel: row.judgeModel as string,
            verifiedAt: row.verifiedAt as number,
          })
        ),
        total: totalRow?.count ?? 0,
        limit,
        offset,
      };
    } catch (error) {
      console.error(
        '[VerificationRepo] Error finding flagged statements:',
        error
      );
      throw new Error('Database error fetching flagged statements.');
    }
  },

  /**
   * Clears the verification (and all its statements) for a single message.
   * Statements are deleted explicitly so the row counts stay correct even
   * when foreign-key cascades are disabled.
   * @returns true when a verification row existed and was deleted.
   */
  deleteMessageVerification: (messageId: number): boolean => {
    try {
      const deleted = db.transaction(() => {
        run(deleteStatementsByMessageIdSql, messageId);
        const info = run(
          'DELETE FROM message_verifications WHERE message_id = ?',
          messageId
        );
        return info.changes > 0;
      })();
      return deleted;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error deleting verification for message ${messageId}:`,
        error
      );
      throw new Error('Database error deleting message verification.');
    }
  },

  /**
   * Clears ALL verification data — statements, message verifications, and
   * job history rows — so the user can re-audit from scratch.
   * @returns The number of rows deleted from each verification table.
   */
  resetAllVerifications: (): {
    deletedVerifications: number;
    deletedStatements: number;
    deletedJobs: number;
  } => {
    try {
      const result = db.transaction(() => {
        const statementsInfo = run('DELETE FROM verified_statements');
        const verificationsInfo = run('DELETE FROM message_verifications');
        const jobsInfo = run('DELETE FROM verification_jobs');
        return {
          deletedVerifications: Number(verificationsInfo.changes ?? 0),
          deletedStatements: Number(statementsInfo.changes ?? 0),
          deletedJobs: Number(jobsInfo.changes ?? 0),
        };
      })();
      return result;
    } catch (error) {
      console.error('[VerificationRepo] Error resetting verifications:', error);
      throw new Error('Database error resetting verifications.');
    }
  },

  /**
   * Bulk readers for admin backup export. Jobs are mapped (notably
   * `skip_verified` INTEGER -> boolean) so rows validate against the
   * domain zod schemas on import.
   */
  findAllJobsForBackup: (): BackendVerificationJob[] => {
    try {
      const rows = all<any>('SELECT * FROM verification_jobs ORDER BY id ASC');
      return rows.map(mapJobRow);
    } catch (error) {
      console.error(
        '[VerificationRepo] Error reading verification jobs for backup:',
        error
      );
      throw new Error('Database error reading verification jobs for backup.');
    }
  },

  findAllMessageVerificationsForBackup: (): MessageVerificationRow[] => {
    try {
      return all<MessageVerificationRow>(
        'SELECT * FROM message_verifications ORDER BY id ASC'
      );
    } catch (error) {
      console.error(
        '[VerificationRepo] Error reading message verifications for backup:',
        error
      );
      throw new Error(
        'Database error reading message verifications for backup.'
      );
    }
  },

  findAllVerifiedStatementsForBackup: (): VerifiedStatementRow[] => {
    try {
      return all<VerifiedStatementRow>(
        'SELECT * FROM verified_statements ORDER BY id ASC'
      );
    } catch (error) {
      console.error(
        '[VerificationRepo] Error reading verified statements for backup:',
        error
      );
      throw new Error('Database error reading verified statements for backup.');
    }
  },
};
