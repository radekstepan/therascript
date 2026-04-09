import { Elysia, t } from 'elysia';
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
  loadLlmModel,
  startDownloadModelJob,
  getDownloadModelJobStatus,
  cancelDownloadModelJob,
  deleteLlmModel as deleteLlmModelService,
  unloadActiveModel,
  fetchVramUsage,
  getVramPerToken,
} from '../services/llamaCppService.js';
import {
  setActiveModelAndContextAndParams,
  getActiveModel,
  getConfiguredContextSize,
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
  getConfiguredThinkingBudget,
} from '../services/activeModelService.js';
import type {
  LlmModelInfo,
  ModelDownloadJobStatus,
  ModelDownloadJobStatusState,
} from '@therascript/domain';

// --- LLM Response/Request Schemas ---
const LlmModelDetailSchema = t.Object({
  format: t.String(),
  family: t.String(),
  families: t.Union([t.Array(t.String()), t.Null()]),
  parameter_size: t.String(),
  quantization_level: t.String(),
});
const LlmModelInfoSchema = t.Object({
  name: t.String(),
  modified_at: t.String(),
  size: t.Number(),
  digest: t.String(),
  details: LlmModelDetailSchema,
  defaultContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
  size_vram: t.Optional(t.Number()),
  expires_at: t.Optional(t.String()),
});
const AvailableModelsResponseSchema = t.Object({
  models: t.Array(LlmModelInfoSchema),
});
const LlmStatusResponseSchema = t.Object({
  status: t.Union([t.Literal('available'), t.Literal('unavailable')]),
  activeModel: t.String(),
  modelChecked: t.String(),
  loaded: t.Boolean(),
  details: t.Optional(LlmModelInfoSchema),
  configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
  configuredTemperature: t.Optional(t.Number()),
  configuredTopP: t.Optional(t.Number()),
  configuredRepeatPenalty: t.Optional(t.Number()),
  configuredNumGpuLayers: t.Optional(t.Union([t.Number(), t.Null()])),
  configuredThinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
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
  temperature: t.Optional(t.Number({ minimum: 0, maximum: 2 })),
  topP: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  repeatPenalty: t.Optional(t.Number({ minimum: 0.5, maximum: 2 })),
  numGpuLayers: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  thinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
});
const PullModelBodySchema = t.Object({
  modelUrl: t.String({ minLength: 1, error: 'Model URL is required.' }),
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
  } satisfies Record<ModelDownloadJobStatusState, ModelDownloadJobStatusState>),
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
const EstimateVramResponseSchema = t.Object({
  model: t.String(),
  context_size: t.Union([t.Number(), t.Null()]),
  num_gpu_layers: t.Optional(t.Union([t.Number(), t.Null()])),
  estimated_vram_bytes: t.Union([t.Number(), t.Null()]),
  estimated_ram_bytes: t.Union([t.Number(), t.Null()]),
  vram_per_token_bytes: t.Union([t.Number(), t.Null()]),
  breakdown: t.Optional(
    t.Object({
      weights_bytes: t.Number(),
      weights_vram_bytes: t.Number(),
      weights_ram_bytes: t.Number(),
      kv_cache_bytes: t.Number(),
      overhead_bytes: t.Number(),
    })
  ),
  error: t.Optional(t.String()),
});

