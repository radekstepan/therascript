/* packages/api/src/services/transcriptionService.ts */
import config from '../config/index.js';
import type { WhisperJobStatus } from '@therascript/domain';
import axios from 'axios';
import { ApiError, InternalServerError, NotFoundError } from '../errors.js';
import { addTranscriptionJob } from './jobQueueService.js';
import { unloadActiveModel } from './ollamaService.js';

console.log('[Real Service] Using Real Transcription Service');

export async function checkWhisperApiHealth(): Promise<boolean> {
  try {
    await axios.get(`${config.whisper.apiUrl}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

export async function getTranscriptionStatus(
  jobId: string
): Promise<WhisperJobStatus> {
  const response = await axios.get(`${config.whisper.apiUrl}/status/${jobId}`, {
    timeout: 3000,
  });
  return response.data;
}

export async function startTranscriptionJob(sessionId: number): Promise<void> {
  console.log(
    `[TranscriptionService] Checking Whisper service availability before enqueuing...`
  );
  const isHealthy = await checkWhisperApiHealth();
  if (!isHealthy) {
    throw new ApiError(
      503,
      `Transcription service is currently unavailable at ${config.whisper.apiUrl}.`
    );
  }

  // Unload the Ollama model to free up GPU memory for Whisper.
  console.log(
    `[TranscriptionService] Attempting to unload Ollama model to ensure VRAM availability for Whisper...`
  );
  try {
    await unloadActiveModel();
    // Give a short pause for VRAM to actually be reclaimed by the OS/Driver
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('[TranscriptionService] Ollama unload request completed.');
  } catch (error: any) {
    console.warn(
      '[TranscriptionService] Warning: Could not explicitly unload Ollama model. If an LLM is currently loaded, transcription might fail due to Out-of-Memory (OOM). Error:',
      error.message
    );
    // We proceed anyway. If Ollama is down, it's not using VRAM.
  }

  console.log(
    `[TranscriptionService] Enqueuing transcription job for session ID: ${sessionId}`
  );
  await addTranscriptionJob({ sessionId });
}

export async function getStructuredTranscriptionResult(
  jobId: string
): Promise<any> {
  const response = await axios.get(`${config.whisper.apiUrl}/status/${jobId}`, {
    timeout: 3000,
  });
  return response.data;
}
