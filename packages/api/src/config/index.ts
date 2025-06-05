// File: packages/api/src/config/index.ts
// --- Removed dotenv import and usage ---
/* packages/api/src/config/index.ts */
// Removed: import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url'; // Needed to determine package root reliably

// Determine NODE_ENV early
const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`[Config] NODE_ENV determined as: ${nodeEnv}`);

// --- Determine API package root directory ---
const __filename = fileURLToPath(import.meta.url);
const packageApiDir = path.resolve(__filename, '../../..'); // Adjust based on actual output structure
console.log(`[Config] Determined API package directory: ${packageApiDir}`);
// --- End package root determination ---

// --- REMOVED .env file path calculation and loading logic ---
// console.log(`[Config] Environment variables should be loaded via Node's --env-file flag.`);

// --- Helper function to get environment variables (remains the same) ---
const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  // Throw error if required variable is missing
  throw new Error(
    `Missing required environment variable and no default provided: ${key}`
  );
};

// --- Determine appMode AFTER env vars are loaded by Node ---
// Possible values: 'production', 'development', 'mock'
const appMode = getEnvVar('APP_MODE', 'development'); // Default to development
console.log(`[Config] Determined APP_MODE as: ${appMode}`);

// --- Configuration Variables (Read directly from process.env) ---
const port = parseInt(getEnvVar('PORT', '3001'), 10);
const isProduction = nodeEnv === 'production'; // Based on NODE_ENV
const corsOrigin = getEnvVar('CORS_ORIGIN', 'http://localhost:3002');
const ollamaBaseURL = getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434');
const ollamaModel = getEnvVar('OLLAMA_MODEL', 'llama3');
const ollamaKeepAlive = getEnvVar('OLLAMA_CHAT_KEEP_ALIVE', '5m');
const whisperApiURL = getEnvVar('WHISPER_API_URL', 'http://localhost:8000');
const whisperModel = getEnvVar('WHISPER_MODEL', 'tiny');

// Updated list of allowed MIME types for Whisper, matching the UI constants
const allowedAudioMimeTypes = [
  // Common Audio Formats
  'audio/mpeg', // .mp3, .mpga
  'audio/mp3', // .mp3 (often used as an alias)
  'audio/mp4', // .m4a (often used for this), .mp4 (audio only)
  'audio/wav', // .wav
  'audio/x-wav', // .wav (common alternative)
  'audio/aac', // .aac
  'audio/ogg', // .ogg (can contain Vorbis, Opus, Speex)
  'audio/webm', // .webm (audio only)
  'audio/flac', // .flac
  'audio/x-m4a', // .m4a (alternative MIME type)
  'audio/x-flac', // .flac (alternative MIME type, less common)

  // Common Video Formats (Whisper can extract audio from these via FFmpeg)
  'video/mp4', // .mp4
  'video/mpeg', // .mpeg, .mpg
  'video/webm', // .webm
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/x-matroska', // .mkv
  'video/x-flv', // .flv
];

const maxUploadFileSize = getEnvVar('UPLOAD_MAX_FILE_SIZE', '100m');

// --- Resolve DB and data paths relative to the *API package* directory ---
// IMPORTANT: Paths in the .env file should still be relative to the API package dir
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
// --- End path resolution ---

// Assemble the configuration object
const config = {
  server: {
    port: port,
    nodeEnv: nodeEnv,
    isProduction: isProduction,
    corsOrigin: corsOrigin,
    appMode: appMode as 'production' | 'development' | 'mock', // Add appMode
  },
  ollama: {
    baseURL: ollamaBaseURL,
    model: ollamaModel,
    keepAlive: ollamaKeepAlive,
  },
  whisper: { apiUrl: whisperApiURL, model: whisperModel },
  db: {
    sqlitePath: resolvedDbPath,
    transcriptsDir: resolvedTranscriptsDir,
    uploadsDir: resolvedUploadsDir,
  },
  upload: {
    allowedMimeTypes: allowedAudioMimeTypes, // Use the updated comprehensive list
    maxFileSize: maxUploadFileSize,
  },
};

// --- Directory Creation Logic (remains the same) ---
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
// --- End Directory Creation ---

// --- Log effective config (remains the same) ---
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
console.log(`  - Whisper Model: ${config.whisper.model}`);
console.log(`  - DB Path: ${config.db.sqlitePath}`);
console.log(`  - Transcripts Path: ${config.db.transcriptsDir}`);
console.log(`  - Uploads Path: ${config.db.uploadsDir}`);
console.log(
  `  - Allowed MIME Types for Upload: ${config.upload.allowedMimeTypes.length} types configured.`
);

export default config;
