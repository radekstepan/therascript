import { Elysia, t } from 'elysia';
import { InternalServerError } from '../errors.js';
import { checkDatabaseHealth } from '@therascript/db';
import {
  getElasticsearchClient,
  checkEsHealth,
} from '@therascript/elasticsearch-client'; // Import ES client utils
import config from '@therascript/config';
import { getReadinessStatus } from '../api/metaHandler.js';

const HealthResponseSchema = t.Object({
  status: t.String(),
  database: t.String(),
  elasticsearch: t.String(),
  timestamp: t.String(),
});

const ReadinessStatusResponseSchema = t.Object({
  ready: t.Boolean(),
  services: t.Object({
    database: t.String(),
    elasticsearch: t.String(),
    ollama: t.String(),
    whisper: t.String(),
  }),
  timestamp: t.String(),
});

export const metaRoutes = new Elysia({ prefix: '/api' })
  .model({
    healthResponse: HealthResponseSchema, // Add health response schema
    readinessStatusResponse: ReadinessStatusResponseSchema,
  })
  .group('', { detail: { tags: ['Meta'] } }, (app) =>
    app
      .get(
        '/health',
        async ({ set }) => {
          let dbStatus = 'disconnected';
          let esStatus = 'disconnected';
          try {
            checkDatabaseHealth();
            dbStatus = 'connected';
          } catch (dbError) {
            console.warn('[Health Check] Database error:', dbError);
          }

          try {
            const esClient = getElasticsearchClient(config.elasticsearch.url);
            if (await checkEsHealth(esClient)) {
              esStatus = 'connected';
            }
          } catch (esError) {
            console.warn('[Health Check] Elasticsearch error:', esError);
          }

          const overallStatus =
            dbStatus === 'connected' && esStatus === 'connected'
              ? 'OK'
              : 'DEGRADED';
          set.status = overallStatus === 'OK' ? 200 : 503;

          return {
            status: overallStatus,
            database: dbStatus,
            elasticsearch: esStatus,
            timestamp: new Date().toISOString(),
          };
        },
        {
          detail: { summary: 'Check API, Database, and Elasticsearch health' },
          response: { 200: 'healthResponse', 503: 'healthResponse' }, // Use defined schema
        }
      )
      .get('/status/readiness', getReadinessStatus, {
        detail: {
          summary: 'Check if all dependent backend services are ready',
        },
        response: {
          200: 'readinessStatusResponse',
          503: 'readinessStatusResponse',
        },
      })
      .get(
        '/schema',
        ({ set }) => {
          set.status = 501;
          return {
            message:
              'API schema definition is not available here. Use /api/docs for Swagger UI.',
          };
        },
        {
          detail: { summary: 'API Schema Information (Redirects to Swagger)' },
        }
      )
  );
