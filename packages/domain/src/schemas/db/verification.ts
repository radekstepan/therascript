import { z } from 'zod';

export const verificationJobStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'canceled',
]);

export const verificationJobScopeSchema = z.enum([
  'all_unverified',
  'all_force',
  'selected_sessions',
  'single_chat',
]);

export const verificationPhaseSchema = z.enum([
  'waiting_for_lock',
  'loading_judge',
  'checking_message',
  'generating',
  'retrying',
  'finishing',
]);

export const verificationFailureCodeSchema = z.enum([
  'empty_output',
  'malformed_json',
  'truncated_output',
  'invalid_structure',
  'provider_error',
  'context_budget',
  'missing_transcript',
]);

export const verificationJobSchema = z.object({
  id: z.number().int().positive(),
  status: verificationJobStatusSchema,
  scope: verificationJobScopeSchema,
  session_ids_json: z.string().nullable(),
  chat_id: z.number().int().positive().nullable(),
  skip_verified: z.boolean(),
  total_messages: z.number().int().nonnegative(),
  processed_messages: z.number().int().nonnegative(),
  succeeded_messages: z.number().int().nonnegative().optional().default(0),
  failed_messages: z.number().int().nonnegative().optional().default(0),
  skipped_messages: z.number().int().nonnegative().optional().default(0),
  current_phase: verificationPhaseSchema.nullable().optional().default(null),
  current_message_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),
  current_attempt: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .default(null),
  phase_updated_at: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .default(null),
  total_statements: z.number().int().nonnegative(),
  flagged_statements: z.number().int().nonnegative(),
  omissions_count: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  completed_at: z.number().int().nonnegative().nullable(),
  error_message: z.string().nullable(),
  model_name: z.string().nullable(),
  context_size: z.number().int().nonnegative().nullable(),
  thinking_budget: z.number().int().nullable(),
  temperature: z.number().nullable(),
  top_p: z.number().nullable(),
  repeat_penalty: z.number().nullable(),
  num_gpu_layers: z.number().int().nullable(),
  llm_base_url: z.string().nullable(),
});

export const messageVerificationStatusSchema = z.enum([
  'completed',
  'failed',
  'skipped',
]);

export const messageVerificationSchema = z.object({
  id: z.number().int().positive(),
  message_id: z.number().int().positive(),
  chat_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
  verification_job_id: z.number().int().positive().nullable(),
  authored_model: z.string().nullable(),
  judge_model: z.string(),
  status: messageVerificationStatusSchema,
  total_claims: z.number().int().nonnegative(),
  supported_claims: z.number().int().nonnegative(),
  partial_claims: z.number().int().nonnegative(),
  contradicted_claims: z.number().int().nonnegative(),
  fabricated_claims: z.number().int().nonnegative(),
  omissions_count: z.number().int().nonnegative(),
  accuracy_score: z.number().nonnegative(),
  summary_assessment: z.string().nullable(),
  prompt_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  verified_at: z.number().int().nonnegative(),
  error_message: z.string().nullable(),
  error_code: verificationFailureCodeSchema.nullable().optional().default(null),
});

export const statementKindSchema = z.enum(['claim', 'omission']);

export const statementVerdictSchema = z.enum([
  'supported',
  'partially_supported',
  'contradicted',
  'fabricated',
  'omission',
]);

export const statementSeveritySchema = z.enum([
  'none',
  'low',
  'medium',
  'high',
  'critical',
]);

export const verifiedStatementSchema = z.object({
  id: z.number().int().positive(),
  message_verification_id: z.number().int().positive(),
  message_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
  statement_index: z.number().int().nonnegative(),
  kind: statementKindSchema,
  exact_quote: z.string(),
  normalized_claim: z.string(),
  start_char: z.number().int().nonnegative().nullable(),
  end_char: z.number().int().nonnegative().nullable(),
  verdict: statementVerdictSchema,
  severity: statementSeveritySchema,
  confidence: z.number().nonnegative(),
  reasoning: z.string(),
  transcript_evidence_json: z.string().nullable(),
  created_at: z.number().int().nonnegative(),
});

export const transcriptEvidenceItemSchema = z.object({
  paragraphIndex: z.number().int().nonnegative().nullable(),
  timestampMs: z.number().int().nonnegative().nullable(),
  speaker: z.string().nullable(),
  quote: z.string(),
});

export const sessionVerificationSummarySchema = z.object({
  sessionId: z.number().int().nonnegative(),
  sessionName: z.string(),
  clientName: z.string(),
  date: z.string(),
  totalAiMessages: z.number().int().nonnegative(),
  verifiedAiMessages: z.number().int().nonnegative(),
  failedAiMessages: z.number().int().nonnegative().optional().default(0),
  isFullyVerified: z.boolean(),
  flaggedIssues: z.number().int().nonnegative(),
  averageAccuracy: z.number().nullable(),
});

export const globalVerificationAnalyticsSchema = z.object({
  totalMessagesAudited: z.number().int().nonnegative(),
  overallAccuracyPercent: z.number(),
  totalClaims: z.number().int().nonnegative(),
  supportedClaims: z.number().int().nonnegative(),
  partialClaims: z.number().int().nonnegative(),
  contradictedClaims: z.number().int().nonnegative(),
  fabricatedClaims: z.number().int().nonnegative(),
  omissions: z.number().int().nonnegative(),
  unverifiedMessagesCount: z.number().int().nonnegative(),
  failedMessagesCount: z.number().int().nonnegative().optional().default(0),
  sessionsSummary: z.array(sessionVerificationSummarySchema),
});

export type VerificationJobRow = z.infer<typeof verificationJobSchema>;
export type MessageVerificationRow = z.infer<typeof messageVerificationSchema>;
export type VerifiedStatementRow = z.infer<typeof verifiedStatementSchema>;
export type TranscriptEvidenceItemRow = z.infer<
  typeof transcriptEvidenceItemSchema
>;
export type VerificationJobStatusRow = z.infer<
  typeof verificationJobStatusSchema
>;
export type VerificationJobScopeRow = z.infer<
  typeof verificationJobScopeSchema
>;
export type StatementVerdictRow = z.infer<typeof statementVerdictSchema>;
export type StatementSeverityRow = z.infer<typeof statementSeveritySchema>;
export type VerificationPhaseRow = z.infer<typeof verificationPhaseSchema>;
export type VerificationFailureCodeRow = z.infer<
  typeof verificationFailureCodeSchema
>;
