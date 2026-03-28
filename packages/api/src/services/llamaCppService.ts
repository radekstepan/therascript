import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

import config from '@therascript/config';
import {
  BackendChatMessage,
  LlmModelInfo,
  ModelDownloadJobStatus,
  ModelDownloadJobStatusState,
  VramEstimate,
} from '@therascript/domain';

import {
  InternalServerError,
  BadRequestError,
  ApiError,
  NotFoundError,
  ConflictError,
} from '../errors.js';

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
import { getLlmRuntime } from './llamaCppRuntime.js';
import {
  streamLlmChatDetailed,
  LlmChatChunk,
  LlmConnectionError,
  LlmModelNotFoundError,
  LlmTimeoutError,
} from '@therascript/services';

const runtime = getLlmRuntime();

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
    const res = await axios.get(`${config.llm.baseURL}/health`, {
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
  const modelsDir = config.llm.modelsDir;
  if (!fs.existsSync(modelsDir)) {
    return [];
  }
  const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.gguf'));
  return files.map((file) => {
    const stats = fs.statSync(path.join(modelsDir, file));
    return {
      name: file,
      modified_at: stats.mtime,
      size: stats.size,
      digest: file,
      details: {
        format: 'gguf',
        family: 'llama',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
      defaultContextSize: 8192,
      architecture: {
        num_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        precision: 2,
      },
    };
  });
};

const activeDownloadJobs = new Map<string, ModelDownloadJobStatus>();
const downloadJobCancellationFlags = new Map<string, boolean>();

export const startDownloadModelJob = (modelUrl: string): string => {
  // Validate URL
  let url: URL;
  try {
    url = new URL(modelUrl);
  } catch (e) {
    throw new BadRequestError(
      'Invalid URL provided. Must be a valid HTTP/HTTPS URL.'
    );
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestError('URL must use http or https protocol.');
  }

  // Extract filename from URL or use a default
  let fileName = url.pathname.split('/').pop() || 'model.gguf';
  if (!fileName.endsWith('.gguf')) {
    fileName += '.gguf';
  }

  const jobId = crypto.randomUUID();
  console.log(
    `[LlmService] Queuing download job ${jobId} for model: ${fileName} from ${modelUrl}`
  );

  if (!fs.existsSync(config.llm.modelsDir)) {
    fs.mkdirSync(config.llm.modelsDir, { recursive: true });
  }

  activeDownloadJobs.set(jobId, {
    jobId,
    modelName: fileName,
    status: 'queued',
    message: 'Download queued',
    startTime: Date.now(),
  });
  downloadJobCancellationFlags.set(jobId, false);

  void runDownloadInBackground(jobId, modelUrl, fileName).catch((err) => {
    activeDownloadJobs.set(jobId, {
      ...activeDownloadJobs.get(jobId)!,
      status: 'failed',
      error: 'Background task crashed',
      message: err.message,
      endTime: Date.now(),
    });
  });

  return jobId;
};

async function runDownloadInBackground(
  jobId: string,
  modelUrl: string,
  fileName: string
) {
  const destPath = path.join(config.llm.modelsDir, fileName);
  activeDownloadJobs.set(jobId, {
    ...activeDownloadJobs.get(jobId)!,
    status: 'downloading',
    message: 'Downloading...',
  });

  try {
    const response = await axios({
      url: modelUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
    let completedBytes = 0;

    const writer = createWriteStream(destPath);

    response.data.on('data', (chunk: Buffer) => {
      if (downloadJobCancellationFlags.get(jobId)) {
        response.data.destroy();
        writer.close();
        fs.unlinkSync(destPath);
        return;
      }
      completedBytes += chunk.length;
      const progress = totalBytes
        ? Math.round((completedBytes / totalBytes) * 100)
        : 0;
      activeDownloadJobs.set(jobId, {
        ...activeDownloadJobs.get(jobId)!,
        status: 'downloading',
        totalBytes,
        completedBytes,
        progress,
        message: `Downloading... ${progress}%`,
      });
    });

    await pipeline(response.data, writer);

    if (downloadJobCancellationFlags.get(jobId)) {
      activeDownloadJobs.set(jobId, {
        ...activeDownloadJobs.get(jobId)!,
        status: 'canceled',
        message: 'Canceled',
        endTime: Date.now(),
      });
    } else {
      activeDownloadJobs.set(jobId, {
        ...activeDownloadJobs.get(jobId)!,
        status: 'completed',
        message: 'Download finished',
        progress: 100,
        endTime: Date.now(),
      });
    }
  } catch (err: any) {
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    activeDownloadJobs.set(jobId, {
      ...activeDownloadJobs.get(jobId)!,
      status: 'failed',
      message: 'Download failed',
      error: err.message,
      endTime: Date.now(),
    });
  } finally {
    downloadJobCancellationFlags.delete(jobId);
  }
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
  downloadJobCancellationFlags.set(jobId, true);
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

export const loadLlmModel = async (modelPath: string): Promise<void> => {
  await runtime.restartWithModel(modelPath);
};

export const unloadActiveModel = async (): Promise<string> => {
  if (runtime.stop) {
    await runtime.stop();
    return 'Model unloaded successfully.';
  }
  return 'No model to unload.';
};

export const checkModelStatus = async (
  modelPath: string
): Promise<LlmModelInfo | null> => {
  const isUp = await checkLlmApiHealth();
  if (!isUp) return null;
  const models = await listModels();
  return models.find((m) => m.name === path.basename(modelPath)) ?? null;
};

export const streamChatResponse = async function* (
  messages: BackendChatMessage[],
  options?: any
): AsyncGenerator<
  LlmChatChunk,
  { promptTokens: number; completionTokens: number }
> {
  return yield* streamLlmChatDetailed(messages, {
    ...options,
    llamaCppBaseUrl: config.llm.baseURL,
  }) as any;
};
