// packages/api/src/services/transcriptionService.real.ts
import axios from 'axios';
import config from '../config/index.js';
import { ApiError, InternalServerError, NotFoundError } from '../errors.js';
import { addTranscriptionJob } from './jobQueueService.js';
import { unloadActiveModel } from './ollamaService.js';
import type { WhisperJobStatus } from '../types/index.js';

console.log('[Real Service] Using Real Transcription Service');

export async function checkWhisperApiHealth(): Promise<boolean> {
  try {
    await axios.get(`${config.whisper.apiUrl}/health`, { timeout: 3000 });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Fetches the current status of a transcription job from the Whisper service.
 * @param jobId - The ID of the job to check.
 * @returns A promise that resolves to the job's status.
 */
export const getTranscriptionStatus = async (
  jobId: string
): Promise<WhisperJobStatus> => {
  try {
    const response = await axios.get<WhisperJobStatus>(
      `${config.whisper.apiUrl}/status/${jobId}`
    );
    return response.data;
  } catch (error: any) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new NotFoundError(`Transcription job ${jobId}`);
    }
    console.error(
      `[Real TranscriptionService] Error fetching status for job ${jobId}:`,
      error
    );
    throw new InternalServerError(
      'Failed to get transcription status from Whisper service.',
      error
    );
  }
};

/**
 * Enqueues a transcription job in Redis. The actual processing is handled by a worker.
 *
 * @param sessionId - The ID of the session to transcribe.
 * @returns A promise that resolves when the job is successfully added to the queue.
 * @throws {ApiError} If the Whisper service is unavailable.
 */
export const startTranscriptionJob = async (
  sessionId: number
): Promise<void> => {
  console.log(
    '[Real TranscriptionService] Checking Whisper service availability before enqueuing...'
  );
  const isHealthy = await checkWhisperApiHealth();
  if (!isHealthy) {
    throw new ApiError(
      503,
      `Transcription service is currently unavailable at ${config.whisper.apiUrl}.`
    );
  }

  // Unload the Ollama model to free up GPU memory for Whisper.
  // This is a "fire-and-forget" operation; we don't wait for it to complete.
  unloadActiveModel().catch((error) => {
    console.warn(
      '[Real TranscriptionService] Could not unload Ollama model (this might be okay). Error:',
      error.message
    );
  });

  console.log(
    `[Real TranscriptionService] Enqueuing transcription job for session ID: ${sessionId}`
  );
  await addTranscriptionJob({ sessionId });
};

export const getStructuredTranscriptionResult = async (
  jobId: string
): Promise<any> => {
  // This function is now called by the API handler to get transcription results
  // The actual implementation would depend on how the worker stores the results
  // For now, return a placeholder structure
  console.log(
    `[Real TranscriptionService] Getting structured result for job ${jobId}`
  );
  // TODO: Implement actual logic to retrieve structured transcript from worker results
  return [];
};
