// packages/api/src/services/ollamaService.real.ts
// Contains the original, real implementation of ollamaService.ts

// --- Keep original imports for ollama, axios, crypto, etc. ---
import ollama, {
  ChatResponse,
  Message,
  ListResponse,
  ShowResponse,
  GenerateResponse,
  Message as OllamaApiMessage,
  ProgressResponse,
  PullRequest,
  ModelResponse,
} from 'ollama'; // Added ModelResponse type explicit import
import axios from 'axios';
import crypto from 'node:crypto'; // Import crypto for job ID
import config from '@therascript/config';
// --- Use imported types from central location ---
import {
  BackendChatMessage,
  OllamaModelInfo,
  OllamaPullJobStatus,
  OllamaPullJobStatusState,
  VramEstimate,
} from '@therascript/domain';
// --- End Import ---
import {
  InternalServerError,
  BadRequestError,
  ApiError,
  NotFoundError,
  ConflictError,
} from '../errors.js'; // Added ConflictError
import {
  getActiveModel,
  getConfiguredContextSize,
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
} from './activeModelService.js';
import { templateRepository } from '@therascript/data';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';
import { getOllamaRuntime } from './ollamaRuntime.js';
import {
  streamLlmChat,
  OllamaConnectionError,
  OllamaModelNotFoundError,
  OllamaTimeoutError,
} from '@therascript/services';

console.log('[Real Service] Using Real Ollama Service'); // Identify real service

const runtime = getOllamaRuntime();

const WHISPER_API_URL = process.env.WHISPER_API_URL || 'http://localhost:8000';

const MODEL_ARCHITECTURE_FALLBACKS: Record<
  string,
  {
    num_layers: number;
    num_attention_heads: number;
    num_key_value_heads: number;
    hidden_size: number;
    head_dim?: number;
    precision: number;
  }
> = {
  gemma3: {
    num_layers: 34,
    num_attention_heads: 8,
    num_key_value_heads: 4,
    hidden_size: 2560,
    head_dim: 256,
    precision: 2,
  },
};

/** CUDA/cuBLAS baseline VRAM overhead (buffers, workspace, scratchpad) */
const CUDA_OVERHEAD_BYTES = 512 * 1024 * 1024; // 512 MB

/**
 * Map quantization labels to approximate bits-per-weight.
 * Values sourced from llama.cpp GGUF spec and community benchmarks.
 */
export function getBitsPerWeight(quantizationLevel: string): number {
  const q = quantizationLevel.toUpperCase().replace(/-/g, '_');
  if (q === 'F32') return 32;
  if (q === 'F16' || q === 'BF16') return 16;
  if (q === 'Q8_0' || q === 'Q8_1') return 8.5;
  if (q === 'Q6_K') return 6.56;
  if (q === 'Q5_0' || q === 'Q5_1') return 5.0;
  if (q === 'Q5_K_S' || q === 'Q5_K_M' || q === 'Q5_K') return 5.5;
  if (q === 'Q4_0' || q === 'Q4_1') return 4.0;
  if (q === 'Q4_K_S') return 4.37;
  if (q === 'Q4_K_M' || q === 'Q4_K') return 4.5;
  if (q === 'Q3_K_S') return 3.5;
  if (q === 'Q3_K_M') return 3.91;
  if (q === 'Q3_K_L' || q === 'Q3_K') return 4.27;
  if (q === 'Q2_K' || q === 'Q2_K_S') return 2.63;
  if (q === 'IQ1_S' || q === 'IQ1_M') return 1.56;
  if (q === 'IQ2_XXS') return 2.06;
  if (q === 'IQ2_XS') return 2.31;
  if (q === 'IQ2_S' || q === 'IQ2_M') return 2.5;
  if (q === 'IQ3_XXS') return 3.06;
  if (q === 'IQ3_XS') return 3.3;
  if (q === 'IQ3_S' || q === 'IQ3_M') return 3.5;
  if (q === 'IQ4_XS') return 4.25;
  if (q === 'IQ4_NL') return 4.5;
  return 0; // unknown — signals fallback to file size
}

/**
 * Parse a parameter count string (e.g. "8B", "3.8B", "70B") into an integer count.
 * Assumes values without a suffix are in billions (appropriate for LLMs).
 * Returns null if parsing fails.
 */
export function parseParamCount(parameterSize: string): number | null {
  if (!parameterSize) return null;
  const match = parameterSize.trim().match(/^([\d.]+)\s*([KMBT]?)/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value)) return null;
  const suffix = match[2].toUpperCase();
  if (suffix === 'B' || suffix === '') return Math.round(value * 1e9);
  if (suffix === 'K') return Math.round(value * 1e3);
  if (suffix === 'M') return Math.round(value * 1e6);
  if (suffix === 'T') return Math.round(value * 1e12);
  return null;
}

/**
 * Estimate model weight memory in bytes using bits-per-weight × parameter count.
 * Falls back to the GGUF file size when either value can't be determined.
 */
