import { db, run, all, get } from '@therascript/db';
import {
  formatMessagePreview,
  applyConfirmedReviewsToCounts,
  computeFindingKey,
  computeAmbiguousReviewKey,
  computeMaterialRevision,
  computeReviewToken,
  computeVerificationAccuracyScore,
  deriveRawVerificationCounts,
  isReviewEligibleFinding,
  isUnresolvedClaimAmbiguous,
  reduceEffectiveVerificationCounts,
  VERIFICATION_REVIEW_IDENTITY_VERSION,
} from '@therascript/domain';
import { extractVisibleAnswer } from '@therascript/services';
import type {
  BackendChatMessage,
  BackendMessageVerification,
  BackendStatementReview,
  BackendVerificationJob,
  BackendVerifiedStatement,
  ModelAccuracyStat,
  MessageVerificationRow,
  SessionVerificationSummary,
  StatementKind,
  StatementReviewStatus,
  StatementSeverity,
  StatementVerdict,
  TranscriptEvidenceItem,
  VerificationGlobalStats,
  VerifiedStatementRow,
  VerificationJobScope,
  VerificationJobStatus,
  VerificationTimepointStat,
} from '@therascript/domain';

/**
 * Thrown by `dismissStatementAsConfirmed` when the statement or its parent
 * assessment no longer exists (including old ids replaced by a rerun/clear).
 * Maps to HTTP 404. Never silently applies to a replacement row.
 * Carries the current authoritative assessment when one is resolvable
 * (null when the owning message itself is gone) so the client can refresh
 * instead of applying the dismissal to a replacement row.
 */
export class StatementReviewNotFoundError extends Error {
  readonly code = 'review_not_found' as const;
  readonly verification: BackendMessageVerification | null;
  constructor(
    message: string,
    verification: BackendMessageVerification | null = null
  ) {
    super(message);
    this.name = 'StatementReviewNotFoundError';
    this.verification = verification;
  }
}

export type StatementReviewConflictReason =
  | 'stale_token'
  | 'material_changed'
  | 'not_completed'
  | 'not_eligible';

/**
 * Thrown by `dismissStatementAsConfirmed` for stale tokens/material,
 * non-completed parents, or supported statements. Maps to HTTP 409 with an
 * explanation + refresh of the current assessment.
 */
export class StatementReviewConflictError extends Error {
  readonly code = 'review_conflict' as const;
  readonly reason: StatementReviewConflictReason;
  readonly verification: BackendMessageVerification | null;
  constructor(
    reason: StatementReviewConflictReason,
    message: string,
    verification: BackendMessageVerification | null = null
  ) {
    super(message);
    this.name = 'StatementReviewConflictError';
    this.reason = reason;
    this.verification = verification;
  }
}

/**
 * Thrown by `saveMessageVerificationResult` when the live message/transcript
 * material changed between Judge evaluation and commit. The worker must
 * discard the stale result (never attribute it to changed content) and leave
 * any prior assessment and all durable reviews untouched.
 */
export class StaleVerificationMaterialError extends Error {
  readonly code = 'stale_material' as const;
  constructor(message: string) {
    super(message);
    this.name = 'StaleVerificationMaterialError';
  }
}

/** True when `error` is a SQLite UNIQUE-constraint violation (dismiss race). */
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';

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
  succeededMessages?: number;
  failedMessages?: number;
  skippedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
  completedAt?: number | null;
}

export interface VerificationJobCounterDeltas {
  totalMessages?: number;
  processedMessages?: number;
  succeededMessages?: number;
  failedMessages?: number;
  skippedMessages?: number;
  totalStatements?: number;
  flaggedStatements?: number;
  omissionsCount?: number;
}

export interface UpdateVerificationJobPhaseFields {
  currentPhase:
    | 'waiting_for_lock'
    | 'loading_judge'
    | 'checking_message'
    | 'generating'
    | 'retrying'
    | 'finishing'
    | null;
  currentMessageId?: number | null;
  currentAttempt?: number | null;
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
  errorCode?:
    | 'empty_output'
    | 'malformed_json'
    | 'truncated_output'
    | 'invalid_structure'
    | 'provider_error'
    | 'context_budget'
    | 'missing_transcript'
    | null;
  statements?: VerificationStatementInput[];
  /**
   * Fingerprint of the material the Judge evaluated, computed by the worker
   * before the LLM call. The save transaction recomputes the live revision
   * and rejects the save (`StaleVerificationMaterialError`) on mismatch.
   * Omit only for callers that did not evaluate material (tests/backfill):
   * the live revision is then adopted without a staleness check.
   */
  materialRevision?: string | null;
}

export interface DismissStatementResult {
  statement: BackendVerifiedStatement;
  verification: BackendMessageVerification;
}

