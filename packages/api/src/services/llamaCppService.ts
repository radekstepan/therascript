import axios from 'axios';
import crypto from 'node:crypto';

import config from '@therascript/config';
import {
  BackendChatMessage,
  LlmModelInfo,
  ModelDownloadJobStatus,
  VramEstimate,
} from '@therascript/domain';

import {
  InternalServerError,
  BadRequestError,
  NotFoundError,
} from '../errors.js';

import {
  getActiveModel,
  getConfiguredContextSize,
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
  getConfiguredThinkingBudget,
} from './activeModelService.js';

import { templateRepository } from '@therascript/data';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';
import { getLlmRuntime } from './llamaCppRuntime.js';
import {
  streamLlmChatDetailed,
  LlmChatChunk,
  LlmConnectionError,
  LlmModelNotFoundError,
  LlmTimeoutError,
} from '@therascript/services';

const runtime = getLlmRuntime();

// ---------------------------------------------------------------------------
// LM Studio API response shapes
// ---------------------------------------------------------------------------

interface LmsLoadedInstance {
  id: string;
  config: {
    context_length: number;
    flash_attention?: boolean;
    offload_kv_cache_to_gpu?: boolean;
  };
}

interface LmsModelRecord {
  type: 'llm' | 'embedding';
  publisher: string;
  key: string;
  display_name: string;
  architecture: string | null;
  quantization: { name: string | null; bits_per_weight: number | null } | null;
  size_bytes: number;
  params_string: string | null;
  loaded_instances: LmsLoadedInstance[];
  max_context_length: number;
  format: 'gguf' | 'mlx' | null;
}

interface LmsDownloadStartResponse {
  job_id?: string;
  status:
    | 'downloading'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'already_downloaded';
  total_size_bytes?: number;
  started_at?: string;
}

interface LmsDownloadStatusResponse {
  job_id: string;
  status: 'downloading' | 'paused' | 'completed' | 'failed';
  bytes_per_second?: number;
  estimated_completion?: string;
  completed_at?: string;
  total_size_bytes?: number;
  downloaded_bytes?: number;
  started_at?: string;
}

// We parse bits per weight the same way as before if needed to estimate VRAM
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
  return 0;
}