function estimateWeightsBytes(model: OllamaModelInfo): number {
  const paramCount = parseParamCount(model.details.parameter_size);
  const bitsPerWeight = getBitsPerWeight(model.details.quantization_level);
  if (paramCount !== null && bitsPerWeight > 0) {
    const bytes = Math.round((paramCount * bitsPerWeight) / 8);
    console.log(
      `[OllamaService] Weight estimate for ${model.name}: ${(paramCount / 1e9).toFixed(1)}B params × ${bitsPerWeight} bpw = ${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    );
    return bytes;
  }
  console.log(
    `[OllamaService] Falling back to file size for ${model.name} weights (quant="${model.details.quantization_level}", params="${model.details.parameter_size}")`
  );
  return model.size;
}

function getArchitectureFallback(modelName: string): {
  num_layers: number;
  num_attention_heads: number;
  num_key_value_heads: number;
  hidden_size: number;
  head_dim?: number;
  precision: number;
} | null {
  const lowerName = modelName.toLowerCase();
  for (const [key, arch] of Object.entries(MODEL_ARCHITECTURE_FALLBACKS)) {
    if (lowerName.includes(key)) {
      console.log(
        `[OllamaService] Using fallback architecture for ${modelName} (matched: ${key})`
      );
      return { ...arch };
    }
  }
  return null;
}

function extractArchitecture(
  showResponse: ShowResponse,
  modelName: string
): {
  num_layers?: number;
  num_attention_heads?: number;
  num_key_value_heads?: number;
  hidden_size?: number;
  head_dim?: number;
  precision: number;
} | null {
  if (!showResponse.model_info || typeof showResponse.model_info !== 'object') {
    return null;
  }

  const info =
    showResponse.model_info instanceof Map
      ? Object.fromEntries(showResponse.model_info.entries())
      : showResponse.model_info;

  const architecture: any = {};
  const keys = Object.keys(info);

  for (const key of keys) {
    // Layers
    if (key.includes('num_layers') || key.includes('block_count'))
      architecture.num_layers = info[key];
    // Attention Heads (Query)
    if (
      key.includes('num_attention_heads') ||
      (key.includes('attention.head_count') && !key.includes('_kv'))
    )
      architecture.num_attention_heads = info[key];
    // KV Heads
    if (
      key.includes('num_key_value_heads') ||
      key.includes('attention.head_count_kv')
    )
      architecture.num_key_value_heads = info[key];
    // Hidden Size
    if (key.includes('hidden_size') || key.includes('embedding_length'))
      architecture.hidden_size = info[key];
    // Explicit Head Dimension
    if (key.includes('attention.key_length')) architecture.head_dim = info[key];
  }

  architecture.precision = 2;

  if (Object.keys(architecture).length <= 1) {
    return getArchitectureFallback(modelName);
  }

  return architecture;
}

async function ensureWhisperUnloaded(): Promise<void> {
  try {
    console.log(
      '[OllamaService] Requesting Whisper model unload before Ollama load...'
    );
    const response = await axios.post(
      `${WHISPER_API_URL}/model/unload`,
      {},
      { timeout: 10000 }
    );
    console.log(
      `[OllamaService] Whisper unload result: ${response.data.message}`
    );
  } catch (error: any) {
    console.warn(
      `[OllamaService] Could not unload Whisper model: ${error.message}`
    );
  }
}

async function isOllamaApiResponsive(): Promise<boolean> {
  try {
    await axios.get(config.ollama.baseURL, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

export async function ensureOllamaReady(timeoutMs = 30000): Promise<void> {
  console.log(
    `[Real OllamaService] Ensuring Ollama runtime (${runtime.type}) is ready...`
  );
  await runtime.ensureReady(timeoutMs);
  if (!(await isOllamaApiResponsive())) {
    throw new InternalServerError(
      `Ollama runtime (${runtime.type}) failed health check after startup.`
    );
  }
}

// --- ADDED ---
/**
 * Checks if the Ollama API is reachable and responsive.
 * @returns {Promise<boolean>} True if the service is healthy, false otherwise.
 */
export const checkOllamaApiHealth = async (): Promise<boolean> => {
  return isOllamaApiResponsive();
};
// --- END ADDED ---

// Helper to get system prompts from DB with fallback
const getSystemPrompt = (
  title: 'system_prompt' | 'system_standalone_prompt'
): string => {
  const template = templateRepository.findByTitle(title);
  if (template) {
    return template.text;
  }
  console.warn(
    `[OllamaService] System template "${title}" not found in DB. Using hardcoded fallback.`
  );
  if (title === 'system_prompt') {
    return SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT.text;
  }
  // 'system_standalone_prompt'
  return SYSTEM_PROMPT_TEMPLATES.STANDALONE_CHAT.text;
};

// --- Keep original Pull Job Status store ---
// Make sure the type annotation uses the imported type
const activePullJobs = new Map<string, OllamaPullJobStatus>();
const pullJobCancellationFlags = new Map<string, boolean>();

// --- *** UPDATED FUNCTION *** ---
// Helper to fetch model details and parse context size and architecture
async function _fetchModelMetadata(
  modelName: string
): Promise<{ contextSize: number | null; architecture: any }> {
  try {
    const showResponse: ShowResponse = await ollama.show({ model: modelName });

    // Extract context size (existing logic)
    let contextSize: number | null = null;

    // NEW: Prioritize the structured `model_info` object from newer library versions
    if (
      showResponse.model_info &&
      typeof showResponse.model_info === 'object'
    ) {
      // Handle both Map and object types for model_info
      let contextLengthKey: string | undefined;
      let contextLength: number | undefined;

      if (showResponse.model_info instanceof Map) {
        // Handle Map type
        for (const [key, value] of showResponse.model_info.entries()) {
          if (typeof key === 'string' && key.endsWith('.context_length')) {
            contextLengthKey = key;
            contextLength = typeof value === 'number' ? value : undefined;
            break;
          }
        }
      } else {
        // Handle object type
        contextLengthKey = Object.keys(showResponse.model_info).find((key) =>
          key.endsWith('.context_length')
        );
        if (contextLengthKey) {
          contextLength = showResponse.model_info[contextLengthKey];
        }
      }

      if (
        contextLengthKey &&
        typeof contextLength === 'number' &&
        contextLength > 0
      ) {
        console.log(
          `[Real OllamaService] Parsed default context size (${contextLengthKey}) ${contextLength} for model ${modelName}`
        );
        contextSize = contextLength;
      }
    }

    // OLD FALLBACK: Check the `parameters` string for 'num_ctx' for older library versions
    if (contextSize === null && showResponse.parameters) {
      const parametersString = showResponse.parameters;
      const lines = parametersString.split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length > 1 && parts[0].toLowerCase() === 'num_ctx') {
          const numCtx = parseInt(parts[1], 10);
          if (!isNaN(numCtx) && numCtx > 0) {
            console.log(
              `[Real OllamaService] Parsed default context size (num_ctx) ${numCtx} for model ${modelName}`
            );
            contextSize = numCtx;
            break;
          }
        }
      }
    }

    // If neither method found a context size, log it.
    if (contextSize === null) {
      console.log(
        `[Real OllamaService] Could not find a default context size parameter for model ${modelName}. Ollama will use its own default.`
      );
    }

    // Extract architecture metadata (NEW)
    const architecture = extractArchitecture(showResponse, modelName);

    return { contextSize, architecture };
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error fetching details for ${modelName}:`,
      error.message || error
    );
    return { contextSize: null, architecture: null };
  }
}
// --- *** END UPDATED FUNCTION *** ---

