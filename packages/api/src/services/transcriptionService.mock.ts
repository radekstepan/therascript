// Purpose: Provides a mock implementation of the transcription service,
//          simulating interactions with the Whisper service without requiring
//          the actual service or GPU hardware. Useful for frontend development
//          or testing the API layer independently.

import type {
  StructuredTranscript,
  WhisperJobStatus,
  WhisperSegment,
} from '../types/index.js'; // Import type definitions
import { NotFoundError } from '../errors.js'; // Import custom error for missing jobs
import config from '../config/index.js'; // Access configuration (though mostly unused here)

// --- Mock Configuration ---
// Simulate network delay and processing time
const MOCK_DELAY_MS = parseInt(process.env.MOCK_WHISPER_DELAY_MS || '500', 10);
// Sample text used for the mock transcription result
const MOCK_TRANSCRIPT_TEXT =
  'This is a mocked transcription generated during mock mode. It simulates the Whisper service output. The quick brown fox jumps over the lazy dog. This allows development on systems without a dedicated GPU or Whisper running.';
// --- End Mock Configuration ---

// --- Mock Data Store ---
// In-memory map to store the status of simulated jobs, keyed by job ID
const mockJobStore = new Map<string, WhisperJobStatus>();
// --- End Mock Data Store ---

// --- Mock Data Generation Helpers ---
/**
 * Creates a plausible-looking array of WhisperSegment objects based on input text and duration.
 * Splits text into segments and distributes the duration somewhat evenly.
 */
const createMockSegments = (
  text: string,
  durationSec: number
): WhisperSegment[] => {
  const words = text.split(' ');
  const segmentCount = Math.max(1, Math.floor(words.length / 8)); // Approximate 8 words per segment
  const timePerSegment = durationSec / segmentCount;
  const mockSegments: WhisperSegment[] = [];
  let wordIndex = 0;
  let currentTime = 0; // Start time for the current segment

  for (let i = 0; i < segmentCount; i++) {
    const segmentStartTime = currentTime;
    // Ensure segment end time doesn't exceed total duration
    const segmentEndTime = Math.min(currentTime + timePerSegment, durationSec);
    // Slice words for the current segment
    const wordsInSegment = words.slice(wordIndex, wordIndex + 8);
    wordIndex += wordsInSegment.length;

    // Create a mock segment object with plausible (but fake) data
    mockSegments.push({
      id: i,
      seek: segmentStartTime * 1000, // Approx seek offset in ms
      start: segmentStartTime,
      end: segmentEndTime,
      text: wordsInSegment.join(' ').trim(),
      tokens: Array(wordsInSegment.length * 2).fill(1234), // Fake token IDs
      temperature: 0.1, // Fake data
      avg_logprob: -0.2, // Fake data
      compression_ratio: 1.5, // Fake data
      no_speech_prob: 0.05, // Fake data
    });

    currentTime = segmentEndTime + 0.1; // Add a small gap between segments
    // Stop if all words are processed
    if (wordIndex >= words.length) break;
  }
  return mockSegments;
};

// Pre-generate the mock result using the helper
const mockTranscriptResult: Required<WhisperJobStatus>['result'] = {
  text: MOCK_TRANSCRIPT_TEXT,
  segments: createMockSegments(MOCK_TRANSCRIPT_TEXT, 35), // Simulate 35 seconds audio
  language: 'en', // Assume English
};

// Pre-define the structured transcript format expected by the API consumers
const mockTranscriptStructure: StructuredTranscript = [
  {
    id: 0,
    timestamp: 500,
    text: 'This is a mocked transcription generated during mock mode.',
  },
  {
    id: 1,
    timestamp: 6000,
    text: 'It simulates the Whisper service output. The quick brown fox jumps over the lazy dog.',
  },
  {
    id: 2,
    timestamp: 18000,
    text: 'This allows development on systems without a dedicated GPU or Whisper running.',
  },
];
// --- End Mock Data Generation ---

// --- Mock Service Implementation ---

// Log that the mock service is active
console.log('[Mock Service] Using Mock Transcription Service');

/**
 * Simulates checking the health of the Whisper API. Always returns true in mock mode.
 * @returns {Promise<boolean>} A promise resolving to true.
 */
export const checkWhisperApiHealth = async (): Promise<boolean> => {
  console.log(
    '[Mock Transcription] Health check requested. Reporting healthy.'
  );
  await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate tiny delay
  return true;
};

