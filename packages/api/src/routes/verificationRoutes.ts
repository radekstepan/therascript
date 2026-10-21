// packages/api/src/routes/verificationRoutes.ts
import { Elysia, t } from 'elysia';
import {
  createVerificationJobHandler,
  listVerificationJobsHandler,
  getVerificationJobHandler,
  cancelVerificationJobHandler,
  streamVerificationJobHandler,
  getVerificationStatsHandler,
  listVerificationStatementsHandler,
  deleteMessageVerificationHandler,
  resetVerificationsHandler,
} from '../api/verificationHandler.js';

const VerificationJobStatusSchema = t.Union([
  t.Literal('pending'),
  t.Literal('processing'),
  t.Literal('completed'),
  t.Literal('failed'),
  t.Literal('canceled'),
]);

const VerificationJobScopeSchema = t.Union([
  t.Literal('all_unverified'),
  t.Literal('all_force'),
  t.Literal('selected_sessions'),
  t.Literal('single_chat'),
]);

const VerificationJobSchema = t.Object({
  id: t.Number(),
  status: VerificationJobStatusSchema,
  scope: VerificationJobScopeSchema,
  session_ids_json: t.Union([t.String(), t.Null()]),
  chat_id: t.Union([t.Number(), t.Null()]),
  skip_verified: t.Boolean(),
  total_messages: t.Number(),
  processed_messages: t.Number(),
  total_statements: t.Number(),
  flagged_statements: t.Number(),
  omissions_count: t.Number(),
  created_at: t.Number(),
  completed_at: t.Union([t.Number(), t.Null()]),
  error_message: t.Union([t.String(), t.Null()]),
  model_name: t.Union([t.String(), t.Null()]),
  context_size: t.Union([t.Number(), t.Null()]),
  thinking_budget: t.Union([t.Number(), t.Null()]),
  temperature: t.Union([t.Number(), t.Null()]),
  top_p: t.Union([t.Number(), t.Null()]),
  repeat_penalty: t.Union([t.Number(), t.Null()]),
  num_gpu_layers: t.Union([t.Number(), t.Null()]),
  llm_base_url: t.Union([t.String(), t.Null()]),
});

const CreateVerificationJobBodySchema = t.Object({
  scope: VerificationJobScopeSchema,
  sessionIds: t.Optional(t.Array(t.Number({ minimum: 1 }))),
  chatId: t.Optional(t.Number({ minimum: 1 })),
  skipVerified: t.Optional(t.Boolean()),
  /** Optional Judge LLM overrides; omitted fields fall back to global config. */
  modelName: t.Optional(t.String({ minLength: 1 })),
  contextSize: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])),
  thinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  topP: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  repeatPenalty: t.Optional(t.Number({ minimum: 0.5, maximum: 2 })),
  numGpuLayers: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  baseUrl: t.Optional(t.String({ maxLength: 2048 })),
});

const JobIdParamSchema = t.Object({
  jobId: t.Numeric({ minimum: 1, error: 'Job ID must be a positive number.' }),
});

const MessageIdParamSchema = t.Object({
  messageId: t.Numeric({
    minimum: 1,
    error: 'Message ID must be a positive number.',
  }),
});

const TranscriptEvidenceItemSchema = t.Object({
  paragraphIndex: t.Union([t.Number(), t.Null()]),
  timestampMs: t.Union([t.Number(), t.Null()]),
  speaker: t.Union([t.String(), t.Null()]),
  quote: t.String(),
});

const VerifiedStatementSchema = t.Object({
  id: t.Number(),
  message_verification_id: t.Number(),
  message_id: t.Number(),
  session_id: t.Number(),
  statement_index: t.Number(),
  kind: t.Union([t.Literal('claim'), t.Literal('omission')]),
  exact_quote: t.String(),
  normalized_claim: t.String(),
  start_char: t.Union([t.Number(), t.Null()]),
  end_char: t.Union([t.Number(), t.Null()]),
  verdict: t.Union([
    t.Literal('supported'),
    t.Literal('partially_supported'),
    t.Literal('contradicted'),
    t.Literal('fabricated'),
    t.Literal('omission'),
  ]),
  severity: t.Union([
    t.Literal('none'),
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('critical'),
  ]),
  confidence: t.Number(),
  reasoning: t.String(),
  transcript_evidence_json: t.Union([t.String(), t.Null()]),
  evidence: t.Optional(t.Array(TranscriptEvidenceItemSchema)),
  created_at: t.Number(),
});

const FlaggedStatementItemSchema = t.Intersect([
  VerifiedStatementSchema,
  t.Object({
    sessionName: t.String(),
    clientName: t.String(),
    chatId: t.Number(),
    authoredModel: t.Union([t.String(), t.Null()]),
    judgeModel: t.String(),
    verifiedAt: t.Number(),
  }),
]);

const FlaggedStatementsResponseSchema = t.Object({
  items: t.Array(FlaggedStatementItemSchema),
  total: t.Number(),
  limit: t.Number(),
  offset: t.Number(),
});