/**
 * Estimate VRAM and RAM usage for a model at a specific context size.
 *
 * @param model - Model information with architecture metadata
 * @param contextSize - Context window size in tokens
 * @param numGpuLayers - Number of transformer layers to place on GPU. null/undefined =
 *   let Ollama decide (we assume all layers on GPU for the estimate). 0 = CPU only.
 * @returns Breakdown of VRAM and RAM in bytes, or null if metadata is insufficient
 */
export function estimateVramUsage(
  model: OllamaModelInfo,
  contextSize: number,
  numGpuLayers?: number | null
): VramEstimate | null {
  if (!model.size || !model.architecture || !contextSize) {
    return null;
  }

  const {
    num_layers,
    num_attention_heads,
    num_key_value_heads,
    hidden_size,
    head_dim: explicit_head_dim,
    precision,
  } = model.architecture;

  if (!num_layers || !num_attention_heads || !hidden_size || !precision) {
    return null;
  }

  const kv_heads = num_key_value_heads || num_attention_heads;
  const head_dim = explicit_head_dim ?? hidden_size / num_attention_heads;
  const kv_cache_bytes =
    2 * num_layers * kv_heads * head_dim * precision * contextSize;

  const weights_bytes = estimateWeightsBytes(model);

  // Determine how many layers land on GPU
  const gpu_layers =
    numGpuLayers != null && numGpuLayers >= 0
      ? Math.min(numGpuLayers, num_layers)
      : num_layers; // default: assume all layers on GPU
  const gpu_ratio = gpu_layers / num_layers;

  const overhead_bytes = gpu_ratio > 0 ? CUDA_OVERHEAD_BYTES : 0;
  const weights_vram = Math.round(weights_bytes * gpu_ratio);
  const weights_ram = weights_bytes - weights_vram;

  return {
    vram_bytes: weights_vram + kv_cache_bytes + overhead_bytes,
    ram_bytes: weights_ram,
    weights_bytes,
    kv_cache_bytes,
    overhead_bytes,
  };
}

export function getVramPerToken(model: OllamaModelInfo): number | null {
  if (!model.architecture) return null;

  const {
    num_layers,
    num_attention_heads,
    num_key_value_heads,
    hidden_size,
    head_dim: explicit_head_dim,
    precision,
  } = model.architecture;

  if (!num_layers || !num_attention_heads || !hidden_size || !precision) {
    return null;
  }

  const kv_heads = num_key_value_heads || num_attention_heads;
  const head_dim = explicit_head_dim ?? hidden_size / num_attention_heads;

  return 2 * num_layers * kv_heads * head_dim * precision;
}

