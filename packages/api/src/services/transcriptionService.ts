import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data'; // Use form-data library
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
import { InternalServerError, ApiError, BadRequestError } from '../errors.js'; // Import ApiError
import type { StructuredTranscript, TranscriptParagraphData } from '../types/index.js'; // Import new types

// Define expected Whisper API response structure (more detailed)
interface WhisperSegment {
    id: number;
    seek: number;
    start: number; // seconds
    end: number;   // seconds
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
}
interface WhisperTranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  language: string;
}

// Define expected Job status response structure from Whisper service
interface WhisperJobStatus {
    job_id: string;
    status: "queued" | "processing" | "completed" | "failed" | "canceled";
    progress?: number;
    result?: WhisperTranscriptionResult; // Now expects the detailed result
    error?: string;
    start_time?: number;
    end_time?: number;
}

const WHISPER_API_URL = config.whisper.apiUrl;
const POLLING_INTERVAL_MS = 5000; // Check status every 5 seconds
const MAX_POLLING_ATTEMPTS = 120; // ~10 minutes max polling

// --- Helper Function: Group segments into paragraphs ---
// This is a simplified example. Real-world implementation might need more sophisticated logic
// (e.g., analyzing pause durations, sentence structure).
function groupSegmentsIntoParagraphs(segments: WhisperSegment[]): StructuredTranscript {
    if (!segments || segments.length === 0) {
        return [];
    }

    const paragraphs: TranscriptParagraphData[] = [];
    let currentParagraphText = '';
    let currentParagraphStartTimeMs = segments[0].start * 1000; // Initialize with first segment's start time in ms
    let paragraphIndex = 0;

    segments.forEach((segment, index) => {
        const segmentText = segment.text.trim(); // Trim whitespace from segment text

        if (segmentText) { // Only process segments with actual text
            if (!currentParagraphText) {
                // Start of a new paragraph
                currentParagraphStartTimeMs = segment.start * 1000; // Record start time in ms
                currentParagraphText = segmentText;
            } else {
                // Append to the current paragraph
                 // Add a space if the current paragraph doesn't end with punctuation suggesting a sentence end
                 // and the new segment doesn't start with sentence-beginning characteristics.
                 // This is basic; more complex NLP could be used.
                 if (!/[.!?]$/.test(currentParagraphText)) {
                    currentParagraphText += ' ';
                 }
                currentParagraphText += segmentText;
            }
        }

        // Decide when to finalize the current paragraph and start a new one.
        // Example logic: Split if there's a significant gap to the next segment,
        // or maybe based on punctuation + pause (more complex).
        // Simple approach: Treat each segment ending with punctuation as a potential paragraph break,
        // or if there's a noticeable gap.
        const nextSegment = segments[index + 1];
        const timeGapMs = nextSegment ? (nextSegment.start - segment.end) * 1000 : Infinity;
        const endsWithPunctuation = /[.!?]$/.test(segmentText); // Check if the segment ends a sentence

        // Split if:
        // 1. It's the last segment.
        // 2. There's a large gap (e.g., > 1 second) before the next segment.
        // 3. The current segment ends a sentence AND there's a moderate gap (e.g., > 500ms).
        const shouldSplit = index === segments.length - 1 || timeGapMs > 1000 || (endsWithPunctuation && timeGapMs > 500);


        if (shouldSplit && currentParagraphText) {
            paragraphs.push({
                id: paragraphIndex++, // Use the incrementing index as ID
                timestamp: Math.round(currentParagraphStartTimeMs), // Store timestamp in ms
                text: currentParagraphText,
            });
            // Reset for the next paragraph (important!)
            currentParagraphText = '';
            currentParagraphStartTimeMs = nextSegment ? nextSegment.start * 1000 : 0; // Reset start time for potential next paragraph
        }
    });

    // Ensure any remaining text is added if the loop finishes mid-paragraph
    if (currentParagraphText) {
         paragraphs.push({
             id: paragraphIndex,
             timestamp: Math.round(currentParagraphStartTimeMs),
             text: currentParagraphText,
         });
    }

    // Filter out potentially empty paragraphs just in case
    return paragraphs.filter(p => p.text.trim().length > 0);
}
// --- End Helper ---


