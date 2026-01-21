import { Elysia, t } from 'elysia';
// --- REMOVED ollama import, use service layer instead ---
// import ollama from 'ollama';
// --- END REMOVAL ---
import config from '@therascript/config';
import {
  ApiError,
  InternalServerError,
  ConflictError,
  BadRequestError,
  NotFoundError,
} from '../errors.js';
import {
  checkModelStatus,
  listModels,
  loadOllamaModel,
  startPullModelJob,
  getPullModelJobStatus,
  cancelPullModelJob,
  deleteOllamaModel as deleteOllamaModelService,
  unloadActiveModel, // <-- Import the new service function
} from '../services/ollamaService.js';
import {
  setActiveModelAndContext,
  getActiveModel,
  getConfiguredContextSize,
} from '../services/activeModelService.js';
import type {
  OllamaModelInfo,
  OllamaPullJobStatus,
  OllamaPullJobStatusState,
} from '@therascript/domain';

// --- Ollama Response/Request Schemas ---
const OllamaModelDetailSchema = t.Object({
  format: t.String(),
  family: t.String(),
  families: t.Union([t.Array(t.String()), t.Null()]),
  parameter_size: t.String(),
  quantization_level: t.String(),
});
const OllamaModelInfoSchema = t.Object({
  // This schema defines the API output (strings for dates)
  name: t.String(),
  modified_at: t.String(),
  size: t.Number(),
  digest: t.String(),
  details: OllamaModelDetailSchema,
  defaultContextSize: t.Optional(t.Union([t.Number(), t.Null()])), // <-- ADDED
  size_vram: t.Optional(t.Number()),
  expires_at: t.Optional(t.String()),
  // size_total removed
});
const AvailableModelsResponseSchema = t.Object({
  models: t.Array(OllamaModelInfoSchema),
});
const OllamaStatusResponseSchema = t.Object({
  status: t.Union([t.Literal('available'), t.Literal('unavailable')]),
  activeModel: t.String(),
  modelChecked: t.String(),
  loaded: t.Boolean(),
  details: t.Optional(OllamaModelInfoSchema), // Uses the string-date schema, will include defaultContextSize
  configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
});
const SetModelBodySchema = t.Object({
  modelName: t.String({ minLength: 1, error: 'Model name is required.' }),
  contextSize: t.Optional(
    t.Union([
      t.Number({
        minimum: 1,
        error: 'Context size must be a positive integer.',
      }),
      t.Null(),
    ])
  ),
});
const PullModelBodySchema = t.Object({
  modelName: t.String({ minLength: 1, error: 'Model name is required.' }),
});
const StartPullResponseSchema = t.Object({
  jobId: t.String(),
  message: t.String(),
});
const PullStatusResponseSchema = t.Object({
  jobId: t.String(),
  modelName: t.String(),
  status: t.Enum({
    queued: 'queued',
    parsing: 'parsing',
    downloading: 'downloading',
    verifying: 'verifying',
    completed: 'completed',
    failed: 'failed',
    canceling: 'canceling',
    canceled: 'canceled',
  } satisfies Record<OllamaPullJobStatusState, OllamaPullJobStatusState>),
  message: t.String(),
  progress: t.Optional(t.Number()),
  completedBytes: t.Optional(t.Number()),
  totalBytes: t.Optional(t.Number()),
  startTime: t.Number(),
  endTime: t.Optional(t.Number()),
  error: t.Optional(t.String()),
});
const JobIdParamSchema = t.Object({
  jobId: t.String({ minLength: 1, error: 'Job ID must be provided' }),
});
const CancelPullResponseSchema = t.Object({ message: t.String() });
const DeleteModelBodySchema = t.Object({
  modelName: t.String({ minLength: 1, error: 'Model name is required.' }),
});
const DeleteModelResponseSchema = t.Object({ message: t.String() });

