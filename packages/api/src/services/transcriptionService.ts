import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
import { InternalServerError, ApiError, BadRequestError } from '../errors.js';
import type {
    StructuredTranscript,
    TranscriptParagraphData,
    WhisperJobStatus,
    WhisperTranscriptionResult,
    // --- FIX: Import from types ---
    WhisperSegment
} from '../types/index.js';

const WHISPER_API_URL = config.whisper.apiUrl;

// --- Helper Function: Group segments into paragraphs (Keep as is) ---
function groupSegmentsIntoParagraphs(segments: WhisperSegment[]): StructuredTranscript {
    if (!segments || segments.length === 0) {
        return [];
    }

    const paragraphs: TranscriptParagraphData[] = [];
    let currentParagraphText = '';
    let currentParagraphStartTimeMs = segments[0].start * 1000;
    let paragraphIndex = 0;

    segments.forEach((segment, index) => {
        const segmentText = segment.text.trim();
        if (segmentText) {
            if (!currentParagraphText) {
                currentParagraphStartTimeMs = segment.start * 1000;
                currentParagraphText = segmentText;
            } else {
                 if (!/[.!?]$/.test(currentParagraphText)) {
                    currentParagraphText += ' ';
                 }
                currentParagraphText += segmentText;
            }
        }

        const nextSegment = segments[index + 1];
        const timeGapMs = nextSegment ? (nextSegment.start - segment.end) * 1000 : Infinity;
        const endsWithPunctuation = /[.!?]$/.test(segmentText);
        const shouldSplit = index === segments.length - 1 || timeGapMs > 1000 || (endsWithPunctuation && timeGapMs > 500);

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
    return paragraphs.filter(p => p.text.trim().length > 0);
}
// --- End Helper ---

// --- NEW: Start Transcription Job ---
export const startTranscriptionJob = async (filePath: string): Promise<string> => {
    const absoluteFilePath = path.resolve(filePath);
    const fileName = path.basename(absoluteFilePath);
    console.log(`[TranscriptionService] Requesting transcription job for: ${fileName} via ${WHISPER_API_URL}`);

    let fileHandle;
    try {
        await fs.access(absoluteFilePath, fs.constants.R_OK);
        fileHandle = await fs.open(absoluteFilePath, 'r');
        const stats = await fileHandle.stat();
        if (stats.size === 0) {
            throw new BadRequestError('Audio file is empty.');
        }

        const form = new FormData();
        form.append('file', fileHandle.createReadStream(), { filename: fileName });

        console.log(`[TranscriptionService] Sending audio file to ${WHISPER_API_URL}/transcribe ...`);
        const submitResponse = await axios.post<{ job_id: string; message: string }>(
            `${WHISPER_API_URL}/transcribe`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 60000, // 60 seconds for submission
            }
        );

        if (submitResponse.status !== 202 || !submitResponse.data.job_id) {
            throw new InternalServerError('Failed to submit transcription job to Whisper service. Invalid response.');
        }
        const jobId = submitResponse.data.job_id;
        console.log(`[TranscriptionService] Job submitted successfully. Job ID: ${jobId}`);
        return jobId;

    } catch (error: any) {
        console.error('[TranscriptionService] Error submitting job to Whisper:', error);
        if (axios.isAxiosError(error)) {
             const axiosError = error as AxiosError;
             if (axiosError.response) {
                  console.error('[TranscriptionService] Whisper Submit Error Response:', axiosError.response.data);
                  throw new InternalServerError(`Whisper service submission failed: ${axiosError.response.status} ${JSON.stringify(axiosError.response.data)}`, error);
             } else if (axiosError.request) {
                  throw new InternalServerError('Whisper service did not respond during job submission.', error);
             }
        }
         if (error instanceof ApiError) throw error;
         if (isNodeError(error) && error.code === 'ENOENT') {
             throw new BadRequestError(`Audio file not found at path: ${absoluteFilePath}`);
         }
        throw new InternalServerError('Failed to submit job to Whisper service.', error instanceof Error ? error : undefined);
    } finally {
        await fileHandle?.close();
    }
};

// --- NEW: Get Transcription Status ---
export const getTranscriptionStatus = async (jobId: string): Promise<WhisperJobStatus> => {
    if (!jobId) throw new BadRequestError("Job ID is required to check status.");
    console.log(`[TranscriptionService] Checking status for job ${jobId}...`);
    try {
        const statusResponse = await axios.get<WhisperJobStatus>(`${WHISPER_API_URL}/status/${jobId}`, {
            timeout: 10000, // 10 seconds timeout for status check
        });
        if (!statusResponse.data || !statusResponse.data.job_id || !statusResponse.data.status) {
            throw new InternalServerError(`Invalid status response structure received for job ${jobId}`);
        }
        return statusResponse.data;
    } catch (error: any) {
        console.error(`[TranscriptionService] Error polling status for job ${jobId}:`, error);
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                throw new InternalServerError(`Job ID ${jobId} not found on Whisper service.`);
            }
             if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                 throw new InternalServerError(`Could not connect to Whisper service at ${WHISPER_API_URL} to check status.`);
             }
              throw new InternalServerError('Network error checking transcription status.', error);
        }
         throw new InternalServerError('An unexpected error occurred while checking transcription status.', error instanceof Error ? error : undefined);
    }
};

// --- NEW: Get Transcription Result and Structure It ---
export const getStructuredTranscriptionResult = async (jobId: string): Promise<StructuredTranscript> => {
    console.log(`[TranscriptionService] Fetching and structuring result for completed job ${jobId}...`);
    const jobStatus = await getTranscriptionStatus(jobId);

    if (jobStatus.status !== 'completed') {
        throw new InternalServerError(`Cannot get result: Job ${jobId} status is '${jobStatus.status}' (error: ${jobStatus.error || 'none'}).`);
    }

    if (!jobStatus.result?.segments) {
        console.warn(`[TranscriptionService] Job ${jobId} completed but result segments are missing.`);
        throw new InternalServerError('Transcription completed but no segments were returned.');
    }

    console.log(`[TranscriptionService] Got ${jobStatus.result.segments.length} segments for job ${jobId}. Grouping into paragraphs...`);
    const structuredTranscript = groupSegmentsIntoParagraphs(jobStatus.result.segments);
    console.log(`[TranscriptionService] Grouped into ${structuredTranscript.length} paragraphs for job ${jobId}.`);
    return structuredTranscript;
};
