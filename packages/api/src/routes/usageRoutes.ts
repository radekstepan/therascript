import { Elysia, t } from 'elysia';
import { getUsageHistory, getUsageStats } from '../api/usageHandler.js';

export const usageRoutes = new Elysia({ prefix: '/api' }).group(
  '/usage',
  { detail: { tags: ['Usage'] } },
  (app) =>
    app
      .get('/history', getUsageHistory, {
        query: t.Object({
          weeks: t.Optional(t.String()),
        }),
        detail: {
          summary: 'Get weekly usage history',
        },
        response: t.Object({
          weeks: t.Array(
            t.Object({
              weekStart: t.Number(),
              weekEnd: t.Number(),
              llm: t.Object({
                totalPromptTokens: t.Number(),
                totalCompletionTokens: t.Number(),
                estimatedCost: t.Number(),
                callCount: t.Number(),
              }),
              whisper: t.Object({
                totalDuration: t.Number(),
                estimatedCost: t.Number(),
                callCount: t.Number(),
              }),
              totalCost: t.Number(),
            })
          ),
          pricing: t.Object({
            llm: t.Record(
              t.String(),
              t.Object({
                promptCostPer1M: t.Number(),
                completionCostPer1M: t.Number(),
              })
            ),
            whisper: t.Record(
              t.String(),
              t.Object({
                costPerMinute: t.Number(),
              })
            ),
          }),
        }),
      })
      .get('/stats', getUsageStats, {
        detail: {
          summary: 'Get overall usage statistics',
        },
        response: t.Object({
          llm: t.Object({
            totalPromptTokens: t.Number(),
            totalCompletionTokens: t.Number(),
            estimatedCost: t.Number(),
            callCount: t.Number(),
            callsByModel: t.Record(t.String(), t.Number()),
            callsBySource: t.Record(t.String(), t.Number()),
          }),
          whisper: t.Object({
            totalDuration: t.Number(),
            estimatedCost: t.Number(),
            callCount: t.Number(),
            callsByModel: t.Record(t.String(), t.Number()),
          }),
          totalEstimatedCost: t.Number(),
        }),
      })
      .get(
        '/logs',
        async ({ query, set }) => {
          const { getUsageLogs: getUsageLogsFn } = await import(
            '../api/usageHandler.js'
          );
          return getUsageLogsFn({ query, set });
        },
        {
          query: t.Object({
            start: t.Optional(t.String()),
            end: t.Optional(t.String()),
            type: t.Optional(t.Union([t.Literal('llm'), t.Literal('whisper')])),
            model: t.Optional(t.String()),
            source: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
          detail: {
            summary: 'Get paginated usage logs with filtering',
          },
          response: t.Object({
            items: t.Array(
              t.Object({
                id: t.Number(),
                type: t.Union([t.Literal('llm'), t.Literal('whisper')]),
                source: t.String(),
                model: t.String(),
                promptTokens: t.Union([t.Null(), t.Number()]),
                completionTokens: t.Union([t.Null(), t.Number()]),
                duration: t.Union([t.Null(), t.Number()]),
                timestamp: t.Number(),
                estimatedCost: t.Number(),
              })
            ),
            total: t.Number(),
            limit: t.Number(),
            offset: t.Number(),
          }),
        }
      )
);