export const ollamaRoutes = new Elysia({ prefix: '/api/ollama' })
  .model({
    setModelBody: SetModelBodySchema,
    pullModelBody: PullModelBodySchema,
    ollamaModelInfo: OllamaModelInfoSchema,
    availableModelsResponse: AvailableModelsResponseSchema,
    ollamaStatusResponse: OllamaStatusResponseSchema,
    startPullResponse: StartPullResponseSchema,
    pullStatusResponse: PullStatusResponseSchema,
    jobIdParam: JobIdParamSchema,
    cancelPullResponse: CancelPullResponseSchema,
    deleteModelBody: DeleteModelBodySchema,
    deleteModelResponse: DeleteModelResponseSchema,
  })
  .group('', { detail: { tags: ['Ollama'] } }, (app) =>
    app
      .get(
        '/available-models',
        async ({ set }) => {
          console.log(`[API Models] Requesting available models`);
          try {
            const models = await listModels(); // Service returns internal type (Date objects, defaultContextSize)
            set.status = 200;
            // Convert Date objects to strings and ensure defaultContextSize is included
            const responseModels = models.map((m) => ({
              ...m,
              modified_at: m.modified_at.toISOString(),
              expires_at: m.expires_at?.toISOString(),
              defaultContextSize: m.defaultContextSize ?? null, // Ensure it's null if undefined
            }));
            return { models: responseModels };
          } catch (error: any) {
            console.error(
              `[API Models] Error fetching available models:`,
              error
            );
            if (error instanceof InternalServerError) throw error;
            throw new InternalServerError(
              `Failed to fetch available models from Ollama.`,
              error
            );
          }
        },
        {
          response: { 200: 'availableModelsResponse', 500: t.Any() },
          detail: { summary: 'List locally available Ollama models' },
        }
      )
      .post(
        '/set-model',
        async ({ body, set }) => {
          const { modelName, contextSize } = body;
          const sizeLog =
            contextSize === undefined
              ? 'default'
              : contextSize === null
                ? 'explicit default'
                : contextSize;
          console.log(
            `[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}`
          );
          try {
            setActiveModelAndContext(modelName, contextSize);
            await loadOllamaModel(modelName);
            set.status = 200;
            return {
              message: `Active model set to ${modelName} (context: ${getConfiguredContextSize() ?? 'default'}). Load initiated. Check status.`,
            };
          } catch (error: any) {
            console.error(
              `[API SetModel] Error setting/loading model ${modelName} (context: ${sizeLog}):`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to set active model or initiate load for ${modelName}.`,
              error
            );
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
            summary:
              'Set the active Ollama model and context size, trigger load',
          },
        }
      )
      .post(
        '/unload',
        async ({ set }) => {
          const modelToUnload = getActiveModel();
          console.log(
            `[API Unload] Received request to unload active model: ${modelToUnload}`
          );
          try {
            const resultMessage = await unloadActiveModel(); // Call service function
            set.status = 200;
            return { message: resultMessage };
          } catch (error: any) {
            console.error(
              `[API Unload] Error during unload for ${modelToUnload}:`,
              error
            );
            // Re-throw specific errors or default to InternalServerError
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to unload model ${modelToUnload}.`,
              error
            );
          }
        },
        {
          response: {
            200: t.Object({ message: t.String() }),
            404: t.Any(),
            500: t.Any(),
            503: t.Any(),
          },
          detail: {
            summary:
              'Request Ollama to unload the currently active model from memory',
          },
        }
      )
      .post(
        '/pull-model',
        ({ body, set }) => {
          const { modelName } = body;
          console.log(
            `[API PullModel] Received request to START pull model job: ${modelName}`
          );
          try {
            const jobId = startPullModelJob(modelName);
            set.status = 202;
            return {
              jobId,
              message: `Pull job started for ${modelName}. Check status using job ID.`,
            };
          } catch (error: any) {
            console.error(
              `[API PullModel] Error initiating pull job for model ${modelName}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to initiate pull job for model ${modelName}.`,
              error
            );
          }
        },
        {
          body: 'pullModelBody',
          response: { 202: 'startPullResponse', 400: t.Any(), 500: t.Any() },
          detail: {
            summary: 'Initiate downloading a new Ollama model (poll status)',
          },
        }
      )
      .get(
        '/pull-status/:jobId',
        ({ params, set }) => {
          const { jobId } = params;
          console.log(
            `[API PullStatus] Received status request for job: ${jobId}`
          );
          try {
            const status: OllamaPullJobStatus | null =
              getPullModelJobStatus(jobId); // Service returns internal type
            if (!status) {
              throw new NotFoundError(`Pull job with ID ${jobId} not found.`);
            }
            set.status = 200;
            // Return object conforming to PullStatusResponseSchema
            return {
              jobId: status.jobId,
              modelName: status.modelName,
              status: status.status,
              message: status.message,
              progress: status.progress,
              completedBytes: status.completedBytes,
              totalBytes: status.totalBytes,
              startTime: status.startTime,
              endTime: status.endTime,
              error: status.error,
            };
          } catch (error: any) {
            console.error(
              `[API PullStatus] Error getting status for job ${jobId}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to get status for pull job ${jobId}.`,
              error
            );
          }
        },
        {
          params: 'jobIdParam',
          response: { 200: 'pullStatusResponse', 404: t.Any(), 500: t.Any() },
          detail: {
            summary:
              'Get the status and progress of an ongoing Ollama model pull job',
          },
        }
      )
      .post(
        '/cancel-pull/:jobId',
        ({ params, set }) => {
          const { jobId } = params;
          console.log(
            `[API CancelPull] Received cancel request for job: ${jobId}`
          );
          try {
            const cancelled = cancelPullModelJob(jobId);
            if (!cancelled) {
              const jobStatus: OllamaPullJobStatus | null =
                getPullModelJobStatus(jobId);
              if (!jobStatus) {
                throw new NotFoundError(`Pull job with ID ${jobId} not found.`);
              } else {
                throw new ConflictError(
                  `Cannot cancel job ${jobId}, status is ${jobStatus.status}.`
                );
              }
            }
            set.status = 200;
            return { message: `Cancellation request sent for job ${jobId}.` };
          } catch (error: any) {
            console.error(
              `[API CancelPull] Error cancelling job ${jobId}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to cancel pull job ${jobId}.`,
              error
            );
          }
        },
        {
          params: 'jobIdParam',
          response: {
            200: 'cancelPullResponse',
            404: t.Any(),
            409: t.Any(),
            500: t.Any(),
          },
          detail: {
            summary: 'Attempt to cancel an ongoing Ollama model pull job',
          },
        }
      )
      .post(
        '/delete-model',
        async ({ body, set }) => {
          const { modelName } = body;
          console.log(
            `[API DeleteModel] Received request to delete model: ${modelName}`
          );
          try {
            const resultMessage = await deleteOllamaModelService(modelName);
            set.status = 200;
            return { message: resultMessage };
          } catch (error: any) {
            console.error(
              `[API DeleteModel] Error deleting model ${modelName}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to delete model ${modelName}.`,
              error
            );
          }
        },
        {
          body: 'deleteModelBody',
          response: {
            200: 'deleteModelResponse',
            400: t.Any(),
            404: t.Any(),
            409: t.Any(),
            500: t.Any(),
          },
          detail: { summary: 'Delete a locally downloaded Ollama model' },
        }
      )
      .get(
        '/status',
        async ({ query, set }) => {
          const currentActiveModel = getActiveModel();
          const currentConfiguredContext = getConfiguredContextSize();
          const modelNameToCheck = query.modelName ?? currentActiveModel;
          console.log(
            `[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'})`
          );
          try {
            const loadedModelResult = await checkModelStatus(modelNameToCheck);
            set.status = 200;
            if (
              loadedModelResult &&
              'status' in loadedModelResult &&
              loadedModelResult.status === 'unavailable'
            ) {
              return {
                status: 'unavailable',
                activeModel: currentActiveModel,
                modelChecked: modelNameToCheck,
                loaded: false,
                details: undefined,
                configuredContextSize: currentConfiguredContext,
              };
            } else {
              const loadedModelInfo =
                loadedModelResult as OllamaModelInfo | null;
              const detailsResponse = loadedModelInfo
                ? {
                    ...loadedModelInfo,
                    modified_at: loadedModelInfo.modified_at.toISOString(),
                    expires_at: loadedModelInfo.expires_at?.toISOString(),
                    defaultContextSize:
                      loadedModelInfo.defaultContextSize ?? null, // Ensure null if undefined
                  }
                : undefined;
              return {
                status: 'available',
                activeModel: currentActiveModel,
                modelChecked: modelNameToCheck,
                loaded: !!loadedModelInfo,
                details: detailsResponse,
                configuredContextSize: currentConfiguredContext,
              };
            }
          } catch (error: any) {
            console.error(
              `[API Status] Unexpected error checking status for ${modelNameToCheck}:`,
              error
            );
            throw new InternalServerError(
              `Failed to check status of model ${modelNameToCheck}.`
            );
          }
        },
        {
          query: t.Optional(t.Object({ modelName: t.Optional(t.String()) })),
          response: { 200: 'ollamaStatusResponse', 500: t.Any() },
          detail: {
            summary:
              'Check loaded status & configured/default context sizes for active/specific model',
          },
        }
      )
  );
