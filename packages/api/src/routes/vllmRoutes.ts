// packages/api/src/routes/vllmRoutes.ts
import { Elysia, t } from 'elysia';
import { ApiError, InternalServerError, BadRequestError } from '../errors.js';
import { listModels, checkModelStatus } from '../services/vllmService.js';
import {
  setActiveModelAndContext,
  getActiveModel,
  getConfiguredContextSize,
} from '../services/activeModelService.js';
import type { OllamaModelInfo } from '../types/index.js';

// --- vLLM Response/Request Schemas ---
const VllmModelDetailSchema = t.Object({
  format: t.String(),
  family: t.String(),
  families: t.Union([t.Array(t.String()), t.Null()]),
  parameter_size: t.String(),
  quantization_level: t.String(),
});

const VllmModelInfoSchema = t.Object({
  name: t.String(),
  modified_at: t.String(),
  size: t.Number(),
  digest: t.String(),
  details: VllmModelDetailSchema,
  defaultContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
});

const AvailableModelsResponseSchema = t.Object({
  models: t.Array(VllmModelInfoSchema),
});

const VllmStatusResponseSchema = t.Object({
  status: t.Union([t.Literal('available'), t.Literal('unavailable')]),
  activeModel: t.String(),
  modelChecked: t.String(),
  loaded: t.Boolean(),
  details: t.Optional(VllmModelInfoSchema),
  configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
});

const SetModelBodySchema = t.Object({
  modelName: t.String({ minLength: 1, error: 'Model name is required.' }),
  contextSize: t.Optional(t.Union([t.Number({ minimum: 1 }), t.Null()])),
});

export const vllmRoutes = new Elysia({ prefix: '/api/vllm' })
  .model({
    setModelBody: SetModelBodySchema,
    availableModelsResponse: AvailableModelsResponseSchema,
    vllmStatusResponse: VllmStatusResponseSchema,
  })
  .group('', { detail: { tags: ['vLLM'] } }, (app) =>
    app
      .get(
        '/available-models',
        async ({ set }) => {
          try {
            const models = await listModels();
            set.status = 200;
            return {
              models: models.map((m) => ({
                ...m,
                modified_at: m.modified_at.toISOString(),
              })),
            };
          } catch (error: any) {
            console.error(
              '[API Models] Error fetching available models:',
              error
            );
            if (error instanceof InternalServerError) throw error;
            throw new InternalServerError(
              'Failed to fetch available models from vLLM.',
              error
            );
          }
        },
        {
          response: { 200: 'availableModelsResponse', 500: t.Any() },
          detail: { summary: 'List model served by vLLM' },
        }
      )
      .post(
        '/set-model',
        ({ body, set }) => {
          const { modelName, contextSize } = body;
          try {
            setActiveModelAndContext(modelName, contextSize);
            set.status = 200;
            return {
              message: `Active model set to ${modelName}. The vLLM service must be manually configured to serve this model.`,
            };
          } catch (error: any) {
            console.error(
              `[API SetModel] Error setting active model ${modelName}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError('Failed to set active model.', error);
          }
        },
        {
          body: 'setModelBody',
          response: {
            200: t.Object({ message: t.String() }),
            400: t.Any(),
            500: t.Any(),
          },
          detail: {
            summary: 'Set the active vLLM model for the API to use in requests',
          },
        }
      )
      .get(
        '/status',
        async ({ query, set }) => {
          const currentActiveModel = getActiveModel();
          const modelNameToCheck = query.modelName ?? currentActiveModel;
          try {
            const checkResult = await checkModelStatus(modelNameToCheck);
            set.status = 200;
            if (
              checkResult &&
              'status' in checkResult &&
              checkResult.status === 'unavailable'
            ) {
              return {
                status: 'unavailable',
                activeModel: currentActiveModel,
                modelChecked: modelNameToCheck,
                loaded: false,
                details: undefined,
                configuredContextSize: getConfiguredContextSize(),
              };
            }
            const modelInfo = checkResult as OllamaModelInfo | null;
            return {
              status: 'available',
              activeModel: currentActiveModel,
              modelChecked: modelNameToCheck,
              loaded: !!modelInfo,
              details: modelInfo
                ? {
                    ...modelInfo,
                    modified_at: modelInfo.modified_at.toISOString(),
                  }
                : undefined,
              configuredContextSize: getConfiguredContextSize(),
            };
          } catch (error: any) {
            console.error(
              `[API Status] Unexpected error checking status for ${modelNameToCheck}:`,
              error
            );
            throw new InternalServerError(
              'Failed to check status of vLLM service.'
            );
          }
        },
        {
          query: t.Optional(t.Object({ modelName: t.Optional(t.String()) })),
          response: { 200: 'vllmStatusResponse', 500: t.Any() },
          detail: {
            summary: 'Check vLLM service status and which model it is serving',
          },
        }
      )
  );
