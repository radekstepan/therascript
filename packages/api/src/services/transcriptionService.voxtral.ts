// packages/api/src/services/transcriptionService.voxtral.ts
import axios from 'axios';
import config from '../config/index.js';
import { ApiError, InternalServerError, NotFoundError } from '../errors.js';
import { addTranscriptionJob } from './jobQueueService.js';
import { unloadActiveModel } from './ollamaService.js';
import { sessionRepository } from '../repositories/sessionRepository.js';
import type { WhisperJobStatus } from '../types/index.js';

console.log('[Real Service] Using Voxtral Transcription Service');

export async function checkWhisperApiHealth(): Promise<boolean> {
  // For Voxtral backend, health is /v1/models
  try {
    await axios.get(`${config.transcription.voxtral.apiUrl}/models`, {
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export const getTranscriptionStatus = async (
  jobId: string
): Promise<WhisperJobStatus> => {
  // For Voxtral, we encode jobId as `voxtral:<sessionId>` and derive status from session metadata
  if (!jobId.startsWith('voxtral:')) {
    throw new NotFoundError(`Transcription job ${jobId}`);
  }
  const sessionIdStr = jobId.split(':')[1];
  const sessionId = parseInt(sessionIdStr, 10);
  const s = sessionRepository.findById(sessionId);
  if (!s) throw new NotFoundError(`Session ${sessionId}`);

  const status: WhisperJobStatus = {
    job_id: jobId,
    status: (s.status as any) || 'queued',
    progress: null,
    duration: null,
    result: null,
    error: null,
    start_time: null,
    end_time: null,
    message:
      s.status === 'completed'
        ? 'Transcription finished.'
        : 'Processing via Voxtral.',
  };
  return status;
};

export const startTranscriptionJob = async (
  sessionId: number
): Promise<void> => {
  // Check Voxtral service availability
  const isHealthy = await checkWhisperApiHealth();
  if (!isHealthy) {
    throw new ApiError(
      503,
      `Voxtral service is currently unavailable at ${config.transcription.voxtral.apiUrl}.`
    );
  }

  // Try to free GPU VRAM by unloading Ollama
  try {
    await unloadActiveModel();
    await new Promise((r) => setTimeout(r, 1000));
  } catch (e) {
    console.warn(
      '[Voxtral TranscriptionService] Could not unload Ollama model:',
      (e as any)?.message
    );
  }

  // Mark job id in session metadata for UI compatibility
  const jobId = `voxtral:${sessionId}`;
  sessionRepository.updateMetadata(sessionId, {
    status: 'transcribing',
    whisperJobId: jobId,
  });

  await addTranscriptionJob({ sessionId });
};

export const getStructuredTranscriptionResult = async (
  _jobId: string
): Promise<any> => {
  // For Voxtral path, the worker writes transcript to DB directly; this function can return []
  return [];
};