/**
 * Simulates starting a transcription job.
 * Creates a job entry in the mock store and simulates progress updates using setTimeout.
 *
 * @param filePath - Path to the audio file (used only for logging in mock).
 * @returns A promise resolving to the mock job ID.
 */
export const startTranscriptionJob = async (
  filePath: string
): Promise<string> => {
  console.log(`[Mock Transcription] Received request for file: ${filePath}`);
  // Simulate initial processing/queuing delay
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS / 5));

  // Generate a unique mock job ID
  const jobId = `mock-whisper-job-${Date.now()}`;
  const jobStartTime = Date.now();

  // Initialize job status in the store
  mockJobStore.set(jobId, {
    job_id: jobId,
    status: 'queued',
    start_time: jobStartTime,
    duration: 35, // Simulate a fixed 35-second audio duration
    progress: 0,
  });
  console.log(`[Mock Transcription] Created mock job ID: ${jobId}`);

  // Simulate background processing steps with delays
  setTimeout(() => {
    const currentJob = mockJobStore.get(jobId);
    if (currentJob?.status === 'queued') {
      // Check current status before updating
      mockJobStore.set(jobId, {
        ...currentJob,
        status: 'processing',
        progress: 10,
      });
      console.log(
        `[Mock Transcription BG ${jobId}] Status -> processing (10%)`
      );
    }
  }, MOCK_DELAY_MS / 2);

  setTimeout(() => {
    const currentJob = mockJobStore.get(jobId);
    if (currentJob?.status === 'processing') {
      // Check current status
      mockJobStore.set(jobId, {
        ...currentJob,
        status: 'processing',
        progress: 65,
      });
      console.log(
        `[Mock Transcription BG ${jobId}] Status -> processing (65%)`
      );
    }
  }, MOCK_DELAY_MS);

  setTimeout(() => {
    const currentJob = mockJobStore.get(jobId);
    if (currentJob?.status === 'processing') {
      // Check current status
      // Final update: mark as completed and add the mock result
      mockJobStore.set(jobId, {
        ...currentJob,
        status: 'completed',
        progress: 100,
        end_time: Date.now(),
        result: mockTranscriptResult, // Attach the pre-generated result
      });
      console.log(`[Mock Transcription BG ${jobId}] Status -> completed`);
    }
  }, MOCK_DELAY_MS * 1.5);

  return jobId; // Return the generated job ID immediately
};

/**
 * Simulates fetching the status of a transcription job.
 * Retrieves the job status from the in-memory store.
 *
 * @param jobId - The ID of the job to check.
 * @returns A promise resolving to the job's status (excluding the full result).
 * @throws {NotFoundError} If the job ID is not found in the store.
 */
export const getTranscriptionStatus = async (
  jobId: string
): Promise<WhisperJobStatus> => {
  console.log(`[Mock Transcription] Checking status for job ID: ${jobId}`);
  // Simulate a very short network delay for status check
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS / 10));

  const job = mockJobStore.get(jobId);
  if (!job) {
    // Throw a specific error if the job ID is invalid
    throw new NotFoundError(`Mock Job ID ${jobId} not found.`);
  }

  // Return a copy of the job status, *excluding* the full 'result' field
  // to match the expected behavior of a status polling endpoint.
  const { result, ...statusOnly } = job;
  console.log(
    `[Mock Transcription] Status for ${jobId}: ${statusOnly.status} (${statusOnly.progress}%)`
  );
  return statusOnly;
};

/**
 * Simulates fetching the structured transcription result for a completed job.
 * Checks the job status and returns the pre-defined mock structured transcript.
 *
 * @param jobId - The ID of the completed job.
 * @returns A promise resolving to the mock `StructuredTranscript`.
 * @throws {NotFoundError} If the job ID is not found.
 * @throws {Error} If the job status is not 'completed'.
 */
export const getStructuredTranscriptionResult = async (
  jobId: string
): Promise<StructuredTranscript> => {
  console.log(
    `[Mock Transcription] Getting structured result for job ID: ${jobId}`
  );
  // Simulate a short delay
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS / 10));

  const job = mockJobStore.get(jobId);
  if (!job) {
    throw new NotFoundError(`Mock Job ID ${jobId} not found.`);
  }
  // Ensure the job is actually marked as completed before returning results
  if (job.status !== 'completed') {
    throw new Error(
      `Mock Job ${jobId} is not completed (status: ${job.status}).`
    );
  }

  console.log(
    `[Mock Transcription] Returning mock structured transcript for ${jobId}`
  );
  // Return the pre-defined structured mock data
  return mockTranscriptStructure;
};
// --- End Mock Service Implementation ---