// --- MODIFIED: listModels to include defaultContextSize ---
export const listModels = async (): Promise<OllamaModelInfo[]> => {
  console.log(`[Real OllamaService] Request to list available models...`);
  try {
    await ensureOllamaReady();
    console.log(
      `[Real OllamaService] Ollama ready. Fetching models from ${config.ollama.baseURL}/api/tags`
    );
    const response: ListResponse = await ollama.list();

    const modelsWithDetails: OllamaModelInfo[] = await Promise.all(
      response.models.map(
        async (model: ModelResponse): Promise<OllamaModelInfo> => {
          const modifiedAtDate =
            typeof model.modified_at === 'string'
              ? new Date(model.modified_at)
              : (model.modified_at ?? new Date(0));
          const expiresAtDate =
            typeof model.expires_at === 'string'
              ? new Date(model.expires_at)
              : (model.expires_at ?? undefined);

          // Fetch metadata for each model
          const { contextSize: defaultCtxSize, architecture } =
            await _fetchModelMetadata(model.name);

          return {
            name: model.name,
            modified_at: modifiedAtDate,
            size: model.size,
            digest: model.digest,
            details: {
              format: model.details.format,
              family: model.details.family,
              families: model.details.families,
              parameter_size: model.details.parameter_size,
              quantization_level: model.details.quantization_level,
            },
            defaultContextSize: defaultCtxSize,
            size_vram: model.size_vram,
            expires_at: expiresAtDate,
            architecture: architecture,
          };
        }
      )
    );
    return modelsWithDetails;
  } catch (error: any) {
    console.error(
      '[Real OllamaService] Error fetching available models:',
      error
    );
    if (error.message?.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused after readiness check: Could not connect to Ollama at ${config.ollama.baseURL} to list models.`
      );
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      'Failed to list models from Ollama service after readiness check.',
      error instanceof Error ? error : new Error(String(error))
    );
  }
};
// --- END MODIFIED listModels ---

// --- Keep original Parse Ollama Pull Stream Chunk ---
function parseOllamaPullStreamChunk(
  chunk: ProgressResponse
): Partial<OllamaPullJobStatus> {
  let percentage: number | undefined = undefined;
  if (chunk.total && chunk.completed) {
    percentage = Math.round((chunk.completed / chunk.total) * 100);
  }
  let internalStatus: OllamaPullJobStatusState = 'downloading'; // Use imported state type
  const message = chunk.status;
  if (message.includes('pulling manifest')) internalStatus = 'parsing';
  else if (message.includes('verifying sha256 digest'))
    internalStatus = 'verifying';
  else if (message.includes('writing manifest')) internalStatus = 'verifying';
  else if (message.includes('removing any unused layers'))
    internalStatus = 'verifying';
  else if (message.toLowerCase().includes('success'))
    internalStatus = 'completed';
  else if (message.toLowerCase().includes('error')) internalStatus = 'failed';
  const currentLayer = chunk.digest ? chunk.digest.substring(7, 19) : undefined;
  return {
    status: internalStatus,
    message: message,
    progress: percentage,
    completedBytes: chunk.completed,
    totalBytes: chunk.total,
    currentLayer: currentLayer,
    ...(internalStatus === 'failed' && { error: message }),
  };
}

// --- Keep original Background Pull Task Runner ---
async function runPullInBackground(jobId: string, modelName: string) {
  console.log(
    `[Real OllamaBG ${jobId}] Starting background pull for ${modelName}`
  );
  const jobStartTime = Date.now();
  // Ensure the job status type is correct here
  activePullJobs.set(jobId, {
    jobId,
    modelName,
    status: 'queued',
    message: 'Pull queued',
    startTime: jobStartTime,
  });
  pullJobCancellationFlags.set(jobId, false);
  try {
    await ensureOllamaReady();
    const stream = await ollama.pull({ model: modelName, stream: true });
    activePullJobs.set(jobId, {
      ...activePullJobs.get(jobId)!,
      status: 'parsing',
      message: 'Pulling manifest...',
    });
    for await (const chunk of stream) {
      if (pullJobCancellationFlags.get(jobId)) {
        console.log(
          `[Real OllamaBG ${jobId}] Cancellation requested, stopping pull for ${modelName}.`
        );
        activePullJobs.set(jobId, {
          ...activePullJobs.get(jobId)!,
          status: 'canceled',
          message: 'Pull canceled by user.',
          endTime: Date.now(),
        });
        return;
      }
      const progressUpdate = parseOllamaPullStreamChunk(chunk);
      const currentStatus = activePullJobs.get(jobId);
      if (currentStatus && !pullJobCancellationFlags.get(jobId)) {
        // Ensure status update uses correct type
        activePullJobs.set(jobId, {
          ...currentStatus,
          ...progressUpdate,
          status: progressUpdate.status || currentStatus.status,
          message: progressUpdate.message || currentStatus.message,
          progress: progressUpdate.progress ?? currentStatus.progress,
          error: progressUpdate.error ?? currentStatus.error,
        });
      } else if (!currentStatus) {
        console.warn(
          `[Real OllamaBG ${jobId}] Job status not found during update for ${modelName}. Stopping task.`
        );
        return;
      }
      if (
        progressUpdate.status === 'completed' ||
        progressUpdate.status === 'failed'
      ) {
        console.log(
          `[Real OllamaBG ${jobId}] Terminal status '${progressUpdate.status}' detected from chunk for ${modelName}.`
        );
        activePullJobs.set(jobId, {
          ...activePullJobs.get(jobId)!,
          endTime: Date.now(),
        });
        break;
      }
    }
    const finalStatus = activePullJobs.get(jobId);
    if (
      finalStatus &&
      finalStatus.status !== 'failed' &&
      finalStatus.status !== 'completed' &&
      finalStatus.status !== 'canceled' &&
      finalStatus.status !== 'canceling'
    ) {
      console.log(
        `[Real OllamaBG ${jobId}] Stream ended normally, marking job as completed for ${modelName}.`
      );
      activePullJobs.set(jobId, {
        ...finalStatus,
        status: 'completed',
        message: 'Pull finished successfully.',
        progress: 100,
        endTime: Date.now(),
      });
    } else if (finalStatus) {
      console.log(
        `[Real OllamaBG ${jobId}] Stream ended, job already had terminal status: ${finalStatus.status}`
      );
      if (!finalStatus.endTime) {
        activePullJobs.set(jobId, { ...finalStatus, endTime: Date.now() });
      }
    }
  } catch (error: any) {
    console.error(
      `[Real OllamaBG ${jobId}] Error during background pull for ${modelName}:`,
      error
    );
    const finalStatus = activePullJobs.get(jobId);
    // Ensure status update uses correct type
    activePullJobs.set(jobId, {
      ...(finalStatus ?? {
        jobId,
        modelName,
        status: 'failed' as OllamaPullJobStatusState,
        message: 'Pull failed',
        startTime: jobStartTime,
      }),
      status: 'failed',
      error: error.message || 'Unknown error during pull',
      message: `Pull failed: ${error.message || 'Unknown'}`,
      endTime: Date.now(),
    });
  } finally {
    pullJobCancellationFlags.delete(jobId);
    console.log(
      `[Real OllamaBG ${jobId}] Background pull task finished for ${modelName}. Final status: ${activePullJobs.get(jobId)?.status}`
    );
  }
}

// --- Keep original Start Pull Model Job ---
export const startPullModelJob = (modelName: string): string => {
  if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
    throw new BadRequestError('Invalid model name provided.');
  }
  const jobId = crypto.randomUUID();
  console.log(
    `[Real OllamaService] Queuing pull job ${jobId} for model: ${modelName}`
  );
  void runPullInBackground(jobId, modelName).catch((err) => {
    console.error(
      `[Real OllamaService] CRITICAL: Uncaught error escaped background pull job ${jobId} for ${modelName}:`,
      err
    );
    const currentStatus = activePullJobs.get(jobId);
    if (
      currentStatus &&
      currentStatus.status !== 'completed' &&
      currentStatus.status !== 'failed' &&
      currentStatus.status !== 'canceled'
    ) {
      activePullJobs.set(jobId, {
        ...currentStatus,
        status: 'failed',
        error: 'Background task crashed unexpectedly',
        message: 'Background task crashed',
        endTime: Date.now(),
      });
    }
  });
  return jobId;
};

// --- Keep original Get Pull Model Job Status ---
// Ensure return type uses the imported type
export const getPullModelJobStatus = (
  jobId: string
): OllamaPullJobStatus | null => {
  const status = activePullJobs.get(jobId);
  if (config.server.isProduction) {
    console.log(
      `[Real OllamaService] Getting status for job ${jobId}. Found: ${!!status}`
    );
  } else {
    console.log(
      `[Real OllamaService] Getting status for job ${jobId}. Status:`,
      status
    );
  }
  return status ? { ...status } : null; // Return copy or null
};

// --- Keep original Cancel Pull Model Job ---
export const cancelPullModelJob = (jobId: string): boolean => {
  const job = activePullJobs.get(jobId);
  if (!job) {
    console.log(
      `[Real OllamaService] Cancel request for non-existent job ${jobId}`
    );
    return false;
  }
  if (
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'canceled' ||
    job.status === 'canceling'
  ) {
    console.log(
      `[Real OllamaService] Job ${jobId} is already in state (${job.status}), cannot cancel.`
    );
    return false;
  }
  console.log(
    `[Real OllamaService] Setting cancellation flag for job ${jobId}`
  );
  pullJobCancellationFlags.set(jobId, true);
  // Ensure status update uses correct type
  activePullJobs.set(jobId, {
    ...job,
    status: 'canceling',
    message: 'Cancellation requested...',
  });
  return true;
};

// --- Keep original Delete Ollama Model Service Function ---
export const deleteOllamaModel = async (modelName: string): Promise<string> => {
  if (!modelName || typeof modelName !== 'string' || !modelName.trim()) {
    throw new BadRequestError('Invalid model name provided for deletion.');
  }
  console.log(`[Real OllamaService] Request to delete model '${modelName}'...`);

  // 1. Ensure Ollama service is running
  try {
    await ensureOllamaReady();
  } catch (error) {
    throw error;
  }

  // 2. Check if the model is currently loaded
  const loadedStatus = await checkModelStatus(modelName);
  if (
    loadedStatus &&
    typeof loadedStatus === 'object' &&
    'name' in loadedStatus
  ) {
    console.warn(
      `[Real OllamaService] Attempting to delete model '${modelName}' which appears to be currently loaded.`
    );
    // --- FIX: Unload before deleting ---
    console.log(
      `[Real OllamaService] Attempting to unload model '${modelName}' before deletion...`
    );
    try {
      await unloadActiveModel(modelName); // Attempt to unload it first
    } catch (unloadError) {
      console.warn(
        `[Real OllamaService] Failed to explicitly unload model '${modelName}' before delete (will proceed anyway):`,
        unloadError
      );
    }
    // --- END FIX ---
  } else if (loadedStatus === null) {
    console.log(
      `[Real OllamaService] Model '${modelName}' confirmed not loaded.`
    );
  } else if (loadedStatus?.status === 'unavailable') {
    throw new InternalServerError(
      'Ollama service became unavailable after readiness check.'
    );
  }

  // 3. Execute the delete command
  try {
    console.log(
      `[Real OllamaService] Executing delete command for '${modelName}'...`
    );
    const deleteOutput = await runtime.deleteModel(modelName);
    console.log(
      `[Real OllamaService] Delete command output for '${modelName}':`,
      deleteOutput
    );
    const normalizedOutput = deleteOutput.toLowerCase();
    if (!normalizedOutput.length) {
      console.log(
        `[Real OllamaService] Delete command returned no output; assuming success for '${modelName}'.`
      );
      return `Model '${modelName}' deleted successfully.`;
    }
    if (
      normalizedOutput.includes('deleted') ||
      normalizedOutput.includes('removed')
    ) {
      return `Model '${modelName}' deleted successfully.`;
    } else if (normalizedOutput.includes('not found')) {
      console.warn(
        `[Real OllamaService] Model '${modelName}' not found during delete attempt.`
      );
      throw new NotFoundError(`Model '${modelName}' not found locally.`);
    } else {
      console.error(
        `[Real OllamaService] Unknown response from 'ollama rm ${modelName}': ${deleteOutput}`
      );
      throw new InternalServerError(
        `Failed to delete model '${modelName}'. Output: ${deleteOutput}`
      );
    }
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error executing delete command for '${modelName}':`,
      error
    );
    if (error instanceof NotFoundError) {
      throw new NotFoundError(`Model '${modelName}' not found locally.`);
    }
    if (error instanceof ApiError) throw error;
    throw new InternalServerError(
      `Failed to execute delete command for model '${modelName}'.`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
};

// --- MODIFIED: checkModelStatus to include defaultContextSize ---
export const checkModelStatus = async (
  modelToCheck: string
): Promise<OllamaModelInfo | null | { status: 'unavailable' }> => {
  console.log(
    `[Real OllamaService] Checking if specific model '${modelToCheck}' is loaded...`
  );
  try {
    await ensureOllamaReady();
    const response = await ollama.ps();
    const loadedModelEntry = response.models.find(
      (model: any) => model.name === modelToCheck
    );

    if (loadedModelEntry) {
      console.log(
        `[Real OllamaService] Specific model '${modelToCheck}' found loaded.`
      );
      const modifiedAtDate = loadedModelEntry.modified_at
        ? new Date(loadedModelEntry.modified_at)
        : new Date(0);
      const expiresAtDate = loadedModelEntry.expires_at
        ? new Date(loadedModelEntry.expires_at)
        : undefined;

      // Fetch metadata for the loaded model
      const { contextSize: defaultCtxSize, architecture } =
        await _fetchModelMetadata(modelToCheck);

      return {
        name: loadedModelEntry.name,
        modified_at: modifiedAtDate,
        size: loadedModelEntry.size ?? 0,
        digest: loadedModelEntry.digest,
        details: loadedModelEntry.details ?? {
          format: 'unknown',
          family: 'unknown',
          families: null,
          parameter_size: 'unknown',
          quantization_level: 'unknown',
        },
        defaultContextSize: defaultCtxSize,
        size_vram: loadedModelEntry.size_vram,
        expires_at: expiresAtDate,
        architecture: architecture,
      };
    } else {
      console.log(
        `[Real OllamaService] Specific model '${modelToCheck}' not found among loaded models:`,
        response.models.map((m: any) => m.name)
      );
      return null;
    }
  } catch (error: any) {
    console.warn(
      `[Real OllamaService] Error checking status for specific model '${modelToCheck}':`,
      error.message
    );
    if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
      console.warn(
        `[Real OllamaService] Connection refused. Ollama service appears to be unavailable.`
      );
      return { status: 'unavailable' };
    }
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.warn(
        `[Real OllamaService] Connection refused (ollama lib). Ollama service appears to be unavailable.`
      );
      return { status: 'unavailable' };
    }
    console.log(
      `[Real OllamaService] Assuming specific model '${modelToCheck}' is not loaded due to other error.`
    );
    return null;
  }
};
// --- END MODIFIED checkModelStatus ---

