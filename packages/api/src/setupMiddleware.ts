import { Elysia, ValidationError } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import config from '@therascript/config';
import {
  ApiError,
  InternalServerError,
  ConflictError,
  NotFoundError,
} from './errors.js';
import { Client } from '@elastic/elasticsearch';

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error) || 'An unknown error occurred';
  }
};

const getErrorStack = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;

export function setupMiddleware(appVersion: string, esClient: Client) {
  return new Elysia({ name: 'middleware' })
    .decorate('esClient', esClient)
    .use(
      cors({
        origin: config.server.corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', '*'],
      })
    )
    .onRequest(({ request }) => {
      const origin = request.headers.get('origin');
      console.log(
        `[Request] --> ${request.method} ${new URL(request.url).pathname}${origin ? ` (Origin: ${origin})` : ''}`
      );
    })
    .onAfterHandle(({ request, set }) => {
      console.log(
        `[Request] <-- ${request.method} ${new URL(request.url).pathname} ${set.status ?? '???'}`
      );
    })
    .use(
      swagger({
        path: '/api/docs',
        exclude: ['/api/docs', '/api/docs/json', '/api/health', '/api/schema'],
        documentation: {
          info: { title: 'Therascript API (Elysia)', version: appVersion },
          tags: [
            {
              name: 'Session',
              description: 'Session and Transcript Endpoints',
            },
            {
              name: 'Chat',
              description: 'Chat Interaction Endpoints (Session & Standalone)',
            },
            {
              name: 'Standalone Chat',
              description: 'Standalone Chat Endpoints',
            },
            {
              name: 'Templates',
              description: 'Manage reusable text templates',
            },
            { name: 'Analysis', description: 'Multi-session analysis jobs' },
            {
              name: 'Search',
              description: 'Elasticsearch Full-Text Search Endpoints',
            },
            { name: 'Jobs', description: 'Background Job Management' },
            {
              name: 'Transcription',
              description: 'Transcription Job Management',
            },
            { name: 'Docker', description: 'Docker Container Management' },
            { name: 'System', description: 'System-level Actions' },
            {
              name: 'Admin',
              description: 'Administrative Actions (e.g., re-indexing)',
            },
            { name: 'Meta', description: 'API Metadata and Health' },
            {
              name: 'Usage',
              description: 'Usage Tracking and Cost Estimation',
            },
          ],
        },
      })
    )
    .onError(({ code, error, set, request }) => {
      if ((error as any).meta?.body?.error?.type) {
        console.error(
          '[Error Handler] Elasticsearch Client Error:',
          (error as any).meta.body.error
        );
      }
      const errorMessage = getErrorMessage(error);
      let path = 'N/A';
      let method = 'N/A';
      try {
        if (request?.url) path = new URL(request.url).pathname;
        if (request?.method) method = request.method;
      } catch {}

      console.error(
        `[Error] Code: ${code} | Method: ${method} | Path: ${path} | Message: ${errorMessage}`
      );
      if (!config.server.isProduction) {
        const stack = getErrorStack(error);
        if (stack) console.error('Stack:', stack);
        if (!(error instanceof Error))
          console.error('Full Error Object:', error);
      }

      if (error instanceof ApiError) {
        set.status = error.status;
        return {
          error: error.name,
          message: error.message,
          details: error.details,
        };
      }

      switch (code) {
        case 'NOT_FOUND':
          set.status = 404;
          return {
            error: 'NotFound',
            message: `Route ${method} ${path} not found.`,
          };
        case 'INTERNAL_SERVER_ERROR':
          const internalError = new InternalServerError(
            'An unexpected internal error occurred.',
            error instanceof Error ? error : undefined
          );
          set.status = internalError.status;
          return {
            error: internalError.name,
            message: internalError.message,
            details: internalError.details,
          };
        case 'PARSE':
          set.status = 400;
          return {
            error: 'ParseError',
            message: 'Failed to parse request body.',
            details: errorMessage,
          };
        case 'VALIDATION':
          const validationDetails =
            error instanceof ValidationError ? error.all : undefined;
          set.status = 400;
          return {
            error: 'ValidationError',
            message: 'Request validation failed.',
            details: errorMessage,
            validationErrors: validationDetails,
          };
        case 'UNKNOWN':
          console.error('[Error Handler] Unknown Elysia Error Code:', error);
          const unknownInternalError = new InternalServerError(
            'An unknown internal error occurred.',
            error instanceof Error ? error : undefined
          );
          set.status = unknownInternalError.status;
          return {
            error: unknownInternalError.name,
            message: unknownInternalError.message,
            details: unknownInternalError.details,
          };
        default:
          break;
      }

      const sqliteCode = (error as any)?.code;
      if (typeof sqliteCode === 'string' && sqliteCode.startsWith('SQLITE_')) {
        if (
          sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
          sqliteCode.includes('CONSTRAINT')
        ) {
          const conflictError = new ConflictError(
            'Database constraint violation.',
            config.server.isProduction ? undefined : errorMessage
          );
          set.status = conflictError.status;
          return {
            error: conflictError.name,
            message: conflictError.message,
            details: conflictError.details,
          };
        } else {
          const dbError = new InternalServerError(
            'A database operation failed.',
            error instanceof Error ? error : undefined
          );
          set.status = dbError.status;
          return {
            error: dbError.name,
            message: dbError.message,
            details: dbError.details,
          };
        }
      }

      console.error('[Error Handler] Unhandled Error Type:', error);
      const fallbackError = new InternalServerError(
        'An unexpected server error occurred.',
        error instanceof Error ? error : undefined
      );
      set.status = fallbackError.status;
      return {
        error: fallbackError.name,
        message: fallbackError.message,
        details: fallbackError.details,
      };
    });
}
