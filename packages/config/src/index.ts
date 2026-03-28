import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const getProjectRoot = (): string => {
  const srcOrDistDir = path.dirname(__filename);
  const configPkgDir = path.dirname(srcOrDistDir);
  const packagesDir = path.dirname(configPkgDir);
  const monorepoRoot = path.dirname(packagesDir);
  return monorepoRoot;
};

const projectRoot = getProjectRoot();

const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(
    `Missing required environment variable and no default provided: ${key}`
  );
};

const parseIntEnvVar = (
  key: string,
  defaultValue: number,
  radix: number = 10
): number => {
  const value = getEnvVar(key, String(defaultValue));
  const parsed = parseInt(value, radix);
  if (isNaN(parsed)) {
    throw new Error(`Invalid integer value for ${key}: ${value}`);
  }
  return parsed;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const determineDefaultLlmRuntime = (): 'docker' | 'native' => {
  if (process.platform === 'darwin') {
    return 'native';
  }
  return 'docker';
};

const llmRuntimeRaw = getEnvVar(
  'LLM_RUNTIME',
  determineDefaultLlmRuntime()
).toLowerCase();
if (!['docker', 'native'].includes(llmRuntimeRaw)) {
  throw new Error(
    `Invalid LLM_RUNTIME value: ${llmRuntimeRaw}. Expected 'docker' or 'native'.`
  );
}
const llmRuntime = llmRuntimeRaw as 'docker' | 'native';

const allowedAudioMimeTypes = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  'audio/x-m4a',
  'audio/x-flac',
  'video/mp4',
  'video/mpeg',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/x-flv',
];

const dbPathFromEnv = getEnvVar(
  'DB_PATH',
  'packages/api/data/therapy-analyzer-dev.sqlite'
);
const uploadsDirFromEnv = getEnvVar(
  'DB_UPLOADS_DIR',
  'packages/api/data/uploads'
);

const resolvedDbPath = path.resolve(projectRoot, dbPathFromEnv);
const resolvedUploadsDir = path.resolve(projectRoot, uploadsDirFromEnv);

const config = {
  server: {
    port: parseIntEnvVar('PORT', 3001),
    nodeEnv: nodeEnv as 'development' | 'production',
    isProduction: isProduction,
    appMode: getEnvVar('APP_MODE', 'development') as
      | 'development'
      | 'production'
      | 'mock',
    corsOrigin: getEnvVar('CORS_ORIGIN', 'http://localhost:3002'),
  },
  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: parseIntEnvVar('REDIS_PORT', 6379),
  },
  llm: {
    baseURL: getEnvVar('LLM_BASE_URL', 'http://localhost:1234'),
    // LM Studio model key (e.g. "publisher/model-name") or "default" to use whatever is loaded
    modelPath: getEnvVar('LLM_MODEL_PATH', 'default'),
    // Resolve modelsDir to absolute path; for Docker this is packages/llama/models (bind-mounted)
    modelsDir: path.resolve(
      projectRoot,
      'packages/llama',
      getEnvVar('LLM_MODELS_DIR', 'models')
    ),
    contextSize: parseIntEnvVar('LLM_CONTEXT_SIZE', 8192),
    nGpuLayers: parseIntEnvVar('LLM_N_GPU_LAYERS', 99),
    timeoutMs: parseIntEnvVar('LLM_TIMEOUT_MS', 600000), // Default to 10 minutes
    runtime: llmRuntime,
  },
  whisper: {
    apiUrl: getEnvVar('WHISPER_API_URL', 'http://localhost:8000'),
    model: getEnvVar('WHISPER_MODEL', 'tiny'),
    inactivityTimeoutMs: parseIntEnvVar(
      'WHISPER_INACTIVITY_TIMEOUT_MS',
      30 * 60 * 1000 // 30 minutes of no progress
    ),
    numSpeakers: parseIntEnvVar('WHISPER_NUM_SPEAKERS', 2),
    // If set, diarization is expected and the upload flow will enforce model readiness.
    hfToken: process.env.HF_TOKEN ?? null,
  },
  elasticsearch: {
    url: getEnvVar('ELASTICSEARCH_URL', 'http://localhost:9200'),
  },
  db: {
    sqlitePath: resolvedDbPath,
    uploadsDir: resolvedUploadsDir,
  },
  upload: {
    allowedMimeTypes: allowedAudioMimeTypes,
    maxFileSize: getEnvVar('UPLOAD_MAX_FILE_SIZE', '100m'),
  },
};

import { pricing } from './pricing.js';
export {
  pricing,
  type LlmModelPricing,
  type WhisperModelPricing,
  type PricingConfig,
} from './pricing.js';
export { config as default };