// --- Keep original Load Model Function ---
export const loadOllamaModel = async (modelName: string): Promise<void> => {
  if (!modelName) {
    throw new BadRequestError('Model name must be provided to load.');
  }
  console.log(`[Real OllamaService] Request to load model '${modelName}'...`);

  await ensureWhisperUnloaded();

  try {
    await ensureOllamaReady();
    console.log(
      `[Real OllamaService] Ollama service is ready. Proceeding with load trigger for '${modelName}'.`
    );
  } catch (error) {
    throw error;
  }
  // Use /api/generate with an empty prompt so Ollama loads the model into memory
  // without running any inference. This is significantly faster than sending a
  // real chat message (especially on CPU/Metal) since no tokens are generated.
  console.log(
    `[Real OllamaService] Triggering load for model '${modelName}' using a no-op generate request...`
  );
  try {
    const numGpuLayers = getConfiguredNumGpuLayers();
    const body: Record<string, any> = {
      model: modelName,
      prompt: '',
      keep_alive: config.ollama.keepAlive,
    };
    if (numGpuLayers !== null) {
      body.options = { num_gpu: numGpuLayers };
    }
    await axios.post(`${config.ollama.baseURL}/api/generate`, body, {
      timeout: 300000, // 5 min — large models on CUDA can take >60s to load into VRAM
    });
    console.log(
      `[Real OllamaService] No-op generate completed for '${modelName}'. Model is now loaded.`
    );
  } catch (error: any) {
    console.error(
      `[Real OllamaService] Error during load trigger for '${modelName}':`,
      error
    );
    const msg: string = error?.response?.data?.error ?? error?.message ?? '';
    if (
      error?.response?.status === 404 ||
      (msg.includes('model') &&
        (msg.includes('not found') || msg.includes('missing')))
    ) {
      throw new BadRequestError(
        `Model '${modelName}' not found locally. Please pull the model first.`
      );
    }
    if (msg.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused: Could not connect to Ollama at ${config.ollama.baseURL} to load model.`
      );
    }
    throw new InternalServerError(
      `Failed to trigger load for model '${modelName}'.`,
      error instanceof Error ? error : undefined
    );
  }
};

// --- MODIFIED: unloadActiveModel to check before acting ---
/**
 * Sends a request to Ollama to unload the specified model (or the currently active one if none specified).
 * Checks if the model is loaded first to prevent accidentally loading it.
 * @param modelToUnloadOverride Optional specific model name to unload. Defaults to the active model.
 * @returns A promise resolving to a success message.
 * @throws {ApiError} If the unload request fails.
 */
export const unloadActiveModel = async (
  modelToUnloadOverride?: string
): Promise<string> => {
  const modelToUnload = modelToUnloadOverride || getActiveModel();
  if (!modelToUnload) {
    const msg = `No active model set, no unload action taken.`;
    console.log(`[Real OllamaService:unload] ${msg}`);
    return msg;
  }

  console.log(
    `[Real OllamaService:unload] Unload requested for model: ${modelToUnload}`
  );

  try {
    await ensureOllamaReady(); // Ensure service is reachable first

    // Check if the model is actually loaded.
    const loadedStatus = await checkModelStatus(modelToUnload);

    // `loadedStatus` is an object with model details if loaded, `null` if not, or `{ status: 'unavailable' }` if API is down.
    if (loadedStatus && 'name' in loadedStatus) {
      console.log(
        `[Real OllamaService:unload] Model '${modelToUnload}' is currently loaded. Sending unload request (keep_alive: 0)...`
      );

      // Use /api/generate with no prompt so Ollama skips inference entirely and
      // immediately evicts the model due to keep_alive: 0. Using ollama.chat()
      // with a message would force token generation first, which is extremely
      // slow on CPU-only or Apple Silicon Metal models (minutes for a 12B model).
      await axios.post(
        `${config.ollama.baseURL}/api/generate`,
        { model: modelToUnload, keep_alive: 0 },
        { timeout: 10000 }
      );

      // Wait until the model is actually unloaded by polling checkModelStatus
      console.log(
        `[Real OllamaService:unload] Waiting for model '${modelToUnload}' to unload...`
      );
      let isLoaded = true;
      let attempts = 0;
      const maxAttempts = 20; // 20 * 500ms = 10 seconds timeout

      while (isLoaded && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const currentStatus = await checkModelStatus(modelToUnload);
        // If it's unavailable or null, consider it unloaded.
        // If it's an object with a name, it's still loaded.
        isLoaded = !!(currentStatus && 'name' in currentStatus);
        attempts++;
      }

      if (isLoaded) {
        console.warn(
          `[Real OllamaService:unload] Model '${modelToUnload}' still appears loaded after waiting.`
        );
      } else {
        console.log(
          `[Real OllamaService:unload] Model '${modelToUnload}' successfully unloaded.`
        );
      }

      console.log(
        `[Real OllamaService:unload] Unload request sent and processed successfully for ${modelToUnload}.`
      );
      return `Model ${modelToUnload} unloaded successfully.`;
    } else {
      // If the model is not loaded, do nothing that would cause it to load.
      const msg = `Model '${modelToUnload}' is not currently loaded. No unload action necessary.`;
      console.log(`[Real OllamaService:unload] ${msg}`);
      return msg;
    }
  } catch (error: any) {
    console.error(
      `[Real OllamaService:unload] Error during unload process for ${modelToUnload}:`,
      error
    );

    const isModelNotFoundError =
      error.status === 404 ||
      (error.message?.includes('model') &&
        (error.message?.includes('not found') ||
          error.message?.includes('missing')));

    if (isModelNotFoundError) {
      const msg = `Model '${modelToUnload}' not found on server while attempting unload (this is okay).`;
      console.log(`[Real OllamaService:unload] ${msg}`);
      return msg;
    }

    const isConnectionError =
      (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
      error.message?.includes('ECONNREFUSED');
    if (isConnectionError) {
      const msg = `Could not connect to Ollama to unload ${modelToUnload}. Assuming it's already stopped.`;
      console.warn(`[Real OllamaService:unload] ${msg}`);
      return msg;
    }

    // For other errors, re-throw a standard server error.
    throw new InternalServerError(
      `Failed to send unload request to Ollama for model ${modelToUnload}.`,
      error instanceof Error ? error : undefined
    );
  }
};

