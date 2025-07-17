import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import crypto from 'node:crypto';
import config from '../config/index.js';
import {
  InternalServerError,
  ApiError,
  BadRequestError,
  NotFoundError,
} from '../errors.js';
import type {
  StructuredTranscript,
  WhisperJobStatus,
  WhisperSegment,
  WhisperTranscriptionResult,
} from '../types/index.js';
import { unloadActiveModel } from './ollamaService.js';

const VOXTRAL_API_URL = config.transcription.voxtral.apiUrl;

// In-memory store for completed Voxtral jobs to emulate the async Whisper flow
const voxtralJobStore = new Map<string, WhisperTranscriptionResult>();

console.log('[Real Service] Using Real Voxtral Transcription Service');

export async function checkTranscriptionSvcHealth(): Promise<boolean> {
  try {
    console.log(
      `[Real VoxtralService] Pinging Voxtral/vLLM health at ${VOXTRAL_API_URL}/health`
    );
    await axios.get(`${VOXTRAL_API_URL}/health`, { timeout: 3000 });
    console.log(`[Real VoxtralService] Voxtral/vLLM health check successful.`);
    return true;
  } catch (error) {
    if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
      console.warn(
        `[Real VoxtralService] Health check failed: Connection refused at ${VOXTRAL_API_URL}.`
      );
    } else {
      console.warn(
        `[Real VoxtralService] Health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false;
  }
}

function groupSegmentsIntoParagraphs(
  segments: WhisperSegment[]
): StructuredTranscript {
  if (!segments || segments.length === 0) {
    return [];
  }

  const paragraphs: { id: number; timestamp: number; text: string }[] = [];
  let currentParagraphText = '';
  let currentParagraphStartTimeMs = segments[0].start * 1000;
  let paragraphIndex = 0;

  segments.forEach((segment, index) => {
    const originalSegmentText = segment.text;
    const segmentText = originalSegmentText.trim();

    if (segmentText) {
      if (!currentParagraphText) {
        currentParagraphStartTimeMs = segment.start * 1000;
        currentParagraphText = segmentText;
      } else {
        currentParagraphText += ' ';
        currentParagraphText += segmentText;
      }
    }

    const nextSegment = segments[index + 1];
    const timeGapMs = nextSegment
      ? (nextSegment.start - segment.end) * 1000
      : Infinity;
    const endsWithPunctuation = /[.!?]$/.test(originalSegmentText.trim());

    const shouldSplit =
      index === segments.length - 1 ||
      timeGapMs > 1000 ||
      (endsWithPunctuation && timeGapMs > 500);

    if (shouldSplit && currentParagraphText) {
      paragraphs.push({
        id: paragraphIndex++,
        timestamp: Math.round(currentParagraphStartTimeMs),
        text: currentParagraphText,
      });
      currentParagraphText = '';
      currentParagraphStartTimeMs = nextSegment ? nextSegment.start * 1000 : 0;
    }
  });

  if (currentParagraphText) {
    paragraphs.push({
      id: paragraphIndex,
      timestamp: Math.round(currentParagraphStartTimeMs),
      text: currentParagraphText,
    });
  }

  return paragraphs.filter((p) => p.text.trim().length > 0);
}

export const startTranscriptionJob = async (
  filePath: string
): Promise<string> => {
  console.log(
    '[Voxtral Service] Unloading active Ollama model to free up GPU memory...'
  );
  try {
    await unloadActiveModel();
    console.log(
      '[Voxtral Service] Unload request sent to Ollama service successfully.'
    );
  } catch (error) {
    console.warn(
      `[Voxtral Service] Could not unload Ollama model. This might be okay if it was not loaded. Continuing with transcription. Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const isHealthy = await checkTranscriptionSvcHealth();
  if (!isHealthy) {
    throw new ApiError(
      503,
      `Voxtral transcription service is unavailable at ${VOXTRAL_API_URL}.`
    );
  }

  const fileName = path.basename(filePath);
  console.log(`[Voxtral Service] Transcribing ${fileName} synchronously...`);
  const form = new FormData();
  try {
    const fileBuffer = await fs.readFile(filePath);
    form.append('file', fileBuffer, fileName);
    form.append('model', 'voxtral'); // This is for OpenAI API compatibility; the actual model is fixed in the vLLM server command
    form.append('language', 'en'); // Optional: Voxtral can auto-detect language
    form.append('temperature', '0.0');

    const response = await axios.post(
      `${VOXTRAL_API_URL}/v1/audio/transcriptions`,
      form,
      { headers: form.getHeaders(), timeout: 300000 } // 5 min timeout
    );

    const result: WhisperTranscriptionResult = response.data;
    if (!result || !result.segments) {
      throw new InternalServerError(
        'Transcription result from Voxtral was invalid.'
      );
    }

    const jobId = crypto.randomUUID();
    voxtralJobStore.set(jobId, result);
    console.log(
      `[Voxtral Service] Sync transcription complete. Stored result under temporary Job ID: ${jobId}`
    );

    // Clean up the job after some time to prevent memory leaks
    setTimeout(() => voxtralJobStore.delete(jobId), 5 * 60 * 1000); // 5 minutes

    return jobId;
  } catch (error) {
    console.error('Error during transcription with Voxtral:', error);
    if (axios.isAxiosError(error)) {
      throw new InternalServerError(
        `Voxtral service request failed: ${error.response?.status} ${JSON.stringify(error.response?.data)}`
      );
    }
    throw new InternalServerError(
      'Failed to get transcription from Voxtral service.'
    );
  }
};

export const getTranscriptionStatus = async (
  jobId: string
): Promise<WhisperJobStatus> => {
  if (voxtralJobStore.has(jobId)) {
    return {
      job_id: jobId,
      status: 'completed',
      progress: 100,
      message: 'Transcription complete.',
    };
  }
  // To fit the polling model of the frontend, we shouldn't throw NotFoundError immediately.
  // Instead, we return a 'failed' status to let the poller stop.
  console.warn(
    `[Voxtral Service] Polling for Job ID ${jobId}, but it was not found or has expired.`
  );
  return {
    job_id: jobId,
    status: 'failed',
    error: `Job ID ${jobId} not found or has expired. It may have been a synchronous job that was already processed.`,
  };
};

export const getStructuredTranscriptionResult = async (
  jobId: string
): Promise<StructuredTranscript> => {
  const result = voxtralJobStore.get(jobId);
  if (!result) {
    throw new NotFoundError(
      `Voxtral job result with ID ${jobId} not found or expired.`
    );
  }
  return groupSegmentsIntoParagraphs(result.segments);
};
