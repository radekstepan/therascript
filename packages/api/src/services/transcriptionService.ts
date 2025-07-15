/* packages/api/src/services/transcriptionService.ts */
import config from '../config/index.js';
import type { StructuredTranscript, WhisperJobStatus } from '../types/index.js';
import type * as RealService from './transcriptionService.real.js'; // Use .real suffix
import type * as MockService from './transcriptionService.mock.js';

interface TranscriptionServiceInterface {
  startTranscriptionJob: (filePath: string) => Promise<string>;
  getTranscriptionStatus: (jobId: string) => Promise<WhisperJobStatus>;
  getStructuredTranscriptionResult: (
    jobId: string
  ) => Promise<StructuredTranscript>;
  checkWhisperApiHealth: () => Promise<boolean>;
}

let service: TranscriptionServiceInterface;

// Conditionally import and assign the service based on APP_MODE
if (config.server.appMode === 'mock') {
  const mockModule = await import('./transcriptionService.mock.js');
  service = mockModule;
} else {
  // Assume real implementation is in a separate file or defined here
  // If you move the real logic, create transcriptionService.real.ts
  const realModule = await import('./transcriptionService.real.js');
  service = realModule;
}

// Export functions from the dynamically chosen service
export const startTranscriptionJob = service.startTranscriptionJob;
export const getTranscriptionStatus = service.getTranscriptionStatus;
export const getStructuredTranscriptionResult =
  service.getStructuredTranscriptionResult;
export const checkWhisperApiHealth = service.checkWhisperApiHealth;
