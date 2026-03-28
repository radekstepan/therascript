import axios from 'axios';
import crypto from 'node:crypto';
import * as util from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  exec as callbackExec,
  execFile as callbackExecFile,
} from 'node:child_process';

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
  setActiveModelAndContextAndParams,
  getActiveModel,
  setActiveModelName,
  setConfiguredContextSize,
  getConfiguredContextSize,
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredNumGpuLayers,
  getConfiguredThinkingBudget,
  getActiveModelVramEstimateBytes,
  setActiveModelVramEstimateBytes,
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

const execAsync = util.promisify(callbackExec);
const execFileAsync = util.promisify(callbackExecFile);

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
    // Logic replaced by nativeLMStudioEstimate for 'native' runtime.
    // This manual calculation is kept for 'docker' (linux) fallbacks.
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

function parseLMStudioEstimateOutput(
  rawOutput: string | null | undefined
): VramEstimate | null {
  const output = (rawOutput ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '');

  const gpuMatch = output.match(/Estimated GPU Memory:\s+([\d.]+)\s+(\w+)/i);
  const totalMatch = output.match(
    /Estimated Total Memory:\s+([\d.]+)\s+(\w+)/i
  );

  if (!gpuMatch || !totalMatch) return null;

  const parseBytes = (val: string, unit: string) => {
    const num = parseFloat(val);
    const u = unit.toLowerCase();
    if (u === 'gib' || u === 'gb') return Math.round(num * 1024 * 1024 * 1024);
    if (u === 'mib' || u === 'mb') return Math.round(num * 1024 * 1024);
    return Math.round(num);
  };

  const vram_bytes = parseBytes(gpuMatch[1], gpuMatch[2]);
  const total_bytes = parseBytes(totalMatch[1], totalMatch[2]);

  return {
    vram_bytes,
    ram_bytes: Math.max(0, total_bytes - vram_bytes),
    weights_bytes: 0,
    kv_cache_bytes: 0,
    overhead_bytes: 0,
  };
}

async function nativeLMStudioEstimate(
  modelKey: string,
  contextSize?: number,
  gpu?: string
): Promise<VramEstimate | null> {
  try {
    let output: string;

    if (runtime.type === 'native') {
      const binary = path.join(os.homedir(), '.lmstudio', 'bin', 'lms');
      const args = ['load', '--estimate-only', modelKey];
      if (contextSize !== undefined)
        args.push('--context-length', String(contextSize));
      if (gpu) args.push('--gpu', gpu);

      try {
        const result = await execFileAsync(binary, args);
        output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      } catch (err: any) {
        output = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
        const parsedFromError = parseLMStudioEstimateOutput(output);
        if (parsedFromError) return parsedFromError;

        const contextFlag =
          contextSize !== undefined ? ` --context-length ${contextSize}` : '';
        const gpuFlag = gpu ? ` --gpu ${gpu}` : '';
        const shellResult = await execAsync(
          `"${binary}" load --estimate-only "${modelKey}"${contextFlag}${gpuFlag}`
        );
        output = `${shellResult.stdout ?? ''}${shellResult.stderr ?? ''}`;
      }
    } else {
      return null;
    }

    return parseLMStudioEstimateOutput(output);
  } catch (err) {
    console.warn(`[LlmService] Failed to get native memory estimate:`, err);
    return null;
  }
}

