// packages/api/src/routes/analysisRoutes.ts
import { Elysia, t } from 'elysia';
import {
  createAnalysisJobHandler,
  listAnalysisJobsHandler,
  getAnalysisJobHandler,
  cancelAnalysisJobHandler,
  deleteAnalysisJobHandler,
  streamAnalysisJobHandler,
} from '../api/analysisHandler.js';

// Schemas
const AnalysisJobSchema = t.Object({
  id: t.Number(),
  original_prompt: t.String(),
  short_prompt: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('generating_strategy'),
    t.Literal('mapping'),
    t.Literal('reducing'),
    t.Literal('completed'),
    t.Literal('failed'),
    t.Literal('canceling'),
    t.Literal('canceled'),
  ]),
  final_result: t.Union([t.String(), t.Null()]),
  error_message: t.Union([t.String(), t.Null()]),
  created_at: t.Number(),
  completed_at: t.Union([t.Number(), t.Null()]),
  model_name: t.Union([t.String(), t.Null()]),
  context_size: t.Union([t.Number(), t.Null()]),
  strategy_json: t.Union([t.String(), t.Null()]), // Raw JSON from DB
});

const IntermediateSummarySchema = t.Object({
  id: t.Number(),
  analysis_job_id: t.Number(),
  session_id: t.Number(),
  summary_text: t.Union([t.String(), t.Null()]),
  status: t.String(),
  error_message: t.Union([t.String(), t.Null()]),
  sessionName: t.String(),
  sessionDate: t.String(),
});

// Parsed strategy for the UI
const AnalysisStrategySchema = t.Object({
  intermediate_question: t.String(),
  final_synthesis_instructions: t.String(),
});

const AnalysisJobWithDetailsSchema = t.Intersect([
  AnalysisJobSchema,
  t.Object({
    summaries: t.Array(IntermediateSummarySchema),
    strategy: t.Union([AnalysisStrategySchema, t.Null()]), // Parsed object
  }),
]);

const CreateAnalysisJobBodySchema = t.Object({
  prompt: t.String({
    minLength: 10,
    error: 'Prompt must be at least 10 characters.',
  }),
  sessionIds: t.Array(t.Number(), {
    minItems: 1,
    error: 'At least one session ID is required.',
  }),
  modelName: t.Optional(t.String()),
  useAdvancedStrategy: t.Optional(t.Boolean()),
  contextSize: t.Optional(t.Number({ minimum: 1 })),
  mapPhaseSystemPrompt: t.Optional(
    t.String({ maxLength: 2000, error: 'Map phase system prompt is too long.' })
  ),
  /**
   * Optional LM Studio-compatible base URL override. When provided, the
   * worker uses this URL for the Map/Reduce streams; when omitted, the
   * backend's currently active base URL is used. Mirrors the same field on
   * the chat `set-model` endpoint.
   */
  baseUrl: t.Optional(t.String({ maxLength: 2048 })),
  /**
   * Per-job LLM sampling/loading overrides. When provided, the worker
   * honors these for the Map/Reduce streams instead of falling back to the
   * globally configured values. All optional so existing clients keep
   * working unchanged.
   */
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  topP: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  repeatPenalty: t.Optional(t.Number({ minimum: 0.5, maximum: 2 })),
  numGpuLayers: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  thinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
});

const JobIdParamSchema = t.Object({
  jobId: t.Numeric({ minimum: 1, error: 'Job ID must be a positive number.' }),
});

export const analysisRoutes = new Elysia({ prefix: '/api/analysis-jobs' })
  .model({
    analysisJob: AnalysisJobSchema,
    analysisJobWithDetails: AnalysisJobWithDetailsSchema,
    createAnalysisJobBody: CreateAnalysisJobBodySchema,
    jobIdParam: JobIdParamSchema,
  })
  .group('', { detail: { tags: ['Analysis'] } }, (app) =>
    app
      .post('/', createAnalysisJobHandler, {
        body: 'createAnalysisJobBody',
        response: { 202: t.Object({ jobId: t.Number() }) },
        detail: { summary: 'Create a new multi-session analysis job' },
      })
      .get('/', listAnalysisJobsHandler, {
        response: { 200: t.Array(AnalysisJobSchema) },
        detail: { summary: 'List all analysis jobs' },
      })
      .get('/:jobId', getAnalysisJobHandler, {
        params: 'jobIdParam',
        response: { 200: 'analysisJobWithDetails' },
        detail: {
          summary: 'Get the status and result of a single analysis job',
        },
      })
      .get('/:jobId/stream', streamAnalysisJobHandler, {
        params: 'jobIdParam',
        detail: {
          summary: 'Stream analysis logs and tokens via SSE',
        },
      })
      .post('/:jobId/cancel', cancelAnalysisJobHandler, {
        params: 'jobIdParam',
        response: { 202: t.Object({ message: t.String() }) },
        detail: { summary: 'Request to cancel a running analysis job' },
      })
      .delete('/:jobId', deleteAnalysisJobHandler, {
        params: 'jobIdParam',
        response: { 200: t.Object({ message: t.String() }) },
        detail: { summary: 'Delete an analysis job and its data' },
      })
  );