const ModelAccuracyStatSchema = t.Object({
  model: t.String(),
  messagesAudited: t.Number(),
  totalClaims: t.Number(),
  supportedClaims: t.Number(),
  partialClaims: t.Number(),
  contradictedClaims: t.Number(),
  fabricatedClaims: t.Number(),
  omissions: t.Number(),
  accuracyPercent: t.Number(),
  fabricationRate: t.Number(),
  contradictionRate: t.Number(),
  omissionsPerMessage: t.Number(),
  averageAccuracyScore: t.Number(),
});

const VerificationTimepointStatSchema = t.Object({
  date: t.String(),
  messagesAudited: t.Number(),
  totalClaims: t.Number(),
  accuracyPercent: t.Number(),
  fabrications: t.Number(),
  contradictions: t.Number(),
  omissions: t.Number(),
});

const SessionVerificationSummarySchema = t.Object({
  sessionId: t.Number(),
  sessionName: t.String(),
  clientName: t.String(),
  date: t.String(),
  totalAiMessages: t.Number(),
  verifiedAiMessages: t.Number(),
  isFullyVerified: t.Boolean(),
  flaggedIssues: t.Number(),
  averageAccuracy: t.Union([t.Number(), t.Null()]),
});

const VerificationGlobalStatsSchema = t.Object({
  totalMessagesAudited: t.Number(),
  overallAccuracyPercent: t.Number(),
  totalClaims: t.Number(),
  supportedClaims: t.Number(),
  partialClaims: t.Number(),
  contradictedClaims: t.Number(),
  fabricatedClaims: t.Number(),
  omissions: t.Number(),
  unverifiedMessagesCount: t.Number(),
  byModel: t.Array(ModelAccuracyStatSchema),
  overTime: t.Array(VerificationTimepointStatSchema),
  sessionsSummary: t.Array(SessionVerificationSummarySchema),
});

const VerificationStatsQuerySchema = t.Object({
  sessionId: t.Optional(t.String()),
  model: t.Optional(t.String()),
  startDate: t.Optional(t.String()),
  endDate: t.Optional(t.String()),
});

const VerificationStatementsQuerySchema = t.Object({
  verdict: t.Optional(t.String()),
  severity: t.Optional(t.String()),
  authoredModel: t.Optional(t.String()),
  sessionId: t.Optional(t.String()),
  search: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const verificationRoutes = new Elysia({ prefix: '/api/verification' })
  .model({
    verificationJob: VerificationJobSchema,
    createVerificationJobBody: CreateVerificationJobBodySchema,
    jobIdParam: JobIdParamSchema,
    messageIdParam: MessageIdParamSchema,
    flaggedStatementsResponse: FlaggedStatementsResponseSchema,
    verificationGlobalStats: VerificationGlobalStatsSchema,
    verificationStatsQuery: VerificationStatsQuerySchema,
    verificationStatementsQuery: VerificationStatementsQuerySchema,
  })
  .group('', { detail: { tags: ['Verification'] } }, (app) =>
    app
      .post('/jobs', createVerificationJobHandler, {
        body: 'createVerificationJobBody',
        response: { 202: t.Object({ jobId: t.Number() }) },
        detail: { summary: 'Create and enqueue a new fact-verification job' },
      })
      .get('/jobs', listVerificationJobsHandler, {
        response: { 200: t.Array(VerificationJobSchema) },
        detail: { summary: 'List recent verification jobs' },
      })
      .get('/jobs/:jobId', getVerificationJobHandler, {
        params: 'jobIdParam',
        response: { 200: 'verificationJob' },
        detail: {
          summary: 'Get the status and counters of a single verification job',
        },
      })
      .get('/jobs/:jobId/stream', streamVerificationJobHandler, {
        params: 'jobIdParam',
        detail: {
          summary: 'Stream verification job progress via SSE',
        },
      })
      .post('/jobs/:jobId/cancel', cancelVerificationJobHandler, {
        params: 'jobIdParam',
        response: { 202: t.Object({ message: t.String() }) },
        detail: { summary: 'Cancel a pending or processing verification job' },
      })
      .get('/stats', getVerificationStatsHandler, {
        query: 'verificationStatsQuery',
        response: { 200: 'verificationGlobalStats' },
        detail: {
          summary:
            'Get global verification analytics (KPIs, per-model accuracy, trends, session coverage)',
        },
      })
      .get('/statements', listVerificationStatementsHandler, {
        query: 'verificationStatementsQuery',
        response: { 200: 'flaggedStatementsResponse' },
        detail: {
          summary:
            'List paginated/filterable flagged statements (verdict, severity, model, session, search)',
        },
      })
      .delete('/messages/:messageId', deleteMessageVerificationHandler, {
        params: 'messageIdParam',
        response: { 200: t.Object({ message: t.String() }) },
        detail: {
          summary: 'Clear the verification for a specific chat message',
        },
      })
      .delete('/reset', resetVerificationsHandler, {
        response: {
          200: t.Object({
            message: t.String(),
            deletedVerifications: t.Number(),
          }),
        },
        detail: {
          summary: 'Clear all verifications so chats can be re-audited',
        },
      })
  );
