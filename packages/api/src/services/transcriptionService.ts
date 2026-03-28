/* packages/api/src/services/transcriptionService.ts */
import config from '@therascript/config';
import type { WhisperJobStatus } from '@therascript/domain';
import axios from 'axios';
import { ApiError, InternalServerError, NotFoundError } from '../errors.js';
import { addTranscriptionJob } from './jobQueueService.js';
import { unloadActiveModel } from './llamaCppService.js';

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

export async function startTranscriptionJob(
  sessionId: number,
  numSpeakers: number = 2
): Promise<void> {
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

  // Unload the LM Studio model to free up VRAM for Whisper.
  console.log(
    `[TranscriptionService] Attempting to unload LM Studio model to ensure VRAM availability for Whisper...`
  );
  try {
    await unloadActiveModel();
    // Give a short pause for VRAM to actually be reclaimed by the OS/Driver
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log('[TranscriptionService] LM Studio unload request completed.');
  } catch (error: any) {
    console.warn(
      '[TranscriptionService] Warning: Could not explicitly unload LM Studio model. If an LLM is currently loaded, transcription might fail due to Out-of-Memory (OOM). Error:',
      error.message
    );
    // We proceed anyway. If LM Studio is down, it's not using VRAM.
  }

  console.log(
    `[TranscriptionService] Enqueuing transcription job for session ID: ${sessionId}`
  );
  await addTranscriptionJob({ sessionId, numSpeakers });
}

export async function getStructuredTranscriptionResult(
  jobId: string
): Promise<any> {
  const response = await axios.get(`${config.whisper.apiUrl}/status/${jobId}`, {
    timeout: 3000,
  });
  return response.data;
}

/**
 * Fast (no-network) check: is HF_TOKEN set in the Whisper service
 * and are the pyannote model files present in its local HF hub cache?
 */
export async function checkDiarizationReadiness(): Promise<{
  ready: boolean;
  hfTokenSet: boolean;
  modelCached: boolean;
  error?: string;
}> {
  let response;
  try {
    response = await axios.get(`${config.whisper.apiUrl}/diarization/check`, {
      timeout: 5000,
    });
  } catch (error: any) {
    if (error.response?.status === 404) {
      throw new Error(
        `Whisper service at ${config.whisper.apiUrl} does not expose GET /diarization/check (404). ` +
          `The running Whisper container is likely outdated. Rebuild/restart it (e.g. 'docker compose up -d --build whisper') and restart API/worker.`
      );
    }
    throw error;
  }

  const d = response.data;
  return {
    ready: d.ready,
    hfTokenSet: d.hf_token_set,
    modelCached: d.model_cached,
    error: d.error ?? undefined,
  };
}

/**
 * Trigger a background download of pyannote model files in the Whisper service.
 * Idempotent — safe to call if a download is already in progress.
 */
export async function triggerDiarizationPrefetch(): Promise<{
  started: boolean;
  alreadyCached: boolean;
  message: string;
}> {
  const response = await axios.post(
    `${config.whisper.apiUrl}/diarization/prefetch`,
    {},
    { timeout: 10000 }
  );
  const d = response.data;
  return {
    started: d.started,
    alreadyCached: d.already_cached,
    message: d.message,
  };
}
