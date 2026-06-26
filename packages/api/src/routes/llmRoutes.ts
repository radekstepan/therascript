import { Elysia, t } from 'elysia';
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
  unloadModelAtUrl,
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
  getActiveBaseUrl,
  getDefaultBaseUrl,
  isRemoteLlmBaseUrl,
  normalizeLlmBaseUrl,
  hasActiveApiToken,
  setActiveApiToken,
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
  details: t.Optional(LlmModelDetailSchema),
  configuredContextSize: t.Optional(t.Union([t.Number(), t.Null()])),
  configuredTemperature: t.Optional(t.Number()),
  configuredTopP: t.Optional(t.Number()),
  configuredRepeatPenalty: t.Optional(t.Number()),
  configuredNumGpuLayers: t.Optional(t.Union([t.Number(), t.Null()])),
  configuredThinkingBudget: t.Optional(t.Union([t.Number(), t.Null()])),
  activeBaseUrl: t.String(),
  defaultBaseUrl: t.String(),
  isRemoteBaseUrl: t.Boolean(),
  hasRemoteApiToken: t.Boolean(),
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
  baseUrl: t.Optional(t.Union([t.String(), t.Null()])),
});
const PullModelBodySchema = t.Object({
  modelUrl: t.String({ minLength: 1, error: 'Model URL is required.' }),
});
/**
 * Body for POST /api/llm/api-token. Accepts a non-empty string to set or
 * replace the global remote LLM API token, and an empty string or explicit
 * `null` to clear it. The token is stored in the DB and automatically
 * attached as `Authorization: Bearer <token>` to every request targeting
 * a non-local base URL.
 */