// --- Keep original Reload Active Model Context Function ---
export const reloadActiveModelContext = async (): Promise<void> => {
  const modelName = getActiveModel();
  if (!modelName) {
    console.warn(
      '[Real OllamaService:reload] No active model set. Skipping reload.'
    );
    return;
  }
  console.log(
    `[Real OllamaService:reload] Attempting to reload context for active model: ${modelName}`
  );
  try {
    await ensureOllamaReady();
  } catch (error) {
    console.error(
      `[Real OllamaService:reload] Ollama not ready, cannot reload model ${modelName}:`,
      error
    );
    throw error; // Propagate readiness error
  }

  // 1. Attempt Unload (keep_alive: 0) - Use the new unload function
  try {
    await unloadActiveModel(modelName); // Call the specific unload function
  } catch (unloadError: any) {
    // Check if the error message indicates it was already unloaded
    if (
      unloadError instanceof ApiError &&
      unloadError.message.includes('already unloaded')
    ) {
      console.log(
        `[Real OllamaService:reload] Model ${modelName} reported as already unloaded. Proceeding to load.`
      );
    } else if (
      unloadError instanceof InternalServerError &&
      unloadError.message.includes('Connection refused')
    ) {
      console.error(
        `[Real OllamaService:reload] Connection refused during unload for ${modelName}.`
      );
      throw unloadError; // Re-throw connection error
    } else {
      console.warn(
        `[Real OllamaService:reload] Error during unload request for ${modelName} (will still attempt load):`,
        unloadError
      );
      // Don't throw other unload errors, proceed to load attempt
    }
  }

  // 2. Trigger Load (keep_alive: configured duration)
  try {
    console.log(
      `[Real OllamaService:reload] Sending load request (keep_alive: ${config.ollama.keepAlive}) for ${modelName}...`
    );
    await ollama.chat({
      model: modelName,
      messages: [{ role: 'user', content: 'load' }], // Minimal message
      stream: false,
      keep_alive: config.ollama.keepAlive, // Use configured duration
    });
    console.log(
      `[Real OllamaService:reload] Load request sent successfully for ${modelName}.`
    );
  } catch (loadError: any) {
    console.error(
      `[Real OllamaService:reload] Error during load request for ${modelName}:`,
      loadError
    );
    const isModelNotFoundError =
      loadError.status === 404 ||
      (loadError.message?.includes('model') &&
        (loadError.message?.includes('not found') ||
          loadError.message?.includes('missing')));
    if (isModelNotFoundError) {
      console.error(
        `[Real OllamaService:reload] Model '${modelName}' not found locally during load attempt.`
      );
      throw new BadRequestError(
        `Model '${modelName}' not found locally. Cannot reload.`
      );
    }
    if (loadError.message?.includes('ECONNREFUSED')) {
      throw new InternalServerError(
        `Connection refused during load attempt for ${modelName}.`
      );
    }
    throw new InternalServerError(
      `Failed to trigger reload for model '${modelName}' via chat request.`,
      loadError instanceof Error ? loadError : undefined
    );
  }
  console.log(
    `[Real OllamaService:reload] Context reload sequence completed for ${modelName}.`
  );
};