export function parseParamCount(parameterSize: string): number | null {
  if (!parameterSize) return null;
  const match = parameterSize.trim().match(/^([\\d.]+)\\s*([KMBT]?)/i);
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

function estimateWeightsBytes(model: LlmModelInfo): number {
  const paramCount = parseParamCount(model.details.parameter_size);
  const bitsPerWeight = getBitsPerWeight(model.details.quantization_level);
  if (paramCount !== null && bitsPerWeight > 0) {
    const bytes = Math.round((paramCount * bitsPerWeight) / 8);
    return bytes;
  }
  return model.size;
}

const CUDA_OVERHEAD_BYTES = 512 * 1024 * 1024; // 512 MB

export function estimateVramUsage(
  model: LlmModelInfo,
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

export function getVramPerToken(model: LlmModelInfo): number | null {
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

async function isLlmApiResponsive(): Promise<boolean> {
  try {
    const res = await axios.get(`${config.llm.baseURL}/api/v1/models`, {
      timeout: 3000,
    });
    return res.status === 200;
  } catch (error) {
    return false;
  }
}

export async function ensureLlmReady(timeoutMs = 30000): Promise<void> {
  console.log(
    `[LlmService] Ensuring LLM runtime (${runtime.type}) is ready...`
  );
  await runtime.ensureReady(timeoutMs);
  if (!(await isLlmApiResponsive())) {
    throw new InternalServerError(
      `LLM runtime (${runtime.type}) failed health check after startup.`
    );
  }
}

export const checkLlmApiHealth = async (): Promise<boolean> => {
  return isLlmApiResponsive();
};

const getSystemPrompt = (
  title: 'system_prompt' | 'system_standalone_prompt'
): string => {
  const template = templateRepository.findByTitle(title);
  if (template) {
    return template.text;
  }
  if (title === 'system_prompt') {
    return SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT.text;
  }
  return SYSTEM_PROMPT_TEMPLATES.STANDALONE_CHAT.text;
};

// We will implement GGUF metadata parsing in a separate PR or using a library.
// For now, we return basic mock architecture if it's not possible to parse easily.
export const listModels = async (): Promise<LlmModelInfo[]> => {
  try {
    const res = await axios.get<{ models: LmsModelRecord[] }>(
      `${config.llm.baseURL}/api/v1/models`,
      { timeout: 5000 }
    );
    return res.data.models
      .filter((m) => m.type === 'llm')
      .map((m) => ({
        name: m.key,
        modified_at: new Date(),
        size: m.size_bytes,
        digest: m.key,
        details: {
          format: m.format || 'gguf',
          family: m.architecture || 'unknown',
          families: null,
          parameter_size: m.params_string || 'unknown',
          quantization_level: m.quantization?.name || 'unknown',
        },
        defaultContextSize: m.max_context_length || null,
        // LM Studio does not expose per-layer architecture needed for VRAM estimation
        architecture: null,
      }));
  } catch (error) {
    console.warn(
      '[LlmService] Could not fetch models from LM Studio API:',
      error
    );
    return [];
  }
};

const activeDownloadJobs = new Map<string, ModelDownloadJobStatus>();

/**
 * Start downloading a model via the LM Studio REST API.
 * Accepts an LM Studio model key (e.g. "publisher/model-name") or a
 * Hugging Face URL (e.g. "https://huggingface.co/org/repo-GGUF").
 */
export const startDownloadModelJob = (modelRef: string): string => {
  if (!modelRef || !modelRef.trim()) {
    throw new BadRequestError(
      'Model reference is required (LM Studio key or Hugging Face URL).'
    );
  }

  const jobId = crypto.randomUUID();
  console.log(
    `[LlmService] Queuing LM Studio download job ${jobId} for: ${modelRef}`
  );

  activeDownloadJobs.set(jobId, {
    jobId,
    modelName: modelRef,
    status: 'queued',
    message: 'Download queued',
    startTime: Date.now(),
  });

  void runLmsDownload(jobId, modelRef).catch((err) => {
    const existing = activeDownloadJobs.get(jobId);
    if (
      existing &&
      existing.status !== 'completed' &&
      existing.status !== 'canceled'
    ) {
      activeDownloadJobs.set(jobId, {
        ...existing,
        status: 'failed',
        message: err.message,
        error: err.message,
        endTime: Date.now(),
      });
    }
  });

  return jobId;
};

async function runLmsDownload(jobId: string, modelRef: string): Promise<void> {
  const baseUrl = config.llm.baseURL;

  activeDownloadJobs.set(jobId, {
    ...activeDownloadJobs.get(jobId)!,
    status: 'downloading',
    message: 'Initiating download via LM Studio...',
  });

  try {
    const res = await axios.post<LmsDownloadStartResponse>(
      `${baseUrl}/api/v1/models/download`,
      { model: modelRef },
      { timeout: 30000 }
    );

    if (res.data.status === 'already_downloaded') {
      activeDownloadJobs.set(jobId, {
        ...activeDownloadJobs.get(jobId)!,
        status: 'completed',
        message: 'Model already downloaded',
        progress: 100,
        endTime: Date.now(),
      });
      return;
    }

    const lmsJobId = res.data.job_id;
    if (!lmsJobId) {
      throw new InternalServerError(
        'LM Studio download API did not return a job_id'
      );
    }

    activeDownloadJobs.set(jobId, {
      ...activeDownloadJobs.get(jobId)!,
      status: 'downloading',
      message: 'Downloading...',
      totalBytes: res.data.total_size_bytes,
    });

    await pollLmsDownloadStatus(jobId, lmsJobId, baseUrl);
  } catch (err: any) {
    const existing = activeDownloadJobs.get(jobId);
    if (
      existing &&
      existing.status !== 'canceling' &&
      existing.status !== 'canceled'
    ) {
      activeDownloadJobs.set(jobId, {
        ...existing,
        status: 'failed',
        message: 'Download failed',
        error: err.message,
        endTime: Date.now(),
      });
    }
    throw err;
  }
}

async function pollLmsDownloadStatus(
  jobId: string,
  lmsJobId: string,
  baseUrl: string
): Promise<void> {
  const deadline = Date.now() + 30 * 60 * 1000; // 30 min cap

  while (Date.now() <= deadline) {
    const current = activeDownloadJobs.get(jobId);
    if (current?.status === 'canceling') {
      activeDownloadJobs.set(jobId, {
        ...current,
        status: 'canceled',
        message: 'Download canceled',
        endTime: Date.now(),
      });
      return;
    }

    try {
      const res = await axios.get<LmsDownloadStatusResponse>(
        `${baseUrl}/api/v1/models/download/status/${lmsJobId}`,
        { timeout: 5000 }
      );
      const data = res.data;
      const progress =
        data.total_size_bytes && data.downloaded_bytes
          ? Math.round((data.downloaded_bytes / data.total_size_bytes) * 100)
          : undefined;

      if (data.status === 'completed') {
        activeDownloadJobs.set(jobId, {
          ...activeDownloadJobs.get(jobId)!,
          status: 'completed',
          message: 'Download complete',
          progress: 100,
          completedBytes: data.downloaded_bytes,
          totalBytes: data.total_size_bytes,
          endTime: Date.now(),
        });
        return;
      }

      if (data.status === 'failed') {
        activeDownloadJobs.set(jobId, {
          ...activeDownloadJobs.get(jobId)!,
          status: 'failed',
          message: 'Download failed',
          error: 'LM Studio reported download failure',
          endTime: Date.now(),
        });
        return;
      }

      activeDownloadJobs.set(jobId, {
        ...activeDownloadJobs.get(jobId)!,
        status: 'downloading',
        message: `Downloading... ${progress ?? 0}%`,
        progress,
        completedBytes: data.downloaded_bytes,
        totalBytes: data.total_size_bytes,
      });
    } catch (err: any) {
      console.warn(
        `[LlmService] Failed to poll LM Studio download status: ${err.message}`
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
  }

  activeDownloadJobs.set(jobId, {
    ...activeDownloadJobs.get(jobId)!,
    status: 'failed',
    message: 'Download timed out',
    error: 'Polling timed out after 30 minutes',
    endTime: Date.now(),
  });
}
export const getDownloadModelJobStatus = (
  jobId: string
): ModelDownloadJobStatus | null => {
  const status = activeDownloadJobs.get(jobId);
  return status ? { ...status } : null;
};

export const cancelDownloadModelJob = (jobId: string): boolean => {
  const job = activeDownloadJobs.get(jobId);
  if (
    !job ||
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'canceled'
  ) {
    return false;
  }
  // LM Studio REST API does not expose a cancel endpoint; mark as canceling
  // and the polling loop will pick it up.
  activeDownloadJobs.set(jobId, {
    ...job,
    status: 'canceling',
    message: 'Cancellation requested...',
  });
  return true;
};

export const deleteLlmModel = async (modelPath: string): Promise<string> => {
  return await runtime.deleteModel(modelPath);
};

/**
 * Load a model via the LM Studio REST API.
 * Ensures the daemon/server are running first, unloads any currently loaded
 * LLM instances, then loads the requested model key with the configured
 * context size and GPU settings.
 */
export const loadLlmModel = async (modelPath: string): Promise<void> => {
  // Ensure the LM Studio daemon and server are running
  await runtime.restartWithModel(modelPath);

  const baseUrl = config.llm.baseURL;
  const contextSize = getConfiguredContextSize();
  const numGpuLayers = getConfiguredNumGpuLayers();

  // Unload all currently loaded LLM model instances
  try {
    const modelsRes = await axios.get<{ models: LmsModelRecord[] }>(
      `${baseUrl}/api/v1/models`,
      { timeout: 5000 }
    );
    const loadedInstances = modelsRes.data.models
      .filter((m) => m.type === 'llm')
      .flatMap((m) => m.loaded_instances);

    for (const instance of loadedInstances) {
      try {
        await axios.post(
          `${baseUrl}/api/v1/models/unload`,
          { instance_id: instance.id },
          { timeout: 30000 }
        );
        console.log(`[LlmService] Unloaded instance: ${instance.id}`);
      } catch (err: any) {
        console.warn(
          `[LlmService] Failed to unload ${instance.id}: ${err.message}`
        );
      }
    }
  } catch (err: any) {
    console.warn(
      `[LlmService] Could not enumerate loaded models before load: ${err.message}`
    );
  }

  // Build load request for the LM Studio API
  const loadPayload: Record<string, unknown> = {
    model: modelPath,
    echo_load_config: true,
    // Enable flash attention for better performance where supported
    flash_attention: true,
  };

  if (contextSize !== null && contextSize > 0) {
    loadPayload.context_length = contextSize;
  }

  // numGpuLayers=0 means CPU-only; otherwise allow LM Studio to use GPU
  loadPayload.offload_kv_cache_to_gpu = numGpuLayers !== 0;

  console.log(`[LlmService] Loading model via LM Studio API: ${modelPath}`);
  try {
    const loadRes = await axios.post(
      `${baseUrl}/api/v1/models/load`,
      loadPayload,
      { timeout: 120000 }
    );
    console.log(
      `[LlmService] Model loaded. Instance: ${loadRes.data.instance_id}, ` +
        `load time: ${loadRes.data.load_time_seconds?.toFixed(2)}s`
    );
  } catch (err: any) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    throw new InternalServerError(
      `Failed to load model '${modelPath}' via LM Studio API: ${detail}`
    );
  }
};

export const unloadActiveModel = async (): Promise<string> => {
  const baseUrl = config.llm.baseURL;
  let unloadedCount = 0;

  try {
    const modelsRes = await axios.get<{ models: LmsModelRecord[] }>(
      `${baseUrl}/api/v1/models`,
      { timeout: 5000 }
    );
    const loadedInstances = modelsRes.data.models
      .filter((m) => m.type === 'llm')
      .flatMap((m) => m.loaded_instances);

    for (const instance of loadedInstances) {
      try {
        await axios.post(
          `${baseUrl}/api/v1/models/unload`,
          { instance_id: instance.id },
          { timeout: 30000 }
        );
        console.log(`[LlmService] Unloaded instance: ${instance.id}`);
        unloadedCount++;
      } catch (err: any) {
        console.warn(
          `[LlmService] Failed to unload ${instance.id}: ${err.message}`
        );
      }
    }
  } catch (err: any) {
    console.warn(
      `[LlmService] Could not fetch loaded models for unload: ${err.message}`
    );
  }

  if (unloadedCount > 0) {
    return `${unloadedCount} model instance(s) unloaded successfully.`;
  }

  // Fallback: stop the server via runtime
  if (runtime.stop) {
    await runtime.stop();
    return 'LM Studio server stopped (no models were loaded).';
  }

  return 'No models were loaded.';
};

export const checkModelStatus = async (
  modelPath: string
): Promise<LlmModelInfo | null> => {
  const isUp = await checkLlmApiHealth();
  if (!isUp) return null;
  const models = await listModels();
  return (
    models.find((m) => m.name === modelPath || m.digest === modelPath) ?? null
  );
};

export const streamChatResponse = async function* (
  messages: BackendChatMessage[],
  options?: any
): AsyncGenerator<
  LlmChatChunk,
  { promptTokens: number; completionTokens: number }
> {
  const finalOptions = {
    temperature: getConfiguredTemperature(),
    topP: getConfiguredTopP(),
    repeatPenalty: getConfiguredRepeatPenalty(),
    numGpuLayers: getConfiguredNumGpuLayers(),
    thinkingBudget: getConfiguredThinkingBudget(),
    ...options, // allow overriding defaults
    llamaCppBaseUrl: config.llm.baseURL,
  };
  return yield* streamLlmChatDetailed(messages, finalOptions) as any;
};