export async function fetchVramUsage(
  model: LlmModelInfo,
  contextSize?: number,
  numGpuLayers?: number | null
): Promise<VramEstimate | null> {
  const gpuFlag =
    numGpuLayers === 0 ? 'off' : numGpuLayers === 99 ? 'max' : undefined;

  const est = await nativeLMStudioEstimate(model.name, contextSize, gpuFlag);
  if (est) return est;

  // Fallback to manual calculation if lms estimation fails or is not available
  const fallbackContextSize =
    contextSize ?? model.defaultContextSize ?? undefined;
  if (fallbackContextSize === undefined) return null;

  return estimateVramUsage(model, fallbackContextSize, numGpuLayers);
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
  // Clear any stale VRAM estimate from a previous model
  setActiveModelVramEstimateBytes(null);
  // Reset estimation dedup flag since we're loading a new model
  estimatingVramForModel = null;
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
    // Fire-and-forget VRAM estimate so the chat header can display it
    const gpuFlagEst =
      numGpuLayers === 0 ? 'off' : numGpuLayers === 99 ? 'max' : undefined;
    nativeLMStudioEstimate(modelPath, contextSize ?? undefined, gpuFlagEst)
      .then((est) => {
        if (est) setActiveModelVramEstimateBytes(est.vram_bytes);
      })
      .catch(() => {});
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

    if (loadedInstances.length > 0) {
      // Unload all model instances in parallel for faster turnaround
      await Promise.all(
        loadedInstances.map(async (instance) => {
          try {
            await axios.post(
              `${baseUrl}/api/v1/models/unload`,
              { instance_id: instance.id },
              { timeout: 15000 }
            );
            console.log(`[LlmService] Unloaded instance: ${instance.id}`);
            unloadedCount++;
          } catch (err: any) {
            console.warn(
              `[LlmService] Failed to unload ${instance.id}: ${err.message}`
            );
          }
        })
      );
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

// Dedup guard: tracks which model key is currently being estimated so we
// don't fire duplicate background estimation calls from polling.
let estimatingVramForModel: string | null = null;

export const checkModelStatus = async (
  modelPath: string
): Promise<LlmModelInfo | null> => {
  const isUp = await checkLlmApiHealth();
  if (!isUp) return null;

  try {
    const res = await axios.get<{ models: LmsModelRecord[] }>(
      `${config.llm.baseURL}/api/v1/models`,
      { timeout: 5000 }
    );

    // Find the currently LOADED model instance
    const loadedModel = res.data.models.find(
      (m) => m.type === 'llm' && m.loaded_instances.length > 0
    );

    // SYNC: Update the active model name to match reality if the server
    // thinks something else is loaded. This fix ensures the UI shows
    // the correct model state.
    if (loadedModel) {
      if (getActiveModel() !== loadedModel.key) {
        console.log(
          `[LlmService] Syncing active model: ${getActiveModel()} -> ${loadedModel.key}`
        );
        setActiveModelName(loadedModel.key);
      }

      // Sync Context Size: LM Studio instance config shows actual context length
      const firstInstance = loadedModel.loaded_instances[0];
      const actualContext = firstInstance?.config?.context_length;
      if (actualContext && getConfiguredContextSize() !== actualContext) {
        console.log(
          `[LlmService] Syncing context size: ${getConfiguredContextSize() ?? 'default'} -> ${actualContext}`
        );
        setConfiguredContextSize(actualContext);
      }
    } else if (getActiveModel() !== 'default') {
      // If nothing is loaded but we thought there was a model, reset to 'default'
      console.log(`[LlmService] Clear active model (no instances found)`);
      setActiveModelName('default');
    }

    // Now check if OUR requested model is the one loaded
    const target = res.data.models.find(
      (m) => m.key === modelPath || m.publisher + '/' + m.key === modelPath
    );

    if (!target) return null;

    // If the target model is currently loaded but we have no VRAM estimate yet,
    // kick off a background estimation (handles server restarts with a model
    // already loaded in LM Studio).
    if (
      loadedModel?.key === target.key &&
      getActiveModelVramEstimateBytes() === null &&
      estimatingVramForModel !== target.key
    ) {
      estimatingVramForModel = target.key;
      const contextForEst = getConfiguredContextSize() ?? undefined;
      const gpuLayersForEst = getConfiguredNumGpuLayers();
      const gpuFlagEst =
        gpuLayersForEst === 0
          ? 'off'
          : gpuLayersForEst === 99
            ? 'max'
            : undefined;
      nativeLMStudioEstimate(target.key, contextForEst, gpuFlagEst)
        .then((est) => {
          if (est) {
            setActiveModelVramEstimateBytes(est.vram_bytes);
            console.log(
              `[LlmService] VRAM estimate for ${target.key}: ${(est.vram_bytes / 1024 ** 3).toFixed(2)} GiB`
            );
          }
          estimatingVramForModel = null;
        })
        .catch(() => {
          estimatingVramForModel = null;
        });
    }

    return {
      name: target.key,
      modified_at: new Date(),
      size: target.size_bytes,
      digest: target.key,
      details: {
        format: target.format || 'gguf',
        family: target.architecture || 'unknown',
        families: null,
        parameter_size: target.params_string || 'unknown',
        quantization_level: target.quantization?.name || 'unknown',
      },
      defaultContextSize: target.max_context_length || null,
      size_vram:
        loadedModel?.key === target.key
          ? (getActiveModelVramEstimateBytes() ?? undefined)
          : undefined,
      architecture: null,
    };
  } catch (err) {
    return null;
  }
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
