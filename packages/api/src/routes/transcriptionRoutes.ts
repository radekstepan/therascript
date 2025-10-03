// packages/api/src/routes/transcriptionRoutes.ts
import { Elysia, t } from 'elysia';
import { getTranscriptionStatus } from '../services/transcriptionService.js';
import type { WhisperJobStatus } from '../types/index.js';
import { NotFoundError, ApiError } from '../errors.js';

const JobIdParamSchema = t.Object({
  jobId: t.String({
    minLength: 1,
    error: 'Job ID must be a valid string.',
  }),
});

// This schema should match the UI type UITranscriptionStatus
const TranscriptionStatusResponseSchema = t.Object({
  job_id: t.String(),
  status: t.String(),
  progress: t.Optional(t.Union([t.Number(), t.Null()])),
  error: t.Optional(t.Union([t.String(), t.Null()])),
  duration: t.Optional(t.Union([t.Number(), t.Null()])),
  message: t.Optional(t.Union([t.String(), t.Null()])),
});

export const transcriptionRoutes = new Elysia({ prefix: '/api/transcription' })
  .model({
    jobIdParam: JobIdParamSchema,
    transcriptionStatusResponse: TranscriptionStatusResponseSchema,
  })
  .group('', { detail: { tags: ['Transcription'] } }, (app) =>
    app.get(
      '/status/:jobId',
      async ({ params, set }) => {
        const { jobId } = params;
        try {
          const status: WhisperJobStatus = await getTranscriptionStatus(jobId);
          set.status = 200;
          // Map the full WhisperJobStatus to the simpler UITranscriptionStatus
          return {
            job_id: status.job_id,
            status: status.status,
            progress: status.progress,
            error: status.error,
            duration: status.duration,
            message: status.message,
          };
        } catch (error) {
          if (error instanceof NotFoundError) {
            set.status = 404;
            return { error: 'Not Found', message: error.message };
          }
          if (error instanceof ApiError) {
            set.status = error.status;
            return { error: error.name, message: error.message };
          }
          set.status = 500;
          return {
            error: 'Internal Server Error',
            message: 'An unexpected error occurred.',
          };
        }
      },
      {
        params: 'jobIdParam',
        response: {
          200: 'transcriptionStatusResponse',
          404: t.Any(),
          500: t.Any(),
        },
        detail: {
          summary: 'Get the status of a specific transcription job',
        },
      }
    )
  );
