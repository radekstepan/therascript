// packages/api/src/services/transcriptionService.mock.ts
import type { WhisperJobStatus } from '../types/index.js';
import config from '../config/index.js';

const MOCK_DELAY_MS = parseInt(process.env.MOCK_WHISPER_DELAY_MS || '500', 10);

console.log('[Mock Service] Using Mock Transcription Service');

export const checkWhisperApiHealth = async (): Promise<boolean> => {
  console.log(
    '[Mock Transcription] Health check requested. Reporting healthy.'
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  return true;
};

export const startTranscriptionJob = async (
  sessionId: number
): Promise<void> => {
  console.log(
    `[Mock Transcription] Received request for session ID: ${sessionId}`
  );
  // In mock mode, we can just immediately mark it as "transcribing" or "completed"
  // since there's no real worker. For a better mock, we could simulate the delay.
  // The UI will poll the session status, so we simulate the worker's behavior.
  setTimeout(async () => {
    try {
      const { sessionRepository } = await import(
        '../repositories/sessionRepository.js'
      );
      console.log(
        `[Mock Transcription] Simulating 'transcribing' for session ${sessionId}`
      );
      sessionRepository.updateMetadata(sessionId, { status: 'transcribing' });
    } catch (e) {
      console.error('Mock transcription error (1):', e);
    }
  }, MOCK_DELAY_MS / 2);

  setTimeout(async () => {
    try {
      const { sessionRepository } = await import(
        '../repositories/sessionRepository.js'
      );
      console.log(
        `[Mock Transcription] Simulating 'completed' for session ${sessionId}`
      );
      sessionRepository.updateMetadata(sessionId, { status: 'completed' });
    } catch (e) {
      console.error('Mock transcription error (2):', e);
    }
  }, MOCK_DELAY_MS);
};
