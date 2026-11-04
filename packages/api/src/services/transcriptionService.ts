/* packages/api/src/services/transcriptionService.ts */
import config from '@therascript/config';
import type { WhisperJobStatus } from '@therascript/domain';
import axios from 'axios';
import {
  ApiError,
  ConflictError,
  InternalServerError,
  NotFoundError,
} from '../errors.js';
import { addTranscriptionJob, getLlmQueueActivity } from './jobQueueService.js';
import {
  listLoadedLlmInstances,
  unloadActiveModel,
  unloadModelAtUrl,
} from './llamaCppService.js';
import {
  getActiveBaseUrl,
  getDefaultBaseUrl,
  isRemoteLlmBaseUrl,
} from './activeModelService.js';

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
  // 0 (default) disables diarization. Previously defaulted to 2; changed intentionally.
  numSpeakers: number = 0
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

  // Symmetric GPU exclusion: never yank a model out from under a running
  // analysis/verification job — refuse with a 409 instead.
  const llmActivity = await getLlmQueueActivity();
  const llmJobsTotal = llmActivity.analysis + llmActivity.verification;
  if (llmJobsTotal > 0) {
    const parts = [
      llmActivity.analysis > 0 ? `${llmActivity.analysis} analysis` : null,
      llmActivity.verification > 0
        ? `${llmActivity.verification} verification`
        : null,
    ].filter((p): p is string => p !== null);
    throw new ConflictError(
      `Cannot start transcription while ${parts.join(' + ')} job(s) are ` +
        `queued or running. Transcription and the local LLM share one GPU — ` +
        `wait for them to finish (or cancel them) and retry.`
    );
  }

  // Unload the LM Studio model to free up VRAM for Whisper.
  console.log(
    `[TranscriptionService] Attempting to unload LM Studio model to ensure VRAM availability for Whisper...`
  );
  try {
    // stopWhenIdle: the transcription VRAM handoff wants LM Studio fully
    // down (not just model-free) before the Whisper job claims the GPU.
    await unloadActiveModel(undefined, undefined, true);
    // unloadActiveModel only targets the ACTIVE base URL: when chatting via
    // a remote server, a stale local model would otherwise survive the
    // handoff and still hold local VRAM. Evict it explicitly.
    if (isRemoteLlmBaseUrl(getActiveBaseUrl())) {
      await unloadModelAtUrl(getDefaultBaseUrl());
    }
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

  // Verify the handoff instead of hoping: if local instances are STILL
  // loaded (unload silently failed, model reloaded), refuse now with a 409
  // rather than running into a CUDA OOM mid-job. An unreachable local
  // server means no local VRAM is held, so enumeration failures are
  // non-fatal (the worker re-verifies at job start regardless).
  let resident: Awaited<ReturnType<typeof listLoadedLlmInstances>> = [];
  try {
    resident = await listLoadedLlmInstances(getDefaultBaseUrl());
  } catch (error: any) {
    console.warn(
      '[TranscriptionService] Could not verify local LLM unload ' +
        `(${error.message}); proceeding — the worker re-checks at job start.`
    );
  }
  if (resident.length > 0) {
    const names = resident.map((r) => `${r.modelKey} (${r.id})`).join(', ');
    throw new ConflictError(
      `Cannot start transcription: ${resident.length} local LLM instance(s) ` +
        `still loaded (${names}). Unload the chat model and retry — ` +
        `starting now would run out of GPU memory.`
    );
  }

  console.log(
    `[TranscriptionService] Enqueuing transcription job for session ID: ${sessionId}`
  );
  await addTranscriptionJob({ sessionId, numSpeakers });
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