const SetApiTokenBodySchema = t.Object({
  token: t.Optional(
    t.Union([
      t.String({ minLength: 1, error: 'Token must be a non-empty string.' }),
      t.Null(),
    ])
  ),
});
const SetApiTokenResponseSchema = t.Object({
  message: t.String(),
  hasRemoteApiToken: t.Boolean(),
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
    setApiTokenBody: SetApiTokenBodySchema,
    setApiTokenResponse: SetApiTokenResponseSchema,
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
        async ({ query, set }) => {
          const baseUrlQuery =
            typeof query.baseUrl === 'string' && query.baseUrl.trim().length > 0
              ? query.baseUrl.trim()
              : null;
          console.log(
            `[API Models] Requesting available models${
              baseUrlQuery ? ` (baseUrl=${baseUrlQuery})` : ''
            }`
          );
          try {
            const models = await listModels(baseUrlQuery);
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
            if (error instanceof ApiError) throw error;
            throw new InternalServerError(
              `Failed to fetch available models.`,
              error
            );
          }
        },
        {
          query: t.Object({
            baseUrl: t.Optional(t.String()),
          }),
          response: {
            200: 'availableModelsResponse',
            400: t.Any(),
            500: t.Any(),
          },
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
            baseUrl,
          } = body;
          const sizeLog =
            contextSize === undefined
              ? 'default'
              : contextSize === null
                ? 'explicit default'
                : contextSize;

          // Normalize baseUrl when provided. `undefined` -> leave the active
          // base URL alone. `null` -> reset to default. A string -> set the
          // explicit URL.
          let normalizedBaseUrl: string | null | undefined = undefined;
          if (baseUrl !== undefined) {
            try {
              normalizedBaseUrl = normalizeLlmBaseUrl(baseUrl);
            } catch (err: any) {
              throw new BadRequestError(
                err?.message || 'Invalid LLM base URL.'
              );
            }
          }

          // If the active base URL is about to change, unload any model
          // currently loaded on the *previous* URL so we don't leave a
          // stale model in VRAM on the other server. The subsequent
          // `loadLlmModel(...)` below handles loading on the new URL.
          const previousBaseUrl = getActiveBaseUrl();
          const nextBaseUrl =
            normalizedBaseUrl === undefined
              ? previousBaseUrl
              : (normalizedBaseUrl ?? getDefaultBaseUrl());
          if (nextBaseUrl !== previousBaseUrl) {
            try {
              const unloaded = await unloadModelAtUrl(previousBaseUrl);
              console.log(
                `[API SetModel] Pre-switch unload: removed ${unloaded} model(s) from previous URL ${previousBaseUrl} (switching to ${nextBaseUrl})`
              );
            } catch (unloadErr: any) {
              console.warn(
                `[API SetModel] Pre-switch unload on ${previousBaseUrl} failed (non-fatal): ${unloadErr.message}`
              );
            }
          }

          console.log(
            `[API SetModel] Request: Set active model=${modelName}, contextSize=${sizeLog}, temperature=${temperature}, topP=${topP}, repeatPenalty=${repeatPenalty}, numGpuLayers=${numGpuLayers ?? 'auto'}, thinkingBudget=${thinkingBudget ?? 'unrestricted'}, baseUrl=${normalizedBaseUrl === undefined ? 'unchanged' : (normalizedBaseUrl ?? 'default')}`
          );
          try {
            setActiveModelAndContextAndParams(
              modelName,
              contextSize,
              temperature,
              topP,
              repeatPenalty,
              numGpuLayers,
              thinkingBudget,
              normalizedBaseUrl
            );
            // Fire-and-forget the model load. The handler returns
            // immediately so the UI doesn't sit on "Saving..." for the
            // full load duration (up to ~155s for remote URLs, which can
            // exceed reverse-proxy read timeouts). The 5-second
            // `GET /api/llm/status` poll reflects the loaded state once
            // the load completes.
            loadLlmModel(
              modelName,
              undefined,
              normalizedBaseUrl ?? undefined
            ).catch((err: any) => {
              console.error(
                `[API SetModel] Background model load failed for ${modelName} (baseUrl=${normalizedBaseUrl ?? 'active'}):`,
                err?.message || err
              );
            });
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
            const resultMessage = await unloadActiveModel(undefined, true);
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
        '/api-token',
        async ({ body, set }) => {
          const rawToken = body?.token;
          // Treat an empty string the same as `null` so the frontend can
          // send `{ token: '' }` to clear without needing a special
          // sentinel. Whitespace-only is also cleared by the service.
          const next: string | null =
            typeof rawToken === 'string' && rawToken.length > 0
              ? rawToken
              : null;
          setActiveApiToken(next);
          const present = hasActiveApiToken();
          set.status = 200;
          return {
            message: present
              ? 'Remote LLM API token saved.'
              : 'Remote LLM API token cleared.',
            hasRemoteApiToken: present,
          };
        },
        {
          body: 'setApiTokenBody',
          response: {
            200: 'setApiTokenResponse',
            400: t.Any(),
            500: t.Any(),
          },
          detail: {
            summary:
              'Set or clear the global API token used to authenticate against remote LLM endpoints. The token is sent as `Authorization: Bearer <token>` on every request whose base URL is non-local, and is never returned in API responses — the `hasRemoteApiToken` boolean is the only signal of its presence.',
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
          const activeBaseUrl = getActiveBaseUrl();
          const defaultBaseUrl = getDefaultBaseUrl();
          const isRemoteBaseUrl = isRemoteLlmBaseUrl(activeBaseUrl);
          // Token presence boolean (never the token value itself) so the
          // UI can render "Token is set" vs empty placeholder.
          const hasRemoteApiToken = hasActiveApiToken();
          const modelNameToCheck = query.modelName ?? currentActiveModel;
          console.log(
            `[API Status] Checking status for model: ${modelNameToCheck} (Current Active: ${currentActiveModel}, Configured Context: ${currentConfiguredContext ?? 'default'}, Temperature: ${currentConfiguredTemperature}, TopP: ${currentConfiguredTopP}, RepeatPenalty: ${currentConfiguredRepeatPenalty}, NumGpuLayers: ${currentConfiguredNumGpuLayers ?? 'auto'}, ThinkingBudget: ${currentConfiguredThinkingBudget ?? 'unrestricted'}, ActiveBaseUrl: ${activeBaseUrl}, IsRemote: ${isRemoteBaseUrl}, HasRemoteApiToken: ${hasRemoteApiToken})`
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
                activeBaseUrl,
                defaultBaseUrl,
                isRemoteBaseUrl,
                hasRemoteApiToken,
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
                activeBaseUrl,
                defaultBaseUrl,
                isRemoteBaseUrl,
                hasRemoteApiToken,
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

          // Resolve the URL for the model-architecture lookup. VRAM is a
          // local-machine concept (both UIs skip this call in Remote mode),
          // so we default to the local default URL — which also avoids
          // resolving to a sticky remote override and 404'ing on local
          // model names. The frontend passes `defaultBaseUrl` explicitly
          // for an honest, symmetric contract with `available-models`.
          const baseUrlQuery =
            typeof query.baseUrl === 'string' && query.baseUrl.trim().length > 0
              ? normalizeLlmBaseUrl(query.baseUrl.trim())
              : null;
          const models = await listModels(baseUrlQuery);
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
            baseUrl: t.Optional(t.String()),
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
