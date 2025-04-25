/* (NEW FILE) packages/api/src/services/transcriptionService.real.ts */
// Contains the original, real implementation of transcriptionService.ts

// --- Keep original imports ---
import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
import { InternalServerError, ApiError, BadRequestError, NotFoundError } from '../errors.js';
import type {
    StructuredTranscript,
    WhisperJobStatus,
    WhisperSegment
} from '../types/index.js';

const WHISPER_API_URL = config.whisper.apiUrl;
const WHISPER_MODEL_TO_USE = config.whisper.model;

console.log('[Real Service] Using Real Transcription Service'); // Identify real service

// --- Keep original API Health Check Logic ---
async function checkWhisperApiHealth(): Promise<boolean> {
    try {
        console.log(`[Real TranscriptionService] Pinging Whisper health at ${WHISPER_API_URL}/health`);
        await axios.get(`${WHISPER_API_URL}/health`, { timeout: 3000 });
        console.log(`[Real TranscriptionService] Whisper health check successful.`);
        return true;
    } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
             console.warn(`[Real TranscriptionService] Whisper health check failed: Connection refused.`);
        } else {
             console.warn(`[Real TranscriptionService] Whisper health check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return false;
    }
}

// --- Keep original Helper Function: Group segments into paragraphs ---
function groupSegmentsIntoParagraphs(segments: WhisperSegment[]): StructuredTranscript {
     if (!segments || segments.length === 0) {
        return [];
    }
    const paragraphs: { id: number; timestamp: number; text: string }[] = [];
    let currentParagraphText = '';
    // Initialize with the start time of the very first segment
    let currentParagraphStartTimeMs = segments[0].start * 1000;
    let paragraphIndex = 0;

    segments.forEach((segment, index) => {
        // Trim individual segment text AFTER checking if it exists
        const originalSegmentText = segment.text; // Keep original for checks if needed, though trim is usually fine
        const segmentText = originalSegmentText.trim();

        if (segmentText) { // Only process non-empty segments after trimming
            if (!currentParagraphText) {
                // This is the first non-empty segment for this paragraph
                currentParagraphStartTimeMs = segment.start * 1000; // Set start time
                currentParagraphText = segmentText;
            } else {
                // *** CORRECTED LOGIC ***
                // Always add a space before appending subsequent segments within the same paragraph
                currentParagraphText += ' ';
                currentParagraphText += segmentText;
            }
        }

        // Paragraph splitting logic
        const nextSegment = segments[index + 1];
        const timeGapMs = nextSegment ? (nextSegment.start - segment.end) * 1000 : Infinity;
        // Use original text to check punctuation before trimming might remove it
        const endsWithPunctuation = /[.!?]$/.test(originalSegmentText.trim());
        // Determine if we should end the current paragraph
        const shouldSplit = index === segments.length - 1 // Last segment overall
                          || timeGapMs > 1000             // Long pause after this segment
                          || (endsWithPunctuation && timeGapMs > 500); // Ends with punctuation AND a moderate pause

        // If we should split AND we have accumulated text, finalize the paragraph
        if (shouldSplit && currentParagraphText) {
            paragraphs.push({
                id: paragraphIndex++,
                timestamp: Math.round(currentParagraphStartTimeMs),
                text: currentParagraphText // Use the accumulated text
            });
            // Reset for the next paragraph
            currentParagraphText = '';
             // Initialize next paragraph's start time (if there is a next segment)
            currentParagraphStartTimeMs = nextSegment ? nextSegment.start * 1000 : 0;
        }
    });

     // In case the loop finishes while building a paragraph (e.g., last segment didn't trigger split)
     if (currentParagraphText) {
        paragraphs.push({
            id: paragraphIndex,
            timestamp: Math.round(currentParagraphStartTimeMs),
            text: currentParagraphText
        });
     }

    // Final filter just in case empty paragraphs were somehow created
    return paragraphs.filter(p => p.text.trim().length > 0);
}

// --- Keep original Start Transcription Job ---
export const startTranscriptionJob = async (filePath: string): Promise<string> => {
    const absoluteFilePath = path.resolve(filePath);
    const fileName = path.basename(absoluteFilePath);

    // --- Perform Health Check FIRST ---
    console.log('[Real TranscriptionService] Checking Whisper service availability...');
    const isHealthy = await checkWhisperApiHealth();
    if (!isHealthy) {
        console.error(`[Real TranscriptionService] Whisper service at ${WHISPER_API_URL} is not available.`);
        // Use a 503 Service Unavailable error
        throw new ApiError(503, `Transcription service is currently unavailable at ${WHISPER_API_URL}. Please ensure it is running.`);
    }
    console.log('[Real TranscriptionService] Whisper service is available. Proceeding with job submission.');
    // --- End Health Check ---

    console.log(`[Real TranscriptionService] Requesting transcription job for: ${fileName} via ${WHISPER_API_URL} using model '${WHISPER_MODEL_TO_USE}'`);

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
        form.append('model_name', WHISPER_MODEL_TO_USE);

        console.log(`[Real TranscriptionService] Sending audio file and model name to ${WHISPER_API_URL}/transcribe ...`);
        const submitResponse = await axios.post<{ job_id: string; message: string }>(
            `${WHISPER_API_URL}/transcribe`,
            form,
            {
                headers: form.getHeaders(),
                timeout: 60000,
            }
        );

        if (submitResponse.status !== 202 || !submitResponse.data.job_id) {
            throw new InternalServerError('Failed to submit transcription job to Whisper service. Invalid response.');
        }
        const jobId = submitResponse.data.job_id;
        console.log(`[Real TranscriptionService] Job submitted successfully. Job ID: ${jobId}`);
        return jobId;

    } catch (error: any) {
        // Keep existing error handling
        console.error('[Real TranscriptionService] Error submitting job to Whisper:', error);
        if (axios.isAxiosError(error)) {
             const axiosError = error as AxiosError;
             if (axiosError.response) {
                  console.error('[Real TranscriptionService] Whisper Submit Error Response:', axiosError.response.data);
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

// --- Keep original getTranscriptionStatus ---
export const getTranscriptionStatus = async (jobId: string): Promise<WhisperJobStatus> => {
     if (!jobId) throw new BadRequestError("Job ID is required to check status.");
    console.log(`[Real TranscriptionService] Checking status for job ${jobId}...`);
    try {
        const statusResponse = await axios.get<WhisperJobStatus>(`${WHISPER_API_URL}/status/${jobId}`, { timeout: 10000 });
        if (!statusResponse.data || !statusResponse.data.job_id || !statusResponse.data.status) { throw new InternalServerError(`Invalid status response structure received for job ${jobId}`); }
        return statusResponse.data;
    } catch (error: any) {
        console.error(`[Real TranscriptionService] Error polling status for job ${jobId}:`, error);
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) { throw new NotFoundError(`Job ID ${jobId} not found on Whisper service.`); }
             if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') { throw new InternalServerError(`Could not connect to Whisper service at ${WHISPER_API_URL} to check status.`); }
              throw new InternalServerError('Network error checking transcription status.', error);
        }
         throw new InternalServerError('An unexpected error occurred while checking transcription status.', error instanceof Error ? error : undefined);
    }
};

// --- Keep original getStructuredTranscriptionResult ---
export const getStructuredTranscriptionResult = async (jobId: string): Promise<StructuredTranscript> => {
    console.log(`[Real TranscriptionService] Fetching and structuring result for completed job ${jobId}...`);
    const jobStatus = await getTranscriptionStatus(jobId);
    if (jobStatus.status !== 'completed') { throw new InternalServerError(`Cannot get result: Job ${jobId} status is '${jobStatus.status}' (error: ${jobStatus.error || 'none'}).`); }
    if (!jobStatus.result?.segments) { console.warn(`[Real TranscriptionService] Job ${jobId} completed but result segments are missing.`); throw new InternalServerError('Transcription completed but no segments were returned.'); }
    console.log(`[Real TranscriptionService] Got ${jobStatus.result.segments.length} segments for job ${jobId}. Grouping into paragraphs...`);
    const structuredTranscript = groupSegmentsIntoParagraphs(jobStatus.result.segments);
    console.log(`[Real TranscriptionService] Grouped into ${structuredTranscript.length} paragraphs for job ${jobId}.`);
    return structuredTranscript;
};
