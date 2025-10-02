// packages/api/src/routes/analysisRoutes.ts
import { Elysia, t } from 'elysia';
import {
  createAnalysisJobHandler,
  listAnalysisJobsHandler,
  getAnalysisJobHandler,
  cancelAnalysisJobHandler,
  deleteAnalysisJobHandler,
} from '../api/analysisHandler.js';

// Schemas
const AnalysisJobSchema = t.Object({
  id: t.Number(),
  original_prompt: t.String(),
  short_prompt: t.String(),
  status: t.String(),
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
  contextSize: t.Optional(t.Number({ minimum: 1 })),
  useAdvancedStrategy: t.Optional(t.Boolean()), // <-- THE FIX IS HERE
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
