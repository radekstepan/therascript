/* packages/api/src/config/index.ts */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url'; // Needed to determine package root reliably

// Determine NODE_ENV early
const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`[Config] NODE_ENV determined as: ${nodeEnv}`);

// --- Determine API package root directory ---
const __filename = fileURLToPath(import.meta.url);
// Assuming build output is in 'dist', navigate up to the 'packages/api' root
// Example: /path/to/project/packages/api/dist/config/index.js -> /path/to/project/packages/api/
const packageApiDir = path.resolve(__filename, '../../..'); // Adjust based on actual output structure (might need more '../')
console.log(`[Config] Determined API package directory: ${packageApiDir}`);
// --- End package root determination ---

// --- Load .env files relative to the *API package* directory ---
const envPath = path.resolve(packageApiDir, '.env');
const envEnvPath = path.resolve(packageApiDir, `.env.${nodeEnv}`);
// --- Add path for .env.mock ---
const envMockPath = path.resolve(packageApiDir, '.env.mock');
// --- End .env file path calculation ---


// Function to load and log dotenv results
function loadDotenv(filePath: string, override: boolean) {
    if (fs.existsSync(filePath)) {
        console.log(`[Config] Attempting to load environment variables from: ${filePath} (override: ${override})`);
        const result = dotenv.config({ path: filePath, override: override });

        // *** Log the result ***
        if (result.error) {
            console.error(`[Config] ERROR loading ${filePath}:`, result.error);
        } else if (result.parsed) {
            console.log(`[Config] Successfully parsed ${filePath}. Variables found:`, Object.keys(result.parsed));
        } else {
            console.warn(`[Config] dotenv.config ran for ${filePath} but returned no parsed data and no error.`);
        }
        // *** End log block ***

    } else {
        console.log(`[Config] Environment file not found, skipping: ${filePath}`);
    }
}

// --- Load order adjusted: mock > env-specific > base ---
// Load .env.mock if it exists, with override (highest priority if APP_MODE=mock)
loadDotenv(envMockPath, true);

// Load environment-specific file (.env.development/.env.production), no override if mock already set APP_MODE
// Note: APP_MODE might already be set by .env.mock. This ensures specific env settings don't overwrite APP_MODE=mock.
loadDotenv(envEnvPath, !process.env.APP_MODE || process.env.APP_MODE !== 'mock');

// Load base .env file, no override (lowest priority)
loadDotenv(envPath, false);

// --- Helper function (keep as is) ---
const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key];
  if (value !== undefined) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(`Missing required environment variable and no default provided: ${key}`);
};

// --- Determine appMode AFTER loading env files ---
// Possible values: 'production', 'development', 'mock'
const appMode = getEnvVar('APP_MODE', 'development'); // Default to development
console.log(`[Config] Determined APP_MODE as: ${appMode}`);

// --- Configuration Variables ---
const port = parseInt(getEnvVar('PORT', '3001'), 10);
const isProduction = nodeEnv === 'production'; // Based on NODE_ENV
const corsOrigin = getEnvVar('CORS_ORIGIN', 'http://localhost:3002');
const ollamaBaseURL = getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434');
const ollamaModel = getEnvVar('OLLAMA_MODEL', 'llama3');
const ollamaKeepAlive = getEnvVar('OLLAMA_CHAT_KEEP_ALIVE', '5m');
const whisperApiURL = getEnvVar('WHISPER_API_URL', 'http://localhost:8000');
const whisperModel = getEnvVar('WHISPER_MODEL', 'tiny');
const allowedAudioMimeTypes = [ 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-m4a', 'audio/ogg', 'audio/aac', ];
const maxUploadFileSize = getEnvVar('UPLOAD_MAX_FILE_SIZE', '100m');

// --- Resolve DB and data paths relative to the *API package* directory ---
const dbPathFromEnv = getEnvVar('DB_PATH', './data/therapy-analyzer.sqlite');
const transcriptsDirFromEnv = getEnvVar('DB_TRANSCRIPTS_DIR', './data/transcripts');
const uploadsDirFromEnv = getEnvVar('DB_UPLOADS_DIR', './data/uploads');

const resolvedDbPath = path.resolve(packageApiDir, dbPathFromEnv);
const resolvedTranscriptsDir = path.resolve(packageApiDir, transcriptsDirFromEnv);
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
  ollama: { baseURL: ollamaBaseURL, model: ollamaModel, keepAlive: ollamaKeepAlive },
  whisper: { apiUrl: whisperApiURL, model: whisperModel },
  db: { sqlitePath: resolvedDbPath, transcriptsDir: resolvedTranscriptsDir, uploadsDir: resolvedUploadsDir },
  upload: { allowedMimeTypes: allowedAudioMimeTypes, maxFileSize: maxUploadFileSize },
};

// --- Directory Creation Logic ---
const ensureDirectoryExists = (dirPath: string, dirNameForLog: string) => {
    if (!fs.existsSync(dirPath)) {
        console.log(`[Config] Creating ${dirNameForLog} directory: ${dirPath}`);
        try { fs.mkdirSync(dirPath, { recursive: true }); console.log(`[Config] Successfully created ${dirNameForLog} directory.`); }
        catch (err) { console.error(`[Config] FATAL: Error creating ${dirNameForLog} directory at ${dirPath}:`, err); process.exit(1); }
    }
};
// Ensure directories exist using the resolved paths
ensureDirectoryExists(path.dirname(config.db.sqlitePath), 'database');
ensureDirectoryExists(config.db.transcriptsDir, 'transcripts');
ensureDirectoryExists(config.db.uploadsDir, 'uploads');
// --- End Directory Creation ---

// --- Log effective config ---
console.log("[Config] Final check before exporting config object:");
console.log(`  - Value of APP_MODE in process.env: ${process.env.APP_MODE}`); // Log raw env var
console.log(`  - Value of OLLAMA_MODEL in process.env: ${process.env.OLLAMA_MODEL}`);
console.log("[Config] Effective Configuration Loaded:");
console.log(`  - APP_MODE: ${config.server.appMode}`); // Log effective mode
console.log(`  - NODE_ENV: ${config.server.nodeEnv}`);
console.log(`  - Port: ${config.server.port}`);
console.log(`  - CORS Origin: ${config.server.corsOrigin}`);
console.log(`  - Ollama Model (in config object): ${config.ollama.model}`);
console.log(`  - Whisper Model: ${config.whisper.model}`);
console.log(`  - DB Path: ${config.db.sqlitePath}`); // Log the resolved path
console.log(`  - Transcripts Path: ${config.db.transcriptsDir}`); // Log the resolved path
console.log(`  - Uploads Path: ${config.db.uploadsDir}`); // Log the resolved path

export default config;