// Now returns StructuredTranscript
export const transcribeAudio = async (filePath: string): Promise<StructuredTranscript> => {
  const absoluteFilePath = path.resolve(filePath);
  const fileName = path.basename(absoluteFilePath);
  console.log(`[TranscriptionService] Starting structured transcription for: ${fileName} via ${WHISPER_API_URL}`);

  let fileHandle;
  try {
    // Check file exists and is readable
    await fs.access(absoluteFilePath, fs.constants.R_OK);
    fileHandle = await fs.open(absoluteFilePath, 'r');
    const stats = await fileHandle.stat();
    if (stats.size === 0) {
        throw new BadRequestError('Audio file is empty.');
    }

    // Create form data
    const form = new FormData();
    form.append('file', fileHandle.createReadStream(), {
        filename: fileName,
        // ContentType might be needed depending on the server implementation
        // contentType: 'audio/mpeg', // Adjust if needed
    });
    // Optional: Add model selection if whisper service supports it
    // form.append('model_name', 'base');

    // 1. Submit transcription job
    let jobId: string | null = null;
    try {
        console.log(`[TranscriptionService] Sending audio file to ${WHISPER_API_URL}/transcribe ...`);
        const submitResponse = await axios.post<{ job_id: string; message: string }>(
            `${WHISPER_API_URL}/transcribe`,
            form,
            {
                headers: form.getHeaders(),
                // Set a reasonable timeout for the initial upload/submission
                timeout: 60000, // 60 seconds for submission
            }
        );

        if (submitResponse.status !== 202 || !submitResponse.data.job_id) {
            throw new InternalServerError('Failed to submit transcription job to Whisper service. Invalid response.');
        }
        jobId = submitResponse.data.job_id;
        console.log(`[TranscriptionService] Job submitted successfully. Job ID: ${jobId}`);

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
        throw new InternalServerError('Failed to submit job to Whisper service.', error instanceof Error ? error : undefined);
    }

    // 2. Poll for job status
    let attempts = 0;
    while (attempts < MAX_POLLING_ATTEMPTS) {
         attempts++;
         console.log(`[TranscriptionService] Polling status for job ${jobId} (Attempt ${attempts}/${MAX_POLLING_ATTEMPTS})...`);
         await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS)); // Wait before polling

         try {
             // Expecting WhisperJobStatus which includes the detailed result
             const statusResponse = await axios.get<WhisperJobStatus>(`${WHISPER_API_URL}/status/${jobId}`, {
                 timeout: 10000, // 10 seconds timeout for status check
             });
             const jobStatus = statusResponse.data;

             switch (jobStatus.status) {
                 case 'completed':
                     console.log(`[TranscriptionService] Job ${jobId} completed.`);
                     // Check for the result object and segments array
                     if (!jobStatus.result?.segments) {
                         console.warn(`[TranscriptionService] Job ${jobId} completed but result segments are missing.`);
                         throw new InternalServerError('Transcription completed but no segments were returned.');
                     }
                     // TODO report progress via websockets instead of polling
                     console.log(`[TranscriptionService] Transcription successful, got ${jobStatus.result.segments.length} segments for: ${fileName}. Grouping into paragraphs...`);
                     // Process the segments into paragraphs
                     const structuredTranscript = groupSegmentsIntoParagraphs(jobStatus.result.segments);
                     console.log(`[TranscriptionService] Grouped into ${structuredTranscript.length} paragraphs.`);
                     return structuredTranscript; // Return the structured data
                 case 'failed':
                     console.error(`[TranscriptionService] Job ${jobId} failed: ${jobStatus.error || 'Unknown error'}`);
                     throw new InternalServerError(`Transcription failed: ${jobStatus.error || 'Unknown error'}`);
                 case 'canceled':
                     console.warn(`[TranscriptionService] Job ${jobId} was canceled.`);
                     // TODO: How should cancellation be handled? Throw specific error?
                     throw new ApiError(499, 'Transcription job was canceled.'); // 499 Client Closed Request might fit
                 case 'processing':
                     console.log(`[TranscriptionService] Job ${jobId} processing... Progress: ${jobStatus.progress?.toFixed(1) ?? 'N/A'}%`);
                     // Continue polling
                     break;
                 case 'queued':
                     console.log(`[TranscriptionService] Job ${jobId} is queued...`);
                     // Continue polling
                     break;
                 default:
                     console.warn(`[TranscriptionService] Job ${jobId} has unknown status: ${jobStatus.status}`);
                     // Continue polling, maybe add a limit to unknown states?
                     break;
             }

         } catch (error: any) {
             console.error(`[TranscriptionService] Error polling status for job ${jobId}:`, error);
             // Decide if polling should continue or fail based on error type
             if (axios.isAxiosError(error)) {
                 const axiosError = error as AxiosError;
                 if (axiosError.response?.status === 404) {
                    throw new InternalServerError(`Polling failed: Job ID ${jobId} not found.`, error);
                 }
                 // Continue polling on temporary network issues? Maybe add retry logic here.
                 // For now, fail on repeated polling errors.
                 if(attempts > 5 && !axiosError.response) { // Fail after 5 attempts if no response from server
                    throw new InternalServerError(`Polling failed: No response from Whisper status endpoint after ${attempts} attempts.`, error);
                 }
             } else {
                  // Throw for non-axios errors during polling
                  throw new InternalServerError('An unexpected error occurred while polling transcription status.', error instanceof Error ? error : undefined);
             }
         }
     }

     // If loop finishes without completion/failure
     console.error(`[TranscriptionService] Job ${jobId} timed out after ${attempts} polling attempts.`);
     // TODO: Attempt to cancel the job on timeout?
     throw new InternalServerError('Transcription job timed out.');

  } catch (error: any) {
    console.error(`[TranscriptionService] Error in transcribeAudio for ${fileName}:`, error.message);
    if (error instanceof ApiError) throw error; // Re-throw known API errors
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new BadRequestError(`Audio file not found at path: ${absoluteFilePath}`);
    }
    // Wrap other errors
    throw new InternalServerError(`Failed to transcribe audio file ${fileName}.`, error);
  } finally {
      await fileHandle?.close(); // Ensure file handle is closed
  }
};
