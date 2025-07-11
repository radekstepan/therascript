// packages/whisper/src/server.ts
import express from 'express';
import fs from 'fs/promises';
import apiRoutes from './routes.js'; // Import the new router

// --- Configuration ---
const TEMP_INPUT_DIR = process.env.TEMP_INPUT_DIR || '/app/temp_inputs';
const TEMP_OUTPUT_DIR = process.env.TEMP_OUTPUT_DIR || '/app/temp_outputs';

// Ensure temp directories exist on startup
async function initialize() {
  try {
    await fs.mkdir(TEMP_INPUT_DIR, { recursive: true });
    await fs.mkdir(TEMP_OUTPUT_DIR, { recursive: true });
    console.log('Temporary directories are ready.');
  } catch (error) {
    console.error('Failed to create temporary directories:', error);
    process.exit(1);
  }
}

// --- Express App Setup ---
const app = express();

// Use basic middleware
app.use(express.json());

// Use the separated routes
app.use(apiRoutes);

// --- Start Server ---
async function startServer() {
  await initialize();
  const PORT = process.env.PORT || 8000;
  app.listen(PORT, () => {
    console.log(`Whisper (Express) server running on http://localhost:${PORT}`);
  });
}

startServer();
