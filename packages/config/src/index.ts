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

const determineDefaultOllamaRuntime = (): 'docker' | 'native' => {
  if (process.platform === 'darwin') {
    return 'native';
  }
  return 'docker';
};

const ollamaRuntimeRaw = getEnvVar(
  'OLLAMA_RUNTIME',
  determineDefaultOllamaRuntime()
).toLowerCase();
if (!['docker', 'native'].includes(ollamaRuntimeRaw)) {
  throw new Error(
    `Invalid OLLAMA_RUNTIME value: ${ollamaRuntimeRaw}. Expected 'docker' or 'native'.`
  );
}
const ollamaRuntime = ollamaRuntimeRaw as 'docker' | 'native';

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
  ollama: {
    baseURL: getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434'),
    model: getEnvVar('OLLAMA_MODEL', 'llama3'),
    keepAlive: getEnvVar('OLLAMA_CHAT_KEEP_ALIVE', '5m'),
    runtime: ollamaRuntime,
  },
  whisper: {
    apiUrl: getEnvVar('WHISPER_API_URL', 'http://localhost:8000'),
    model: getEnvVar('WHISPER_MODEL', 'tiny'),
    pollingTimeoutMs: parseIntEnvVar(
      'WHISPER_POLLING_TIMEOUT_MS',
      30 * 60 * 1000
    ),
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
