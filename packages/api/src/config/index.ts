import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`[Config] NODE_ENV determined as: ${nodeEnv}`);

const __filename = fileURLToPath(import.meta.url);
const packageApiDir = path.resolve(__filename, '../../..');
console.log(`[Config] Determined API package directory: ${packageApiDir}`);

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

const appMode = getEnvVar('APP_MODE', 'development');
console.log(`[Config] Determined APP_MODE as: ${appMode}`);

const port = parseInt(getEnvVar('PORT', '3001'), 10);
const isProduction = nodeEnv === 'production';
const corsOrigin = getEnvVar('CORS_ORIGIN', 'http://localhost:3002');
const ollamaBaseURL = getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434');
const ollamaModel = getEnvVar('OLLAMA_MODEL', 'llama3');
const ollamaKeepAlive = getEnvVar('OLLAMA_CHAT_KEEP_ALIVE', '5m');

// --- NEW Transcription Service Config ---
const transcriptionService = getEnvVar('TRANSCRIPTION_SERVICE', 'whisper');
const whisperApiURL = getEnvVar('WHISPER_API_URL', 'http://localhost:8000');
const whisperModel = getEnvVar('WHISPER_MODEL', 'tiny');
const voxtralApiURL = getEnvVar('VOXTRAL_API_URL', 'http://localhost:8001');
// --- END NEW ---

const elasticsearchUrl = getEnvVar(
  'ELASTICSEARCH_URL',
  'http://localhost:9200'
);

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

const maxUploadFileSize = getEnvVar('UPLOAD_MAX_FILE_SIZE', '100m');

const dbPathFromEnv = getEnvVar('DB_PATH', './data/therapy-analyzer.sqlite');
const transcriptsDirFromEnv = getEnvVar(
  'DB_TRANSCRIPTS_DIR',
  './data/transcripts'
);
const uploadsDirFromEnv = getEnvVar('DB_UPLOADS_DIR', './data/uploads');

const resolvedDbPath = path.resolve(packageApiDir, dbPathFromEnv);
const resolvedTranscriptsDir = path.resolve(
  packageApiDir,
  transcriptsDirFromEnv
);
const resolvedUploadsDir = path.resolve(packageApiDir, uploadsDirFromEnv);

const config = {
  server: {
    port: port,
    nodeEnv: nodeEnv,
    isProduction: isProduction,
    corsOrigin: corsOrigin,
    appMode: appMode as 'production' | 'development' | 'mock',
  },
  ollama: {
    baseURL: ollamaBaseURL,
    model: ollamaModel,
    keepAlive: ollamaKeepAlive,
  },
  transcription: {
    service: transcriptionService as 'whisper' | 'voxtral',
    whisper: { apiUrl: whisperApiURL, model: whisperModel },
    voxtral: { apiUrl: voxtralApiURL },
  },
  // DEPRECATED: Keep for backward compatibility during transition if needed
  whisper: { apiUrl: whisperApiURL, model: whisperModel },
  // END DEPRECATED
  elasticsearch: {
    url: elasticsearchUrl,
  },
  db: {
    sqlitePath: resolvedDbPath,
    transcriptsDir: resolvedTranscriptsDir,
    uploadsDir: resolvedUploadsDir,
  },
  upload: {
    allowedMimeTypes: allowedAudioMimeTypes,
    maxFileSize: maxUploadFileSize,
  },
};

const ensureDirectoryExists = (dirPath: string, dirNameForLog: string) => {
  if (!fs.existsSync(dirPath)) {
    console.log(`[Config] Creating ${dirNameForLog} directory: ${dirPath}`);
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[Config] Successfully created ${dirNameForLog} directory.`);
    } catch (err) {
      console.error(
        `[Config] FATAL: Error creating ${dirNameForLog} directory at ${dirPath}:`,
        err
      );
      process.exit(1);
    }
  }
};
ensureDirectoryExists(path.dirname(config.db.sqlitePath), 'database');
ensureDirectoryExists(config.db.transcriptsDir, 'transcripts');
ensureDirectoryExists(config.db.uploadsDir, 'uploads');

console.log('[Config] Final check before exporting config object:');
console.log(`  - Value of APP_MODE in process.env: ${process.env.APP_MODE}`);
console.log(
  `  - Value of OLLAMA_MODEL in process.env: ${process.env.OLLAMA_MODEL}`
);
console.log('[Config] Effective Configuration Loaded:');
console.log(`  - APP_MODE: ${config.server.appMode}`);
console.log(`  - NODE_ENV: ${config.server.nodeEnv}`);
console.log(`  - Port: ${config.server.port}`);
console.log(`  - CORS Origin: ${config.server.corsOrigin}`);
console.log(`  - Ollama Model (in config object): ${config.ollama.model}`);
console.log(
  `  - Active Transcription Service: ${config.transcription.service}`
);
console.log(`  - Whisper Model: ${config.transcription.whisper.model}`);
console.log(`  - Elasticsearch URL: ${config.elasticsearch.url}`);
console.log(`  - DB Path: ${config.db.sqlitePath}`);
console.log(`  - Transcripts Path: ${config.db.transcriptsDir}`);
console.log(`  - Uploads Path: ${config.db.uploadsDir}`);
console.log(
  `  - Allowed MIME Types for Upload: ${config.upload.allowedMimeTypes.length} types configured.`
);

export default config;
