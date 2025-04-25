/* (NEW FILE) packages/api/src/services/transcriptionService.mock.ts */
import type {
  StructuredTranscript,
  WhisperJobStatus,
  WhisperSegment
} from '../types/index.js';
import { NotFoundError } from '../errors.js';
import config from '../config/index.js';

// --- Mock Configuration ---
const MOCK_DELAY_MS = parseInt(process.env.MOCK_WHISPER_DELAY_MS || '500', 10);
const MOCK_TRANSCRIPT_TEXT = "This is a mocked transcription generated during mock mode. It simulates the Whisper service output. The quick brown fox jumps over the lazy dog. This allows development on systems without a dedicated GPU or Whisper running.";

// --- Mock Data ---
const mockJobStore = new Map<string, WhisperJobStatus>();

const createMockSegments = (text: string, durationSec: number): WhisperSegment[] => {
  const words = text.split(' ');
  const segmentCount = Math.max(1, Math.floor(words.length / 8)); // ~8 words per segment
  const timePerSegment = durationSec / segmentCount;
  const mockSegments: WhisperSegment[] = [];
  let wordIndex = 0;
  let currentTime = 0;

  for (let i = 0; i < segmentCount; i++) {
      const segmentStartTime = currentTime;
      const segmentEndTime = Math.min(currentTime + timePerSegment, durationSec);
      const wordsInSegment = words.slice(wordIndex, wordIndex + 8);
      wordIndex += wordsInSegment.length;
      mockSegments.push({
          id: i,
          seek: segmentStartTime * 1000, // approx
          start: segmentStartTime,
          end: segmentEndTime,
          text: wordsInSegment.join(' ').trim(),
          tokens: Array(wordsInSegment.length * 2).fill(1234), // fake tokens
          temperature: 0.1,
          avg_logprob: -0.2,
          compression_ratio: 1.5,
          no_speech_prob: 0.05,
      });
      currentTime = segmentEndTime + 0.1; // Add small gap
       if (wordIndex >= words.length) break;
  }
  return mockSegments;
};

const mockTranscriptResult: Required<WhisperJobStatus>['result'] = {
  text: MOCK_TRANSCRIPT_TEXT,
  segments: createMockSegments(MOCK_TRANSCRIPT_TEXT, 35), // Simulate 35 seconds audio
  language: 'en',
};

const mockTranscriptStructure: StructuredTranscript = [
  { id: 0, timestamp: 500, text: "This is a mocked transcription generated during mock mode." },
  { id: 1, timestamp: 6000, text: "It simulates the Whisper service output. The quick brown fox jumps over the lazy dog." },
  { id: 2, timestamp: 18000, text: "This allows development on systems without a dedicated GPU or Whisper running." },
];

// --- Mock Implementation ---
console.log('[Mock Service] Using Mock Transcription Service');

export const startTranscriptionJob = async (filePath: string): Promise<string> => {
  console.log(`[Mock Transcription] Received request for file: ${filePath}`);
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 5)); // Short delay for job start
  const jobId = `mock-whisper-job-${Date.now()}`;
  const jobStartTime = Date.now();
  mockJobStore.set(jobId, {
      job_id: jobId,
      status: 'queued',
      start_time: jobStartTime,
      duration: 35, // Simulate 35 seconds
      progress: 0,
  });
  console.log(`[Mock Transcription] Created mock job ID: ${jobId}`);

  // Simulate processing in the background
  setTimeout(() => {
      if (mockJobStore.has(jobId)) {
          mockJobStore.set(jobId, { ...mockJobStore.get(jobId)!, status: 'processing', progress: 10 });
          console.log(`[Mock Transcription BG ${jobId}] Status -> processing (10%)`);
      }
  }, MOCK_DELAY_MS / 2);
   setTimeout(() => {
       if (mockJobStore.has(jobId)) {
           mockJobStore.set(jobId, { ...mockJobStore.get(jobId)!, status: 'processing', progress: 65 });
           console.log(`[Mock Transcription BG ${jobId}] Status -> processing (65%)`);
       }
   }, MOCK_DELAY_MS);
  setTimeout(() => {
      if (mockJobStore.has(jobId)) {
           mockJobStore.set(jobId, {
              ...mockJobStore.get(jobId)!,
              status: 'completed',
              progress: 100,
              end_time: Date.now(),
              result: mockTranscriptResult,
           });
          console.log(`[Mock Transcription BG ${jobId}] Status -> completed`);
      }
  }, MOCK_DELAY_MS * 1.5);

  return jobId;
};

export const getTranscriptionStatus = async (jobId: string): Promise<WhisperJobStatus> => {
  console.log(`[Mock Transcription] Checking status for job ID: ${jobId}`);
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 10)); // Very short delay
  const job = mockJobStore.get(jobId);
  if (!job) {
      throw new NotFoundError(`Mock Job ID ${jobId} not found.`);
  }
  // Return a copy, potentially excluding the full result to match API schema for status check
  const { result, ...statusOnly } = job;
  console.log(`[Mock Transcription] Status for ${jobId}: ${statusOnly.status} (${statusOnly.progress}%)`);
  return statusOnly;
};

export const getStructuredTranscriptionResult = async (jobId: string): Promise<StructuredTranscript> => {
  console.log(`[Mock Transcription] Getting structured result for job ID: ${jobId}`);
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS / 10));
  const job = mockJobStore.get(jobId);
  if (!job) {
      throw new NotFoundError(`Mock Job ID ${jobId} not found.`);
  }
  if (job.status !== 'completed') {
      throw new Error(`Mock Job ${jobId} is not completed (status: ${job.status}).`);
  }
  console.log(`[Mock Transcription] Returning mock structured transcript for ${jobId}`);
  return mockTranscriptStructure; // Return the pre-defined structured mock
};
