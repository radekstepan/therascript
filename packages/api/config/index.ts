import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file first
dotenv.config();

// Helper function to get environment variable or throw error if required
const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

// Server Configuration
const port = parseInt(getEnvVar('PORT', '3001'), 10);
const nodeEnv = getEnvVar('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const corsOrigin = getEnvVar('CORS_ORIGIN', 'http://localhost:3002'); // Frontend origin

// Ollama Configuration
const ollamaBaseURL = getEnvVar('OLLAMA_BASE_URL', 'http://localhost:11434');
const ollamaModel = getEnvVar('OLLAMA_MODEL', 'llama3');
const ollamaKeepAlive = getEnvVar('OLLAMA_CHAT_KEEP_ALIVE', '5m');

// Database and File Storage Configuration
const dbPath = getEnvVar('DB_PATH', './data/therapy-analyzer.sqlite');
const transcriptsDir = getEnvVar('DB_TRANSCRIPTS_DIR', './data/transcripts');
const uploadsDir = getEnvVar('DB_UPLOADS_DIR', './data/uploads');

// Upload Configuration
const allowedAudioMimeTypes = [
    'audio/mpeg', // .mp3
    'audio/mp3',  // Common alternative
    'audio/wav',  // .wav
    'audio/x-m4a',// .m4a
    'audio/ogg',  // .ogg
    'audio/aac',  // .aac
    // Add more as needed and tested with Whisper
];
const maxUploadFileSize = '100m'; // Default 100MB

// Resolve paths relative to the project root
const resolvedDbPath = path.resolve(process.cwd(), dbPath);
const resolvedTranscriptsDir = path.resolve(process.cwd(), transcriptsDir);
const resolvedUploadsDir = path.resolve(process.cwd(), uploadsDir);

// Assemble the configuration object
const config = {
  server: {
    port: port,
    nodeEnv: nodeEnv,
    isProduction: isProduction,
    corsOrigin: corsOrigin,
  },
  ollama: {
    baseURL: ollamaBaseURL,
    model: ollamaModel,
    keepAlive: ollamaKeepAlive,
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

// --- Directory Creation Logic ---
// Helper function to ensure a directory exists
const ensureDirectoryExists = (dirPath: string, dirNameForLog: string) => {
    if (!fs.existsSync(dirPath)) {
        console.log(`[Config] Creating ${dirNameForLog} directory: ${dirPath}`);
        try {
            // Create directory recursively if it doesn't exist
            fs.mkdirSync(dirPath, { recursive: true });
            console.log(`[Config] Successfully created ${dirNameForLog} directory.`);
        } catch (err) {
             // Log error and exit if essential directory creation fails
             console.error(`[Config] FATAL: Error creating ${dirNameForLog} directory at ${dirPath}:`, err);
             process.exit(1); // Exit the application
        }
    }
};

// Ensure all necessary directories exist before the application fully starts
ensureDirectoryExists(path.dirname(config.db.sqlitePath), 'database'); // Directory containing the SQLite file
ensureDirectoryExists(config.db.transcriptsDir, 'transcripts');        // Directory for storing transcript files
ensureDirectoryExists(config.db.uploadsDir, 'uploads');                // Directory for temporary uploads

export default config;
