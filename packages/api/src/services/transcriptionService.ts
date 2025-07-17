/* packages/api/src/services/transcriptionService.ts */
import config from '../config/index.js';
import type { StructuredTranscript, WhisperJobStatus } from '../types/index.js';

interface TranscriptionServiceInterface {
  startTranscriptionJob: (filePath: string) => Promise<string>;
  getTranscriptionStatus: (jobId: string) => Promise<WhisperJobStatus>;
  getStructuredTranscriptionResult: (
    jobId: string
  ) => Promise<StructuredTranscript>;
  checkTranscriptionSvcHealth: () => Promise<boolean>;
}

let service: TranscriptionServiceInterface;

// Conditionally import and assign the service based on config
if (config.server.appMode === 'mock') {
  const mockModule = await import('./transcriptionService.mock.js');
  service = mockModule;
} else if (config.transcription.service === 'voxtral') {
  const voxtralModule = await import('./transcriptionService.voxtral.js');
  service = voxtralModule;
} else {
  // Default to whisper
  const whisperModule = await import('./transcriptionService.whisper.js');
  service = whisperModule;
}

// Export functions from the dynamically chosen service
export const startTranscriptionJob = service.startTranscriptionJob;
export const getTranscriptionStatus = service.getTranscriptionStatus;
export const getStructuredTranscriptionResult =
  service.getStructuredTranscriptionResult;
export const checkTranscriptionSvcHealth = service.checkTranscriptionSvcHealth;