// --- MODIFIED: Stream Chat Response to accept options and handle system prompts ---
export const streamChatResponse = async (
  contextTranscript: string | null,
  chatHistory: BackendChatMessage[],
  options?: {
    model?: string;
    contextSize?: number;
    signal?: AbortSignal;
    temperature?: number;
    topP?: number;
    repeatPenalty?: number;
    timeoutMs?: number;
  }
): Promise<AsyncIterable<ChatResponse>> => {
  const modelToUse = options?.model || getActiveModel();
  const contextSize =
    options?.contextSize !== undefined
      ? options.contextSize
      : getConfiguredContextSize();

  const isStandalone = contextTranscript === null;
  console.log(
    `[Real OllamaService:streamChatResponse] Attempting stream with MODEL: ${modelToUse}, Context Size: ${contextSize ?? 'default'}`
  );

  try {
    await ensureOllamaReady();
  } catch (error) {
    throw error;
  }

  if (!chatHistory || chatHistory.length === 0)
    throw new InternalServerError(
      'Internal Error: Cannot stream response without chat history.'
    );

  // --- MODIFICATION START ---
  const hasSystemPrompt = chatHistory.some((msg) => msg.sender === 'system');
  const messages: BackendChatMessage[] = [];

  const mapSenderToRole = (
    sender: 'user' | 'ai' | 'system'
  ): 'user' | 'assistant' | 'system' => {
    if (sender === 'ai') return 'assistant';
    return sender;
  };

  if (hasSystemPrompt) {
    // New behavior for analysis jobs: Trust the provided message array completely
    chatHistory.forEach((msg) => {
      messages.push({
        id: msg.id,
        chatId: msg.chatId,
        sender: msg.sender,
        text: msg.text,
        timestamp: msg.timestamp,
      });
    });
  } else {
    // Original behavior for interactive chat
    if (chatHistory[chatHistory.length - 1].sender !== 'user') {
      throw new InternalServerError(
        'Internal Error: Malformed chat history for LLM.'
      );
    }
    const latestUserMessage = chatHistory[chatHistory.length - 1];
    const previousHistory = chatHistory.slice(0, -1);

    const systemPromptContent = isStandalone
      ? getSystemPrompt('system_standalone_prompt')
      : getSystemPrompt('system_prompt');

    messages.push({
      id: 0,
      chatId: 0,
      sender: 'system',
      text: systemPromptContent,
      timestamp: Date.now(),
    });

    messages.push(...previousHistory);

    if (!isStandalone) {
      const transcriptContextMessage: BackendChatMessage = {
        id: 0,
        chatId: 0,
        sender: 'user',
        text: `CONTEXT TRANSCRIPT:\n"""\n${contextTranscript || 'No transcript available.'}\n"""`,
        timestamp: Date.now(),
      };
      messages.push(transcriptContextMessage);
    }

    messages.push(latestUserMessage);
  }
  // --- MODIFICATION END ---

  console.log(
    `[Real OllamaService] Streaming response (model: ${modelToUse})...`
  );

  // Convert AsyncGenerator<string, StreamResult> to AsyncIterable<ChatResponse>
  async function* convertToChatResponse(): AsyncIterable<ChatResponse> {
    try {
      const temperature = options?.temperature ?? getConfiguredTemperature();
      const topP = options?.topP ?? getConfiguredTopP();
      const repeatPenalty =
        options?.repeatPenalty ?? getConfiguredRepeatPenalty();

      const streamGenerator = streamLlmChat(messages, {
        model: modelToUse,
        contextSize: contextSize ?? undefined,
        temperature,
        topP,
        repeatPenalty,
        numGpuLayers: getConfiguredNumGpuLayers() ?? undefined,
        abortSignal: options?.signal,
        ollamaBaseUrl: config.ollama.baseURL,
        timeoutMs:
          options?.timeoutMs ?? (config.ollama as any).timeoutMs ?? 600000,
      });

      let result = await streamGenerator.next();

      while (!result.done) {
        yield {
          message: {
            role: 'assistant',
            content: result.value,
          },
          done: false,
          model: modelToUse,
          created_at: new Date(),
        } as ChatResponse;
        result = await streamGenerator.next();
      }

      yield {
        message: {
          role: 'assistant',
          content: '',
        },
        done: true,
        model: modelToUse,
        created_at: new Date(),
        prompt_eval_count: result.value.promptTokens || 0,
        eval_count: result.value.completionTokens || 0,
      } as ChatResponse;
    } catch (error: any) {
      console.error('[Real OllamaService] Error during stream:', error);

      if (error instanceof OllamaModelNotFoundError) {
        throw new BadRequestError(error.message);
      }

      if (error instanceof OllamaConnectionError) {
        throw new InternalServerError(
          `Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`
        );
      }

      if (error instanceof OllamaTimeoutError) {
        throw new InternalServerError(error.message);
      }

      const connectionError =
        (error as NodeJS.ErrnoException)?.code === 'ECONNREFUSED' ||
        (axios.isAxiosError(error) && error.code === 'ECONNREFUSED');

      if (connectionError) {
        throw new InternalServerError(
          `Connection refused: Could not connect to Ollama at ${config.ollama.baseURL}.`
        );
      }

      throw new InternalServerError(
        'Failed to initiate stream from AI service.',
        error instanceof Error ? error : undefined
      );
    }
  }

  return convertToChatResponse();
};
