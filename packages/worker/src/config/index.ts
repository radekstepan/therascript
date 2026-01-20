// packages/worker/src/config/index.ts
import path from 'path';
import { fileURLToPath } from 'url';

// Helper to get environment variables with defaults
const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(`Missing required environment variable for worker: ${key}`);
};

// Resolve paths relative to the worker package
const __filename = fileURLToPath(import.meta.url);
const packageWorkerDir = path.resolve(__filename, '../../..');

// --- Main Configuration Object ---
const config = {
  server: {
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    appMode: getEnvVar('APP_MODE', 'development') as
      | 'production'
      | 'development'
      | 'mock',
  },
  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: parseInt(getEnvVar('REDIS_PORT', '6379'), 10),
  },
  db: {
    // Resolve path relative to worker package directory
    sqlitePath: path.resolve(
      packageWorkerDir,
      getEnvVar('DB_PATH', '../api/data/therapy-analyzer-dev.sqlite')
    ),
    uploadsDir: path.resolve(
      packageWorkerDir,
      getEnvVar('DB_UPLOADS_DIR', '../api/data/uploads')
    ),
  },
  services: {
    whisperApiUrl: getEnvVar('WHISPER_API_URL', 'http://localhost:8000'),
    whisperModel: getEnvVar('WHISPER_MODEL', 'tiny'),
    ollamaBaseUrl: getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434'),
    elasticsearchUrl: getEnvVar('ELASTICSEARCH_URL', 'http://localhost:9200'),
  },
};

console.log('[Worker Config] Worker configuration loaded:');
console.log(`  - NODE_ENV: ${config.server.nodeEnv}`);
console.log(`  - APP_MODE: ${config.server.appMode}`);
console.log(`  - Redis: ${config.redis.host}:${config.redis.port}`);
console.log(`  - DB Path: ${config.db.sqlitePath}`);
console.log(`  - Whisper URL: ${config.services.whisperApiUrl}`);
console.log(`  - Ollama URL: ${config.services.ollamaBaseUrl}`);
console.log(`  - ES URL: ${config.services.elasticsearchUrl}`);

export default config;
