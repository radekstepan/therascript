// packages/api/src/routes/jobsRoutes.ts
import { Elysia, t } from 'elysia';
import { getActiveJobCountHandler } from '../api/jobsHandler.js';

const ActiveJobCountResponseSchema = t.Object({
  total: t.Number(),
  transcription: t.Number(),
  analysis: t.Number(),
});

export const jobsRoutes = new Elysia({ prefix: '/api/jobs' })
  .model({
    activeJobCountResponse: ActiveJobCountResponseSchema,
  })
  .group('', { detail: { tags: ['Jobs'] } }, (app) =>
    app.get('/active-count', getActiveJobCountHandler, {
      response: {
        200: 'activeJobCountResponse',
      },
      detail: {
        summary: 'Get the count of active and waiting background jobs',
      },
    })
  );