export interface FailedVerificationItem {
  messageId: number;
  chatId: number;
  sessionId: number;
  sessionName: string;
  clientName: string;
  verificationJobId: number | null;
  authoredModel: string | null;
  judgeModel: string;
  errorCode: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number | null;
  verifiedAt: number;
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
/**
 * Scalar subquery resolving the raw text of the in-flight message so
 * `mapJobRow` can derive `current_message_preview` without a migration.
 * Null when the job has no `current_message_id` (or the message is gone).
 */
const currentMessageTextSubquery =
  '(SELECT m.text FROM messages m WHERE m.id = verification_jobs.current_message_id) AS current_message_text';
const selectJobByIdSql = `SELECT verification_jobs.*, ${currentMessageTextSubquery} FROM verification_jobs WHERE id = ?`;

const upsertMessageVerificationSql = `
    INSERT INTO message_verifications (message_id, chat_id, session_id, verification_job_id, authored_model, judge_model, status, total_claims, supported_claims, partial_claims, contradicted_claims, fabricated_claims, omissions_count, accuracy_score, summary_assessment, prompt_tokens, completion_tokens, duration_ms, verified_at, error_message, error_code, material_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      error_message = excluded.error_message,
      error_code = excluded.error_code,
      material_revision = excluded.material_revision
`;
const selectVerificationIdByMessageIdSql =
  'SELECT id FROM message_verifications WHERE message_id = ?';
const deleteStatementsByMessageIdSql =
  'DELETE FROM verified_statements WHERE message_id = ?';
const insertStatementSql = `
    INSERT INTO verified_statements (message_verification_id, message_id, session_id, statement_index, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json, created_at, finding_key, context_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
const insertStatementReviewSql = `
    INSERT INTO verification_statement_reviews (message_id, session_id, identity_version, context_revision, finding_key, reusable, confirmed_statement_id, confirmed_at, kind, exact_quote, normalized_claim, start_char, end_char, verdict, severity, confidence, reasoning, transcript_evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * SQL predicate (aliased on `vs`) excluding human-confirmed findings.
 * A statement is resolved when a reusable review matches its stored
 * (revision, finding key), or when an ambiguous (non-reusable) review names
 * its exact row id. Legacy rows with NULL identity columns never match the
 * reusable branch, so existing results start unreviewed.
 */
const UNRESOLVED_STATEMENT_PREDICATE = `
  NOT EXISTS (
    SELECT 1 FROM verification_statement_reviews r
    WHERE r.message_id = vs.message_id
      AND (
        (r.reusable = 1 AND vs.finding_key IS NOT NULL AND vs.context_revision IS NOT NULL
         AND r.context_revision = vs.context_revision AND r.finding_key = vs.finding_key)
        OR (r.reusable = 0 AND r.confirmed_statement_id = vs.id)
      )
  )
`;

const mapJobRow = (row: any): BackendVerificationJob => {
  // Strip the preview subquery column: it is derived input, not a job field.
  const { current_message_text, ...rest } = row as Record<string, unknown> & {
    current_message_text?: string | null;
  };
  const preview =
    typeof current_message_text === 'string'
      ? formatMessagePreview(current_message_text)
      : '';
  return {
    ...(rest as Omit<BackendVerificationJob, 'skip_verified'>),
    skip_verified: row.skip_verified === 1,
    // V21 columns default defensively so rows selected through older
    // projections (or partially migrated DBs) still map.
    succeeded_messages: row.succeeded_messages ?? 0,
    failed_messages: row.failed_messages ?? 0,
    skipped_messages: row.skipped_messages ?? 0,
    current_phase: row.current_phase ?? null,
    current_message_id: row.current_message_id ?? null,
    current_attempt: row.current_attempt ?? null,
    phase_updated_at: row.phase_updated_at ?? null,
    // Empty/whitespace-only message text maps to null so the UI falls
    // back to `message #<id>` instead of rendering empty quotes.
    current_message_preview: preview ? preview : null,
  };
};

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

const UNREVIEWED_METADATA: {
  review_status: StatementReviewStatus;
  confirmed_at: null;
  review_id: null;
  review_token: null;
} = {
  review_status: 'unreviewed',
  confirmed_at: null,
  review_id: null,
  review_token: null,
};

/**
 * Raw row mapping. Review metadata defaults to unreviewed; readers that
 * serve statements must call `attachReviewMetadata` so every read carries
 * authoritative `review_status`/`confirmed_at`/`review_id`/`review_token`.
 */
const mapStatementRow = (row: any): BackendVerifiedStatement => {
  const {
    finding_key: _findingKey,
    context_revision: _contextRevision,
    ...rest
  } = row as Record<string, unknown>;
  return {
    ...(rest as unknown as Omit<
      BackendVerifiedStatement,
      | 'evidence'
      | 'review_status'
      | 'confirmed_at'
      | 'review_id'
      | 'review_token'
    >),
    evidence: parseEvidenceJson(
      (row.transcript_evidence_json as string | null) ?? null
    ),
    ...UNREVIEWED_METADATA,
  };
};

const mapReviewRow = (row: any): BackendStatementReview => ({
  ...(row as Omit<BackendStatementReview, 'reusable'>),
  reusable: row.reusable === 1,
});

/** Live material behind one audited message, for revision fingerprinting. */
interface LiveVerificationMaterial {
  revision: string;
  visibleAnswer: string;
  userQuestion: string | null;
}

/**
 * Recompute the material revision from live message + transcript rows.
 * Must run INSIDE the caller's write transaction so the revision, the
 * review match, and the aggregate update commit atomically.
 */
const computeLiveMaterialRevision = (
  messageId: number,
  chatId: number,
  sessionId: number
): LiveVerificationMaterial => {
  const messageRow = get<{ text: string }>(
    'SELECT text FROM messages WHERE id = ?',
    messageId
  );
  const visibleAnswer = extractVisibleAnswer(messageRow?.text ?? '').trim();
  const questionRow = get<{ text: string }>(
    `SELECT text FROM messages
     WHERE chatId = ? AND sender = 'user' AND id < ?
     ORDER BY id DESC LIMIT 1`,
    chatId,
    messageId
  );
  const userQuestion = questionRow?.text ?? null;
  const paragraphs = all<{
    paragraphIndex: number;
    timestampMs: number;
    speaker: string | null;
    text: string;
  }>(
    `SELECT paragraphIndex, timestampMs, speaker, text
     FROM transcript_paragraphs WHERE sessionId = ? ORDER BY paragraphIndex ASC`,
    sessionId
  );
  return {
    revision: computeMaterialRevision({
      visibleAnswer,
      userQuestion,
      transcript: paragraphs,
    }),
    visibleAnswer,
    userQuestion,
  };
};

/** Finding key for a worker-supplied statement input. */
const findingKeyForInput = (s: VerificationStatementInput): string => {
  if (s.kind === 'omission') {
    return computeFindingKey({
      kind: 'omission',
      normalizedClaim: s.normalizedClaim,
      evidence: (s.evidence ?? []).map((e) => ({
        timestampMs: e.timestampMs ?? null,
        speaker: e.speaker ?? null,
        quote: e.quote,
      })),
    });
  }
  return computeFindingKey({
    kind: 'claim',
    exactQuote: s.exactQuote,
    normalizedClaim: s.normalizedClaim,
    startChar: s.startChar ?? null,
    endChar: s.endChar ?? null,
  });
};

/** Finding key for a persisted statement row (evidence parsed from JSON). */
const findingKeyForRow = (row: {
  kind: StatementKind;
  exact_quote: string;
  normalized_claim: string;
  start_char: number | null;
  end_char: number | null;
  transcript_evidence_json: string | null;
}): string => {
  if (row.kind === 'omission') {
    return computeFindingKey({
      kind: 'omission',
      normalizedClaim: row.normalized_claim,
      evidence: parseEvidenceJson(row.transcript_evidence_json).map((e) => ({
        timestampMs: e.timestampMs ?? null,
        speaker: e.speaker ?? null,
        quote: e.quote,
      })),
    });
  }
  return computeFindingKey({
    kind: 'claim',
    exactQuote: row.exact_quote,
    normalizedClaim: row.normalized_claim,
    startChar: row.start_char,
    endChar: row.end_char,
  });
};

const reviewTokenForRow = (
  row: {
    id: number;
    message_id: number;
    kind: StatementKind;
    exact_quote: string;
    normalized_claim: string;
    start_char: number | null;
    end_char: number | null;
    verdict: StatementVerdict;
    severity: StatementSeverity;
    confidence: number;
    reasoning: string;
    transcript_evidence_json: string | null;
  },
  materialRevision: string | null
): string =>
  computeReviewToken({
    statementId: row.id,
    messageId: row.message_id,
    kind: row.kind,
    materialRevision: materialRevision ?? '',
    exactQuote: row.exact_quote,
    normalizedClaim: row.normalized_claim,
    startChar: row.start_char,
    endChar: row.end_char,
    verdict: row.verdict,
    severity: row.severity,
    confidence: row.confidence,
    reasoning: row.reasoning,
    evidenceJson: row.transcript_evidence_json,
  });

interface MatchableStatement {
  id: number;
  findingKey: string | null;
  contextRevision: string | null;
}

/**
 * Match durable reviews to current statements. Precedence:
 *  1. An ambiguous (non-reusable) review matches only its exact
 *     `confirmed_statement_id` — never a rerun's replacement rows.
 *  2. A reusable review matches a statement's stored (revision, key) only
 *     when exactly one current statement carries that pair; duplicate
 *     groups stay unreviewed ("prefer a newly expressed finding requiring
 *     review to suppressing a distinct problem").
 */
const matchReviewsToStatements = (
  statements: MatchableStatement[],
  reviews: BackendStatementReview[]
): Map<number, BackendStatementReview> => {
  const matched = new Map<number, BackendStatementReview>();
  const ambiguousByStatementId = new Map<number, BackendStatementReview>();
  const reusableByKey = new Map<string, BackendStatementReview>();
  for (const review of reviews) {
    if (!review.reusable && review.confirmed_statement_id != null) {
      ambiguousByStatementId.set(review.confirmed_statement_id, review);
    } else if (review.reusable) {
      reusableByKey.set(
        `${review.context_revision}\n${review.finding_key}`,
        review
      );
    }
  }
  const groupSizes = new Map<string, number>();
  for (const s of statements) {
    if (s.findingKey == null || s.contextRevision == null) continue;
    const group = `${s.contextRevision}\n${s.findingKey}`;
    groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  }
  for (const s of statements) {
    const ambiguous = ambiguousByStatementId.get(s.id);
    if (ambiguous) {
      matched.set(s.id, ambiguous);
      continue;
    }
    if (s.findingKey == null || s.contextRevision == null) continue;
    const group = `${s.contextRevision}\n${s.findingKey}`;
    if (groupSizes.get(group) !== 1) continue;
    const reusable = reusableByKey.get(group);
    if (reusable) matched.set(s.id, reusable);
  }
  return matched;
};

/**
 * Attach authoritative review metadata + tokens to mapped statements.
 * `rowsById` carries the stored identity columns (stripped from the mapped
 * shape); `materialRevision` is the parent assessment's revision ('' for
 * legacy rows). Every statement read path must use this so metadata can
 * never be silently dropped.
 */
const attachReviewMetadata = (
  statements: BackendVerifiedStatement[],
  rowsById: Map<
    number,
    {
      finding_key: string | null;
      context_revision: string | null;
    }
  >,
  reviews: BackendStatementReview[],
  materialRevision: string | null
): BackendVerifiedStatement[] => {
  const matchable: MatchableStatement[] = statements.map((s) => ({
    id: s.id,
    findingKey: rowsById.get(s.id)?.finding_key ?? null,
    contextRevision: rowsById.get(s.id)?.context_revision ?? null,
  }));
  const matched = matchReviewsToStatements(matchable, reviews);
  return statements.map((s) => {
    const review = matched.get(s.id);
    return {
      ...s,
      review_status: review ? 'confirmed' : 'unreviewed',
      confirmed_at: review ? review.confirmed_at : null,
      review_id: review ? review.id : null,
      review_token: reviewTokenForRow(
        {
          id: s.id,
          message_id: s.message_id,
          kind: s.kind,
          exact_quote: s.exact_quote,
          normalized_claim: s.normalized_claim,
          start_char: s.start_char,
          end_char: s.end_char,
          verdict: s.verdict,
          severity: s.severity,
          confidence: s.confidence,
          reasoning: s.reasoning,
          transcript_evidence_json: s.transcript_evidence_json,
        },
        materialRevision
      ),
    };
  });
};

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

/**
 * Current authoritative parent + review-attached statements for one
 * assessment row. Used by the dismiss success path and carried on 409
 * errors so the client refreshes to current data (with fresh tokens)
 * instead of retrying a stale submission.
 */
const loadAuthoritativeVerification = (
  parentRow: any
): BackendMessageVerification => {
  const rows = all<any>(
    'SELECT * FROM verified_statements WHERE message_verification_id = ? ORDER BY statement_index ASC, id ASC',
    parentRow.id
  );
  const reviews =
    rows.length === 0
      ? []
      : all<any>(
          'SELECT * FROM verification_statement_reviews WHERE message_id = ?',
          parentRow.message_id
        ).map(mapReviewRow);
  const rowsById = new Map(
    rows.map((r) => [
      r.id,
      {
        finding_key: r.finding_key ?? null,
        context_revision: r.context_revision ?? null,
      },
    ])
  );
  return {
    ...(parentRow as Omit<BackendMessageVerification, 'statements'>),
    statements: attachReviewMetadata(
      rows.map(mapStatementRow),
      rowsById,
      reviews,
      parentRow.material_revision ?? null
    ),
  };
};

/** Durable reviews grouped by owning message id (history included). */
const findReviewsByMessageIds = (
  messageIds: number[]
): Map<number, BackendStatementReview[]> => {
  const grouped = new Map<number, BackendStatementReview[]>();
  if (messageIds.length === 0) return grouped;
  const params: unknown[] = [];
  const rows = all<any>(
    `SELECT * FROM verification_statement_reviews
     WHERE message_id IN ${buildInClause(messageIds, params)}
     ORDER BY message_id ASC, id ASC`,
    ...params
  );
  for (const row of rows) {
    const list = grouped.get(row.message_id) ?? [];
    list.push(mapReviewRow(row));
    grouped.set(row.message_id, list);
  }
  return grouped;
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
        `SELECT verification_jobs.*, ${currentMessageTextSubquery} FROM verification_jobs ORDER BY created_at DESC, id DESC LIMIT ?`,
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
      if (fields.succeededMessages !== undefined) {
        sets.push('succeeded_messages = ?');
        params.push(fields.succeededMessages);
      }
      if (fields.failedMessages !== undefined) {
        sets.push('failed_messages = ?');
        params.push(fields.failedMessages);
      }
      if (fields.skippedMessages !== undefined) {
        sets.push('skipped_messages = ?');
        params.push(fields.skippedMessages);
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
   * Status-preserving phase snapshot write. Records the worker's live phase
   * (plus the current message/attempt) without touching `status`, so SSE
   * snapshots and refetches stay truthful across reconnects and reloads.
   * Terminal transitions clear the phase via `clearJobPhase`.
   */
  updateJobPhase: (
    jobId: number,
    phase: UpdateVerificationJobPhaseFields
  ): boolean => {
    try {
      const info = run(
        `UPDATE verification_jobs
         SET current_phase = ?, current_message_id = ?, current_attempt = ?, phase_updated_at = ?
         WHERE id = ?`,
        phase.currentPhase,
        phase.currentMessageId ?? null,
        phase.currentAttempt ?? null,
        Date.now(),
        jobId
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error updating phase for verification job ${jobId}:`,
        error
      );
      throw new Error('Database error updating verification job phase.');
    }
  },

  /**
   * Clears the live phase snapshot on terminal transitions. Outcome counts
   * and the error summary (set via `updateJobStatus`) carry the durable
   * record; a stale "generating" phase must not linger on a finished row.
   */
  clearJobPhase: (jobId: number): boolean => {
    try {
      const info = run(
        `UPDATE verification_jobs
         SET current_phase = NULL, current_message_id = NULL,
             current_attempt = NULL, phase_updated_at = NULL
         WHERE id = ?`,
        jobId
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[VerificationRepo] Error clearing phase for verification job ${jobId}:`,
        error
      );
      throw new Error('Database error clearing verification job phase.');
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
      add('succeeded_messages', deltas.succeededMessages);
      add('failed_messages', deltas.failedMessages);
      add('skipped_messages', deltas.skippedMessages);
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
      const statements = payload.statements ?? [];
      const verificationJobId = payload.verificationJobId ?? null;

      const verificationId = db.transaction(() => {
        // Revalidate the evaluated material against live rows INSIDE the
        // transaction: a transcript edit landing between the Judge call and
        // this commit must discard the stale result, never attribute it to
        // changed content. Callers without evaluated material (tests,
        // backfill) adopt the live revision unchecked.
        const live = computeLiveMaterialRevision(
          payload.messageId,
          payload.chatId,
          payload.sessionId
        );
        if (
          payload.materialRevision != null &&
          live.revision !== payload.materialRevision
        ) {
          throw new StaleVerificationMaterialError(
            `Verification result for message ${payload.messageId} was evaluated against changed material; discarding instead of attributing it to new content.`
          );
        }
        const materialRevision = live.revision;

        // Reconcile durable human confirmations BEFORE calculating
        // aggregates: read the latest reviews inside this transaction (a
        // dismissal may have landed after the Judge call) and reduce to
        // effective counts. Failed/skipped/empty saves store no statements
        // but still persist the revision; independent review rows are never
        // touched here, so they always survive.
        const keys = statements.map(findingKeyForInput);
        const durableReviews =
          status === 'completed' && statements.length > 0
            ? all<any>(
                `SELECT * FROM verification_statement_reviews
                 WHERE message_id = ? AND context_revision = ? AND reusable = 1`,
                payload.messageId,
                materialRevision
              ).map(mapReviewRow)
            : [];
        const matchable: MatchableStatement[] = statements.map((s, i) => ({
          // Pre-insert ids are unknown; use negative indexes so ambiguous
          // id-matches (positive row ids) can never fire here.
          id: -(i + 1),
          findingKey: keys[i]!,
          contextRevision: materialRevision,
        }));
        const matched = matchReviewsToStatements(matchable, durableReviews);
        const matchedInputs = statements.filter((_, i) =>
          matched.has(-(i + 1))
        );
        // Caller-supplied raw counts stay authoritative (the worker computes
        // them from the same Judge output); per-field fallback derives from
        // the statements when the caller omitted counts. With no matching
        // reviews the stored row is byte-identical to the pre-review
        // behavior; with matches the shared adjustment core reconciles.
        const derived = deriveRawVerificationCounts(statements);
        const rawCounts = {
          totalClaims: payload.totalClaims ?? derived.totalClaims,
          supportedClaims: payload.supportedClaims ?? derived.supportedClaims,
          partialClaims: payload.partialClaims ?? derived.partialClaims,
          contradictedClaims:
            payload.contradictedClaims ?? derived.contradictedClaims,
          fabricatedClaims:
            payload.fabricatedClaims ?? derived.fabricatedClaims,
          omissionsCount: payload.omissionsCount ?? derived.omissionsCount,
        };
        const effective =
          matchedInputs.length === 0
            ? {
                ...rawCounts,
                accuracyScore:
                  payload.accuracyScore ??
                  (statements.length === 0
                    ? 1.0
                    : computeVerificationAccuracyScore(
                        rawCounts.supportedClaims,
                        rawCounts.partialClaims,
                        rawCounts.totalClaims,
                        rawCounts.omissionsCount
                      )),
              }
            : applyConfirmedReviewsToCounts(
                rawCounts,
                matchedInputs.map((s) => ({ kind: s.kind, verdict: s.verdict }))
              );

        run(
          upsertMessageVerificationSql,
          payload.messageId,
          payload.chatId,
          payload.sessionId,
          verificationJobId,
          payload.authoredModel ?? null,
          payload.judgeModel,
          status,
          effective.totalClaims,
          effective.supportedClaims,
          effective.partialClaims,
          effective.contradictedClaims,
          effective.fabricatedClaims,
          effective.omissionsCount,
          effective.accuracyScore,
          payload.summaryAssessment ?? null,
          payload.promptTokens ?? null,
          payload.completionTokens ?? null,
          payload.durationMs ?? null,
          Date.now(),
          payload.errorMessage ?? null,
          payload.errorCode ?? null,
          materialRevision
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
          for (let i = 0; i < statements.length; i++) {
            const s = statements[i]!;
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
              createdAt,
              keys[i]!,
              materialRevision
            );
          }
        }
        if (verificationJobId != null) {
          // New audit counters describe effective results at save time
          // (human-confirmed findings already reconciled above).
          const flaggedDelta =
            effective.contradictedClaims +
            effective.fabricatedClaims +
            effective.partialClaims;
          run(
            `UPDATE verification_jobs
             SET processed_messages = processed_messages + 1,
                 total_statements = total_statements + ?,
                 flagged_statements = flagged_statements + ?,
                 omissions_count = omissions_count + ?
             WHERE id = ?`,
            effective.totalClaims + effective.omissionsCount,
            flaggedDelta,
            effective.omissionsCount,
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
      const reviewsForMessage =
        statementRows.length === 0
          ? []
          : all<any>(
              'SELECT * FROM verification_statement_reviews WHERE message_id = ?',
              payload.messageId
            ).map(mapReviewRow);
      const rowsById = new Map(
        statementRows.map((r) => [
          r.id,
          {
            finding_key: r.finding_key ?? null,
            context_revision: r.context_revision ?? null,
          },
        ])
      );
      return {
        ...(saved as Omit<BackendMessageVerification, 'statements'>),
        statements: attachReviewMetadata(
          statementRows.map(mapStatementRow),
          rowsById,
          reviewsForMessage,
          saved.material_revision ?? null
        ),
      };
    } catch (error) {
      if (error instanceof StaleVerificationMaterialError) throw error;
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
      const messageIds = [...new Set(verifications.map((v) => v.message_id))];
      const reviewsByMessage = findReviewsByMessageIds(messageIds);
      const rowsByVerificationId = new Map<number, any[]>();
      for (const row of statementRows) {
        const list =
          rowsByVerificationId.get(row.message_verification_id) ?? [];
        list.push(row);
        rowsByVerificationId.set(row.message_verification_id, list);
      }
      return verifications.map((v): BackendMessageVerification => {
        const rows = rowsByVerificationId.get(v.id) ?? [];
        const rowsById = new Map(
          rows.map((r) => [
            r.id,
            {
              finding_key: r.finding_key ?? null,
              context_revision: r.context_revision ?? null,
            },
          ])
        );
        return {
          ...(v as Omit<BackendMessageVerification, 'statements'>),
          statements: attachReviewMetadata(
            rows.map(mapStatementRow),
            rowsById,
            reviewsByMessage.get(v.message_id) ?? [],
            v.material_revision ?? null
          ),
        };
      });
    } catch (error) {
      console.error(
        `[VerificationRepo] Error finding verifications for chat ${chatId}:`,
        error
      );
      throw new Error('Database error fetching chat verifications.');
    }
  },

  /**
   * Failed message assessments attributable to one job run, newest first.
   * Powers the Job History "View details" dialog. Rows are matched by
   * `verification_job_id`, so a later re-audit that overwrites a message's
   * verification removes it from the earlier job's failure list (the job's
   * persisted `failed_messages` counter keeps the historical count).
   */
  findFailedVerificationsByJobId: (jobId: number): FailedVerificationItem[] => {
    try {
      const rows = all<any>(
        `SELECT mv.message_id AS messageId, mv.chat_id AS chatId,
                mv.session_id AS sessionId, s.sessionName AS sessionName,
                s.clientName AS clientName,
                mv.verification_job_id AS verificationJobId,
                mv.authored_model AS authoredModel, mv.judge_model AS judgeModel,
                mv.error_code AS errorCode, mv.error_message AS errorMessage,
                mv.prompt_tokens AS promptTokens,
                mv.completion_tokens AS completionTokens,
                mv.duration_ms AS durationMs, mv.verified_at AS verifiedAt
         FROM message_verifications mv
         INNER JOIN sessions s ON s.id = mv.session_id
         WHERE mv.verification_job_id = ? AND mv.status = 'failed'
         ORDER BY mv.message_id DESC`,
        jobId
      );
      return rows.map(
        (row): FailedVerificationItem => ({
          messageId: row.messageId as number,
          chatId: row.chatId as number,
          sessionId: row.sessionId as number,
          sessionName: row.sessionName as string,
          clientName: row.clientName as string,
          verificationJobId: (row.verificationJobId as number | null) ?? null,
          authoredModel: (row.authoredModel as string | null) ?? null,
          judgeModel: row.judgeModel as string,
          errorCode: (row.errorCode as string | null) ?? null,
          errorMessage: (row.errorMessage as string | null) ?? null,
          promptTokens: (row.promptTokens as number | null) ?? null,
          completionTokens: (row.completionTokens as number | null) ?? null,
          durationMs: (row.durationMs as number | null) ?? null,
          verifiedAt: row.verifiedAt as number,
        })
      );
    } catch (error) {
      console.error(
        `[VerificationRepo] Error finding failed verifications for job ${jobId}:`,
        error
      );
      throw new Error('Database error fetching failed job verifications.');
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
      const reviewsByMessage = findReviewsByMessageIds(
        verifications.map((v) => v.message_id)
      );
      const rowsByVerificationId = new Map<number, any[]>();
      for (const row of statementRows) {
        const list =
          rowsByVerificationId.get(row.message_verification_id) ?? [];
        list.push(row);
        rowsByVerificationId.set(row.message_verification_id, list);
      }
      const statementsByVerificationId = new Map<
        number,
        BackendVerifiedStatement[]
      >();
      for (const v of verifications) {
        const rows = rowsByVerificationId.get(v.id) ?? [];
        const rowsById = new Map(
          rows.map((r) => [
            r.id,
            {
              finding_key: r.finding_key ?? null,
              context_revision: r.context_revision ?? null,
            },
          ])
        );
        statementsByVerificationId.set(
          v.id,
          attachReviewMetadata(
            rows.map(mapStatementRow),
            rowsById,
            reviewsByMessage.get(v.message_id) ?? [],
            v.material_revision ?? null
          )
        );
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
        `SELECT COUNT(*) AS count FROM verified_statements vs
         WHERE vs.session_id = ? AND vs.verdict IN ('fabricated', 'contradicted', 'partially_supported', 'omission')
           AND ${UNRESOLVED_STATEMENT_PREDICATE}`,
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
            statements: statementsByVerificationId.get(v.id) ?? [],
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
                   AND vs.verdict IN ('fabricated', 'contradicted', 'partially_supported', 'omission')
                   AND ${UNRESOLVED_STATEMENT_PREDICATE}) AS flaggedIssues,
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
        // Human-confirmed findings leave the active feed (rows AND the
        // COUNT/pagination query share this predicate — never hide rows
        // only after fetching a page).
        UNRESOLVED_STATEMENT_PREDICATE,
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
                mv.judge_model AS judgeModel, mv.verified_at AS verifiedAt,
                mv.material_revision AS parent_revision
         FROM ${from}
         WHERE ${where}
         ORDER BY vs.created_at DESC, vs.id DESC
         LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset
      );
      const reviewsByMessage = findReviewsByMessageIds(
        rows.map((r) => r.message_id)
      );
      return {
        items: rows.map((row): FlaggedStatementItem => {
          // `parent_revision` is join-only input for token minting: strip
          // it before mapping so strict route response validation never
          // sees an undeclared field.
          const { parent_revision: _parentRevision, ...mappable } = row;
          const [withMetadata] = attachReviewMetadata(
            [mapStatementRow(mappable)],
            new Map([
              [
                row.id,
                {
                  finding_key: row.finding_key ?? null,
                  context_revision: row.context_revision ?? null,
                },
              ],
            ]),
            reviewsByMessage.get(row.message_id) ?? [],
            row.parent_revision ?? null
          );
          return {
            ...(withMetadata as BackendVerifiedStatement),
            sessionName: row.sessionName as string,
            clientName: row.clientName as string,
            chatId: row.chatId as number,
            authoredModel: (row.authoredModel as string | null) ?? null,
            judgeModel: row.judgeModel as string,
            verifiedAt: row.verifiedAt as number,
          };
        }),
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
   * Human confirmations (`verification_statement_reviews`) are message-owned
   * and deliberately PRESERVED: a cleared response returns to the unverified
   * pool, and matching findings stay confirmed when it is re-audited.
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
   * Clears ALL verification data — statements, message verifications, job
   * history rows, AND human confirmations — so the user can re-audit from
   * scratch. This is the explicit clean-slate operation (unlike per-response
   * clear, which preserves confirmations).
   * @returns The number of rows deleted from each verification table.
   */
  resetAllVerifications: (): {
    deletedVerifications: number;
    deletedStatements: number;
    deletedJobs: number;
    deletedReviews: number;
  } => {
    try {
      const result = db.transaction(() => {
        const reviewsInfo = run('DELETE FROM verification_statement_reviews');
        const statementsInfo = run('DELETE FROM verified_statements');
        const verificationsInfo = run('DELETE FROM message_verifications');
        const jobsInfo = run('DELETE FROM verification_jobs');
        return {
          deletedVerifications: Number(verificationsInfo.changes ?? 0),
          deletedStatements: Number(statementsInfo.changes ?? 0),
          deletedJobs: Number(jobsInfo.changes ?? 0),
          deletedReviews: Number(reviewsInfo.changes ?? 0),
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

  /**
   * Bulk review reader for admin backup export. Reviews are exported even
   * when their assessment was cleared (message-owned, assessment-independent).
   * `reusable` maps INTEGER -> boolean so rows validate on import.
   */
  findAllStatementReviewsForBackup: (): BackendStatementReview[] => {
    try {
      const rows = all<any>(
        'SELECT * FROM verification_statement_reviews ORDER BY id ASC'
      );
      return rows.map(mapReviewRow);
    } catch (error) {
      console.error(
        '[VerificationRepo] Error reading statement reviews for backup:',
        error
      );
      throw new Error('Database error reading statement reviews for backup.');
    }
  },

  /**
   * Recompute one message's effective counts from its current statements +
   * durable reviews. Used by backup import to validate/restore aggregates
   * after id remapping (content fingerprints survive remapping, so matching
   * findings re-apply). No-op for missing/non-completed parents.
   */
  recomputeEffectiveVerificationForMessage: (messageId: number): void => {
    try {
      db.transaction(() => {
        const parent = get<any>(
          'SELECT * FROM message_verifications WHERE message_id = ?',
          messageId
        );
        if (!parent || parent.status !== 'completed') return;
        let revision = parent.material_revision as string | null;
        if (revision == null) {
          const live = computeLiveMaterialRevision(
            messageId,
            parent.chat_id,
            parent.session_id
          );
          revision = live.revision;
          run(
            'UPDATE message_verifications SET material_revision = ? WHERE id = ?',
            revision,
            parent.id
          );
        }
        const rows = all<any>(
          'SELECT * FROM verified_statements WHERE message_verification_id = ? ORDER BY statement_index ASC, id ASC',
          parent.id
        );
        // Backfill identity columns when missing (legacy rows), so the
        // feed join and future reruns match restored reviews.
        for (const row of rows) {
          if (row.finding_key == null || row.context_revision == null) {
            run(
              'UPDATE verified_statements SET finding_key = ?, context_revision = ? WHERE id = ?',
              findingKeyForRow(row),
              revision,
              row.id
            );
            row.finding_key = findingKeyForRow(row);
            row.context_revision = revision;
          }
        }
        const reviews = all<any>(
          'SELECT * FROM verification_statement_reviews WHERE message_id = ?',
          messageId
        ).map(mapReviewRow);
        const matched = matchReviewsToStatements(
          rows.map((r) => ({
            id: r.id,
            findingKey: r.finding_key,
            contextRevision: r.context_revision,
          })),
          reviews
        );
        const effective = reduceEffectiveVerificationCounts(
          rows.map((r) => ({
            kind: r.kind as StatementKind,
            verdict: r.verdict as StatementVerdict,
            reviewStatus: matched.has(r.id) ? 'confirmed' : 'unreviewed',
          }))
        );
        run(
          `UPDATE message_verifications
           SET total_claims = ?, supported_claims = ?, partial_claims = ?,
               contradicted_claims = ?, fabricated_claims = ?, omissions_count = ?,
               accuracy_score = ?
           WHERE id = ?`,
          effective.totalClaims,
          effective.supportedClaims,
          effective.partialClaims,
          effective.contradictedClaims,
          effective.fabricatedClaims,
          effective.omissionsCount,
          effective.accuracyScore,
          parent.id
        );
      })();
    } catch (error) {
      console.error(
        `[VerificationRepo] Error recomputing verification for message ${messageId}:`,
        error
      );
      throw new Error('Database error recomputing message verification.');
    }
  },

  /**
   * Dismiss one finding as human-confirmed ("not an issue").
   *
   * Within one short SQLite write transaction: validate the live
   * finding/parent/revision → insert/reuse the review snapshot → reduce all
   * current statements → update parent effective counts/score → return
   * authoritative data. The parent stays `completed` with its original Judge
   * verdicts intact; only effective aggregates change. Job counters,
   * coverage, attribution, usage, and `verified_at` are untouched.
   *
   * @throws StatementReviewNotFoundError when the statement/parent is gone
   *   (including ids replaced by a rerun/clear) — never applies to a
   *   replacement row.
   * @throws StatementReviewConflictError on stale token/material revision,
   *   non-completed parents, or supported statements.
   */
  dismissStatementAsConfirmed: (
    statementId: number,
    expectedReviewToken: string
  ): DismissStatementResult => {
    try {
      return db.transaction(() => {
        const row = get<any>(
          'SELECT * FROM verified_statements WHERE id = ?',
          statementId
        );
        if (!row) {
          throw new StatementReviewNotFoundError(
            `Statement with ID ${statementId} no longer exists (it may have been replaced by a re-audit or cleared). Refresh the current assessment.`
          );
        }
        const parent = get<any>(
          'SELECT * FROM message_verifications WHERE id = ?',
          row.message_verification_id
        );
        if (!parent) {
          throw new StatementReviewNotFoundError(
            `Assessment for statement ${statementId} no longer exists. Refresh the current assessment.`
          );
        }
        if (parent.status !== 'completed') {
          throw new StatementReviewConflictError(
            'not_completed',
            'Only findings from a completed assessment can be confirmed. Refresh the current assessment.',
            loadAuthoritativeVerification(parent)
          );
        }
        if (!isReviewEligibleFinding(row.kind, row.verdict)) {
          throw new StatementReviewConflictError(
            'not_eligible',
            'Supported claims need no confirmation — only partially supported, contradicted, fabricated, or omission findings can be dismissed.',
            loadAuthoritativeVerification(parent)
          );
        }
        const expected = reviewTokenForRow(
          row,
          parent.material_revision ?? null
        );
        if (expected !== expectedReviewToken) {
          throw new StatementReviewConflictError(
            'stale_token',
            'This finding changed since you opened it (stale confirmation token). Refresh the current assessment and try again.',
            loadAuthoritativeVerification(parent)
          );
        }
        const live = computeLiveMaterialRevision(
          row.message_id,
          parent.chat_id,
          parent.session_id
        );
        let revision = parent.material_revision as string | null;
        if (revision != null && revision !== live.revision) {
          throw new StatementReviewConflictError(
            'material_changed',
            'The response or transcript changed since this audit; the confirmation no longer applies to current content. Re-audit, then confirm the new finding if appropriate.',
            loadAuthoritativeVerification(parent)
          );
        }
        if (revision == null) {
          // Legacy baseline: rows audited before revisions existed carry no
          // provenance, so hashing today's content cannot prove what they
          // evaluated. The user's confirmation applies to the CURRENT
          // displayed finding, so adopt live material as the baseline going
          // forward (documented; never presented as historical provenance).
          run(
            'UPDATE message_verifications SET material_revision = ? WHERE id = ?',
            live.revision,
            parent.id
          );
          revision = live.revision;
        }

        const currentRows = all<any>(
          'SELECT * FROM verified_statements WHERE message_verification_id = ? ORDER BY statement_index ASC, id ASC',
          parent.id
        );
        const baseKey = findingKeyForRow(row);
        let storageKey = baseKey;
        let reusable = 1;
        let confirmedStatementId: number | null = null;
        const unresolvedSpan =
          row.kind === 'claim' &&
          (row.start_char == null || row.end_char == null);
        if (unresolvedSpan) {
          const siblings = currentRows
            .filter((r) => r.id !== row.id)
            .map((r) => ({
              exactQuote: r.exact_quote as string,
              normalizedClaim: r.normalized_claim as string,
            }));
          if (
            isUnresolvedClaimAmbiguous(
              live.visibleAnswer,
              row.exact_quote,
              row.normalized_claim,
              siblings
            )
          ) {
            // Ambiguous: confirm only this row, never auto-reuse across runs.
            reusable = 0;
            confirmedStatementId = row.id;
            storageKey = computeAmbiguousReviewKey(baseKey, row.id);
          }
        }

        // Idempotent repeat: same live statement/token returns the existing
        // review with its original confirmed_at (no count changes).
        const existing = get<any>(
          `SELECT * FROM verification_statement_reviews
           WHERE message_id = ? AND context_revision = ? AND finding_key = ?`,
          row.message_id,
          revision,
          storageKey
        );
        if (!existing) {
          try {
            run(
              insertStatementReviewSql,
              row.message_id,
              parent.session_id,
              VERIFICATION_REVIEW_IDENTITY_VERSION,
              revision,
              storageKey,
              reusable,
              confirmedStatementId,
              Date.now(),
              row.kind,
              row.exact_quote,
              row.normalized_claim,
              row.start_char ?? null,
              row.end_char ?? null,
              row.verdict,
              row.severity,
              row.confidence,
              row.reasoning,
              row.transcript_evidence_json ?? null
            );
          } catch (insertError) {
            // Duplicate-dismiss race: a concurrent transaction committed the
            // same review first. Re-read inside this transaction; a genuine
            // bug (still missing) rethrows.
            if (!isUniqueConstraintError(insertError)) throw insertError;
            const raced = get<any>(
              `SELECT * FROM verification_statement_reviews
               WHERE message_id = ? AND context_revision = ? AND finding_key = ?`,
              row.message_id,
              revision,
              storageKey
            );
            if (!raced) throw insertError;
          }
        }

        // Backfill stored identity on the selected row (legacy rows start
        // NULL) so feed/SQL matching and token stability hold.
        run(
          'UPDATE verified_statements SET finding_key = ?, context_revision = ? WHERE id = ?',
          baseKey,
          revision,
          row.id
        );

        // Reduce ALL current statements with the full durable review set and
        // persist effective aggregates (counts/score only).
        const freshRows = all<any>(
          'SELECT * FROM verified_statements WHERE message_verification_id = ? ORDER BY statement_index ASC, id ASC',
          parent.id
        );
        const reviews = all<any>(
          'SELECT * FROM verification_statement_reviews WHERE message_id = ?',
          row.message_id
        ).map(mapReviewRow);
        const matched = matchReviewsToStatements(
          freshRows.map((r) => ({
            id: r.id,
            findingKey: r.finding_key,
            contextRevision: r.context_revision,
          })),
          reviews
        );
        const effective = reduceEffectiveVerificationCounts(
          freshRows.map((r) => ({
            kind: r.kind as StatementKind,
            verdict: r.verdict as StatementVerdict,
            reviewStatus: matched.has(r.id) ? 'confirmed' : 'unreviewed',
          }))
        );
        run(
          `UPDATE message_verifications
           SET total_claims = ?, supported_claims = ?, partial_claims = ?,
               contradicted_claims = ?, fabricated_claims = ?, omissions_count = ?,
               accuracy_score = ?
           WHERE id = ?`,
          effective.totalClaims,
          effective.supportedClaims,
          effective.partialClaims,
          effective.contradictedClaims,
          effective.fabricatedClaims,
          effective.omissionsCount,
          effective.accuracyScore,
          parent.id
        );

        const freshParent = get<any>(
          'SELECT * FROM message_verifications WHERE id = ?',
          parent.id
        );
        const verification = loadAuthoritativeVerification(freshParent);
        const target = (verification.statements ?? []).find(
          (s) => s.id === statementId
        );
        if (!target) {
          throw new StatementReviewNotFoundError(
            `Statement with ID ${statementId} no longer exists. Refresh the current assessment.`
          );
        }
        return { statement: target, verification };
      })();
    } catch (error) {
      if (
        error instanceof StatementReviewNotFoundError ||
        error instanceof StatementReviewConflictError
      ) {
        throw error;
      }
      console.error(
        `[VerificationRepo] Error dismissing statement ${statementId}:`,
        error
      );
      throw new Error('Database error dismissing verified statement.');
    }
  },
};
