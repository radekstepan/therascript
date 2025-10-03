/* packages/api/src/services/transcriptionService.ts */
import config from '../config/index.js';
import type { WhisperJobStatus } from '../types/index.js';
import type * as RealService from './transcriptionService.real.js';
import type * as MockService from './transcriptionService.mock.js';

interface TranscriptionServiceInterface {
  startTranscriptionJob: (sessionId: number) => Promise<void>;
  checkWhisperApiHealth: () => Promise<boolean>;
  getTranscriptionStatus: (jobId: string) => Promise<WhisperJobStatus>;
}

let service: TranscriptionServiceInterface;

// Conditionally import and assign the service based on APP_MODE
if (config.server.appMode === 'mock') {
  const mockModule = await import('./transcriptionService.mock.js');
  service = mockModule;
} else {
  const realModule = await import('./transcriptionService.real.js');
  service = realModule;
}

// Export functions from the dynamically chosen service
export const startTranscriptionJob = service.startTranscriptionJob;
export const checkWhisperApiHealth = service.checkWhisperApiHealth;
export const getTranscriptionStatus = service.getTranscriptionStatus;

// Re-export the getStructuredTranscriptionResult function from the real service
export const getStructuredTranscriptionResult = async (
  jobId: string
): Promise<any> => {
  const realModule = await import('./transcriptionService.real.js');
  return realModule.getStructuredTranscriptionResult(jobId);
};