export const llmRoutes = new Elysia({ prefix: '/api/llm' })
  .model({
    setModelBody: SetModelBodySchema,
    pullModelBody: PullModelBodySchema,
    llmModelInfo: LlmModelInfoSchema,
    availableModelsResponse: AvailableModelsResponseSchema,
    llmStatusResponse: LlmStatusResponseSchema,
    startPullResponse: StartPullResponseSchema,
    pullStatusResponse: PullStatusResponseSchema,
    jobIdParam: JobIdParamSchema,
    cancelPullResponse: CancelPullResponseSchema,
    deleteModelBody: DeleteModelBodySchema,
    deleteModelResponse: DeleteModelResponseSchema,
    estimateVramResponse: EstimateVramResponseSchema,
  })
  .group('', { detail: { tags: ['LLM'] } }, (app) =>
    app
      .get(
        '/available-models',
        async ({ set }) => {
          console.log(`[API Models] Requesting available models`);
          try {
            const models = await listModels();
            set.status = 200;
            const responseModels = models.map((m) => ({
              ...m,
              modified_at: m.modified_at.toISOString(),
              expires_at: m.expires_at?.toISOString(),
              defaultContextSize: m.defaultContextSize ?? null,
            }));
            return { models: responseModels };
          } catch (error: any) {
            console.error(
              `[API Models] Error fetching available models:`,
              error
            );
            if (error instanceof InternalServerError) throw error;
            throw new InternalServerError(
              `Failed to fetch available models.`,
              error
            );
          }
        },
        {
          response: { 200: 'availableModelsResponse', 500: t.Any() },
          detail: { summary: 'List locally available LLM models (GGUF files)' },
        }
      )
      .post(
        '/set-model',
        async ({ body, set }) => {
          const {
            modelName,
            contextSize,
            temperature,
            topP,
            repeatPenalty,
            numGpuLayers,
            thinkingBudget,
          } = body;
          const sizeLog =
            contextSize === undefined
              ? 'default'
              : contextSize === null
                ? 'explicit default'
                : contextSize;
          console.log(
            `[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}, temperature=${temperature}, topP=${topP}, repeatPenalty=${repeatPenalty}, numGpuLayers=${numGpuLayers ?? 'auto'}, thinkingBudget=${thinkingBudget ?? 'unrestricted'}`
          );
          try {
            setActiveModelAndContextAndParams(
              modelName,
              contextSize,
              temperature,
              topP,
              repeatPenalty,
              numGpuLayers,
              thinkingBudget
            );
            await loadLlmModel(modelName);
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
              'Set the active LLM model and context size, trigger server restart with new model',
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
            const resultMessage = await unloadActiveModel();
            set.status = 200;
            return { message: resultMessage };
          } catch (error: any) {
            console.error(
              `[API Unload] Error during unload for ${modelToUnload}:`,
              error
            );
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
              'Stop the LLM server, unloading the currently active model from memory',
          },
        }
      )
      .post(
        '/pull-model',
        ({ body, set }) => {
          const { modelUrl } = body;
          console.log(
            `[API PullModel] Received request to START pull model job: ${modelUrl}`
          );
          try {
            const jobId = startDownloadModelJob(modelUrl);
            set.status = 202;
            return {
              jobId,
              message: `Download job started. Check status using job ID.`,
            };
          } catch (error: any) {
            console.error(
              `[API PullModel] Error initiating pull job for model ${modelUrl}:`,
              error
            );
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to initiate pull job for model ${modelUrl}.`,
              error
            );
          }
        },
        {
          body: 'pullModelBody',
          response: { 202: 'startPullResponse', 400: t.Any(), 500: t.Any() },
          detail: {
            summary: 'Initiate downloading a new GGUF model file (poll status)',
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
            const status: ModelDownloadJobStatus | null =
              getDownloadModelJobStatus(jobId);
            if (!status) {
              throw new NotFoundError(`Pull job with ID ${jobId} not found.`);
            }
            set.status = 200;
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
              'Get the status and progress of an ongoing model download job',
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
            const cancelled = cancelDownloadModelJob(jobId);
            if (!cancelled) {
              const jobStatus: ModelDownloadJobStatus | null =
                getDownloadModelJobStatus(jobId);
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
            summary: 'Attempt to cancel an ongoing model download job',
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
            const resultMessage = await deleteLlmModelService(modelName);
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
          detail: { summary: 'Delete a locally downloaded GGUF model file' },
        }
      )
      .get(
        '/status',
        async ({ query, set }) => {
          const currentActiveModel = getActiveModel();
          const currentConfiguredContext = getConfiguredContextSize();
          const currentConfiguredTemperature = getConfiguredTemperature();
          const currentConfiguredTopP = getConfiguredTopP();
          const currentConfiguredRepeatPenalty = getConfiguredRepeatPenalty();
          const currentConfiguredNumGpuLayers = getConfiguredNumGpuLayers();
          const currentConfiguredThinkingBudget = getConfiguredThinkingBudget();
          const modelNameToCheck = query.modelName ?? currentActiveModel;
          console.log(
            `[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'}, Temperature: ${currentConfiguredTemperature}, TopP: ${currentConfiguredTopP}, RepeatPenalty: ${currentConfiguredRepeatPenalty}, NumGpuLayers: ${currentConfiguredNumGpuLayers ?? 'auto'}, ThinkingBudget: ${currentConfiguredThinkingBudget ?? 'unrestricted'})`
          );
          try {
            const loadedModelResult = await checkModelStatus(modelNameToCheck);
            // Re-fetch since sync might have happened inside checkModelStatus
            const latestActiveModel = getActiveModel();
            const latestContextSize = getConfiguredContextSize();

            set.status = 200;
            if (
              loadedModelResult &&
              'status' in loadedModelResult &&
              loadedModelResult.status === 'unavailable'
            ) {
              return {
                status: 'unavailable',
                activeModel: latestActiveModel,
                modelChecked: modelNameToCheck,
                loaded: false,
                details: undefined,
                configuredContextSize: latestContextSize,
                configuredTemperature: currentConfiguredTemperature,
                configuredTopP: currentConfiguredTopP,
                configuredRepeatPenalty: currentConfiguredRepeatPenalty,
                configuredNumGpuLayers: currentConfiguredNumGpuLayers,
                configuredThinkingBudget: currentConfiguredThinkingBudget,
              };
            } else {
              const loadedModelInfo = loadedModelResult as LlmModelInfo | null;
              const detailsResponse = loadedModelInfo
                ? {
                    ...loadedModelInfo,
                    modified_at: loadedModelInfo.modified_at.toISOString(),
                    expires_at: loadedModelInfo.expires_at?.toISOString(),
                    defaultContextSize:
                      loadedModelInfo.defaultContextSize ?? null,
                  }
                : undefined;
              return {
                status: 'available',
                activeModel: latestActiveModel,
                modelChecked: modelNameToCheck,
                loaded: !!loadedModelInfo,
                details: detailsResponse,
                configuredContextSize: latestContextSize,
                configuredTemperature: currentConfiguredTemperature,
                configuredTopP: currentConfiguredTopP,
                configuredRepeatPenalty: currentConfiguredRepeatPenalty,
                configuredNumGpuLayers: currentConfiguredNumGpuLayers,
                configuredThinkingBudget: currentConfiguredThinkingBudget,
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
          response: { 200: 'llmStatusResponse', 500: t.Any() },
          detail: {
            summary:
              'Check loaded status & configured/default context sizes for active/specific model',
          },
        }
      )
      .get(
        '/models/:name/estimate-vram',
        async ({ params, query, set }) => {
          const modelName = decodeURIComponent(params.name);
          const contextSize = query.context_size;
          const numGpuLayers = query.num_gpu_layers;

          if (
            contextSize !== undefined &&
            contextSize !== null &&
            contextSize <= 0
          ) {
            throw new BadRequestError(
              'context_size must be a positive integer when provided'
            );
          }

          const models = await listModels();
          const model = models.find((m) => m.name === modelName);

          if (!model) {
            throw new NotFoundError(`Model '${modelName}' not found`);
          }

          const estimate = await fetchVramUsage(
            model,
            contextSize ?? undefined,
            numGpuLayers
          );

          if (estimate === null) {
            return {
              model: modelName,
              context_size: contextSize ?? null,
              num_gpu_layers: numGpuLayers ?? null,
              estimated_vram_bytes: null,
              estimated_ram_bytes: null,
              vram_per_token_bytes: model.architecture
                ? getVramPerToken(model)
                : null,
              error: model.architecture
                ? 'VRAM estimation failed'
                : 'LM Studio VRAM estimate unavailable',
            };
          }

          const vramPerToken = getVramPerToken(model);

          return {
            model: modelName,
            context_size: contextSize ?? null,
            num_gpu_layers: numGpuLayers ?? null,
            estimated_vram_bytes: estimate.vram_bytes,
            estimated_ram_bytes: estimate.ram_bytes,
            vram_per_token_bytes: vramPerToken,
            breakdown: {
              weights_bytes: estimate.weights_bytes,
              weights_vram_bytes: estimate.weights_bytes - estimate.ram_bytes,
              weights_ram_bytes: estimate.ram_bytes,
              kv_cache_bytes: estimate.kv_cache_bytes,
              overhead_bytes: estimate.overhead_bytes,
            },
          };
        },
        {
          params: t.Object({
            name: t.String({ minLength: 1, error: 'Model name is required.' }),
          }),
          query: t.Object({
            context_size: t.Optional(
              t.Union([
                t.Number({
                  minimum: 1,
                  error: 'Context size must be a positive integer.',
                }),
                t.Null(),
              ])
            ),
            num_gpu_layers: t.Optional(
              t.Union([t.Number({ minimum: 0 }), t.Null()])
            ),
          }),
          response: {
            200: 'estimateVramResponse',
            400: t.Any(),
            404: t.Any(),
            500: t.Any(),
          },
          detail: {
            summary:
              'Estimate VRAM usage for a model at a specific context size',
          },
        }
      )
  );
