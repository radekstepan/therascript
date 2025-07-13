// Purpose: Contains the actual implementation for interacting with the
//          external Whisper transcription service (FastAPI endpoint).

import fs from 'node:fs/promises'; // Use promise-based fs for async operations
import path from 'node:path'; // For path manipulation (basename, resolve)
import axios, { AxiosError } from 'axios'; // For making HTTP requests to the Whisper service
import FormData from 'form-data'; // For building multipart/form-data requests to upload the audio file
import config from '../config/index.js'; // Access API configuration (Whisper URL, model)
import { isNodeError } from '../utils/helpers.js'; // Utility type guard for Node.js errors
import {
  InternalServerError,
  ApiError,
  BadRequestError,
  NotFoundError,
} from '../errors.js'; // Custom error classes
import type {
  StructuredTranscript,
  WhisperJobStatus,
  WhisperSegment,
} from '../types/index.js'; // Import type definitions
import { unloadActiveModel } from './ollamaService.js';

// Get Whisper service configuration from the main config
const WHISPER_API_URL = config.whisper.apiUrl;
const WHISPER_MODEL_TO_USE = config.whisper.model;

// Log that the real service is active
console.log('[Real Service] Using Real Transcription Service');

// --- API Health Check ---
/**
 * Checks if the Whisper FastAPI service is reachable and reports healthy.
 * Sends a GET request to the /health endpoint.
 *
 * @returns {Promise<boolean>} True if the service is healthy, false otherwise.
 */
async function checkWhisperApiHealth(): Promise<boolean> {
  try {
    // Log the health check attempt
    console.log(
      `[Real TranscriptionService] Pinging Whisper health at ${WHISPER_API_URL}/health`
    );
    // Make the GET request with a short timeout
    await axios.get(`${WHISPER_API_URL}/health`, { timeout: 3000 });
    console.log(`[Real TranscriptionService] Whisper health check successful.`);
    return true; // Healthy if request succeeds (assuming 2xx status)
  } catch (error) {
    // Handle specific connection errors vs other errors
    if (axios.isAxiosError(error) && error.code === 'ECONNREFUSED') {
      console.warn(
        `[Real TranscriptionService] Whisper health check failed: Connection refused at ${WHISPER_API_URL}.`
      );
    } else {
      console.warn(
        `[Real TranscriptionService] Whisper health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return false; // Unhealthy if any error occurs
  }
}
// --- End API Health Check ---

// --- Helper Function: Group Segments into Paragraphs ---
/**
 * Takes the raw segments from the Whisper result and groups them into logical paragraphs.
 * Logic: Combines segments until a significant pause or sentence-ending punctuation is encountered.
 *
 * @param segments - Array of WhisperSegment objects from the transcription result.
 * @returns A StructuredTranscript array (paragraphs with id, timestamp, text).
 */
function groupSegmentsIntoParagraphs(
  segments: WhisperSegment[]
): StructuredTranscript {
  // Handle empty input
  if (!segments || segments.length === 0) {
    return [];
  }

  const paragraphs: { id: number; timestamp: number; text: string }[] = []; // Initialize paragraphs array
  let currentParagraphText = ''; // Accumulator for the current paragraph's text
  // Initialize start time with the start of the very first segment
  let currentParagraphStartTimeMs = segments[0].start * 1000;
  let paragraphIndex = 0; // Counter for paragraph IDs

  segments.forEach((segment, index) => {
    // Trim individual segment text AFTER checking if it exists, to handle potential empty segments
    const originalSegmentText = segment.text; // Keep original for checks if needed
    const segmentText = originalSegmentText.trim();

    // Process only non-empty segments after trimming
    if (segmentText) {
      if (!currentParagraphText) {
        // First non-empty segment for this paragraph: set start time and text
        currentParagraphStartTimeMs = segment.start * 1000;
        currentParagraphText = segmentText;
      } else {
        // Append subsequent segments with a space separator
        currentParagraphText += ' ';
        currentParagraphText += segmentText;
      }
    }

    // --- Paragraph Splitting Logic ---
    const nextSegment = segments[index + 1];
    // Calculate time gap between current segment end and next segment start (infinity if last segment)
    const timeGapMs = nextSegment
      ? (nextSegment.start - segment.end) * 1000
      : Infinity;
    // Check if the *original* segment text (before potential trimming) ends with punctuation
    const endsWithPunctuation = /[.!?]$/.test(originalSegmentText.trim());

    // Determine if we should end the current paragraph based on:
    // 1. It's the very last segment.
    // 2. There's a long pause (> 1 second) after this segment.
    // 3. It ends with punctuation AND there's a moderate pause (> 0.5 seconds).
    const shouldSplit =
      index === segments.length - 1 ||
      timeGapMs > 1000 ||
      (endsWithPunctuation && timeGapMs > 500);

    // If we should split AND we have accumulated text for the current paragraph, finalize it
    if (shouldSplit && currentParagraphText) {
      paragraphs.push({
        id: paragraphIndex++, // Assign ID and increment
        timestamp: Math.round(currentParagraphStartTimeMs), // Round timestamp
        text: currentParagraphText, // Use the accumulated text
      });
      // Reset for the next paragraph
      currentParagraphText = '';
      // Initialize next paragraph's start time (if there is a next segment)
      currentParagraphStartTimeMs = nextSegment ? nextSegment.start * 1000 : 0;
    }
    // --- End Paragraph Splitting Logic ---
  });

  // Catch any remaining text if the loop finishes while building the last paragraph
  if (currentParagraphText) {
    paragraphs.push({
      id: paragraphIndex,
      timestamp: Math.round(currentParagraphStartTimeMs),
      text: currentParagraphText,
    });
  }

  // Final safety filter to remove any accidentally created empty paragraphs
  return paragraphs.filter((p) => p.text.trim().length > 0);
}
// --- End Helper Function ---

// --- Start Transcription Job ---
/**
 * Submits an audio file to the Whisper service to start a transcription job.
 * Performs a health check first.
 *
 * @param filePath - Path to the audio file to transcribe.
 * @returns A promise resolving to the job ID assigned by the Whisper service.
 * @throws {ApiError} If the Whisper service is unavailable (503).
 * @throws {BadRequestError} If the audio file is not found, not readable, or empty.
 * @throws {InternalServerError} If the job submission fails for other reasons (network, invalid response).
 */
export const startTranscriptionJob = async (
  filePath: string
): Promise<string> => {
  console.log(
    '[Real TranscriptionService] Unloading active Ollama model to free up GPU memory for transcription...'
  );
  try {
    await unloadActiveModel();
    console.log(
      '[Real TranscriptionService] Unload request sent to Ollama service successfully.'
    );
  } catch (error) {
    // Log a warning but don't fail the transcription job.
    // The user should be able to transcribe even if Ollama is unresponsive.
    console.warn(
      '[Real TranscriptionService] Could not unload Ollama model. This might be okay if it was not loaded. Continuing with transcription. Error:',
      error instanceof Error ? error.message : String(error)
    );
  }
  // Resolve to absolute path for clarity and consistency
  const absoluteFilePath = path.resolve(filePath);
  const fileName = path.basename(absoluteFilePath); // Extract filename for logging/form data

  // --- Perform Health Check FIRST ---
  console.log(
    '[Real TranscriptionService] Checking Whisper service availability...'
  );
  const isHealthy = await checkWhisperApiHealth();
  if (!isHealthy) {
    console.error(
      `[Real TranscriptionService] Whisper service at ${WHISPER_API_URL} is not available.`
    );
    // Use a 503 Service Unavailable error if health check fails
    throw new ApiError(
      503,
      `Transcription service is currently unavailable at ${WHISPER_API_URL}. Please ensure it is running and accessible.`
    );
  }
  console.log(
    '[Real TranscriptionService] Whisper service is available. Proceeding with job submission.'
  );
  // --- End Health Check ---

  console.log(
    `[Real TranscriptionService] Requesting transcription job for: ${fileName} via ${WHISPER_API_URL} using model '${WHISPER_MODEL_TO_USE}'`
  );

  let fileHandle; // Use file handle for cleaner resource management
  try {
    // 1. Check file existence and read permissions
    await fs.access(absoluteFilePath, fs.constants.R_OK);
    // 2. Open the file for reading
    fileHandle = await fs.open(absoluteFilePath, 'r');
    // 3. Get file stats (check if empty)
    const stats = await fileHandle.stat();
    if (stats.size === 0) {
      throw new BadRequestError('Audio file is empty.');
    }

    // 4. Prepare form data for upload
    const form = new FormData();
    // Append the file stream
    form.append('file', fileHandle.createReadStream(), { filename: fileName });
    // Append the desired model name
    form.append('model_name', WHISPER_MODEL_TO_USE);

    // 5. Submit the job to the Whisper service
    console.log(
      `[Real TranscriptionService] Sending audio file and model name to ${WHISPER_API_URL}/transcribe ...`
    );
    const submitResponse = await axios.post<{
      job_id: string;
      message: string;
    }>(
      `${WHISPER_API_URL}/transcribe`, // Whisper service endpoint
      form,
      {
        headers: form.getHeaders(), // Get headers from FormData object
        timeout: 60000, // Set a timeout for the upload request (e.g., 60 seconds)
      }
    );

    // 6. Validate the response from Whisper service
    if (submitResponse.status !== 202 || !submitResponse.data.job_id) {
      // Expecting 202 Accepted
      console.error(
        `[Real TranscriptionService] Unexpected response from Whisper submission: ${submitResponse.status}`,
        submitResponse.data
      );
      throw new InternalServerError(
        'Failed to submit transcription job to Whisper service. Invalid response received.'
      );
    }

    // 7. Extract and return the job ID
    const jobId = submitResponse.data.job_id;
    console.log(
      `[Real TranscriptionService] Job submitted successfully. Job ID: ${jobId}`
    );
    return jobId;
  } catch (error: any) {
    // --- Error Handling ---
    console.error(
      '[Real TranscriptionService] Error submitting job to Whisper:',
      error
    );
    // Handle Axios-specific errors
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        // Error response received from Whisper service
        console.error(
          '[Real TranscriptionService] Whisper Submit Error Response:',
          axiosError.response.data
        );
        throw new InternalServerError(
          `Whisper service submission failed: ${axiosError.response.status} ${JSON.stringify(axiosError.response.data)}`,
          error
        );
      } else if (axiosError.request) {
        // Request made but no response received
        throw new InternalServerError(
          'Whisper service did not respond during job submission.',
          error
        );
      } else {
        // Other Axios setup errors
      }
    }
    // Rethrow specific errors if they were thrown earlier (e.g., BadRequestError)
    if (error instanceof ApiError) throw error;
    // Handle file system errors (e.g., file not found)
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new BadRequestError(
        `Audio file not found at path: ${absoluteFilePath}`
      );
    }
    // Fallback for other unexpected errors
    throw new InternalServerError(
      'Failed to submit job to Whisper service.',
      error instanceof Error ? error : undefined
    );
    // --- End Error Handling ---
  } finally {
    // Ensure the file handle is closed, even if errors occurred
    await fileHandle?.close();
  }
};
// --- End Start Transcription Job ---

// --- Get Transcription Status ---
/**
 * Fetches the current status of a specific transcription job from the Whisper service.
 *
 * @param jobId - The ID of the job to check.
 * @returns A promise resolving to the `WhisperJobStatus` object.
 * @throws {BadRequestError} If the jobId is missing.
 * @throws {NotFoundError} If the job ID is not found on the Whisper service (404).
 * @throws {InternalServerError} For network errors or invalid responses from the service.
 */
export const getTranscriptionStatus = async (
  jobId: string
): Promise<WhisperJobStatus> => {
  if (!jobId) throw new BadRequestError('Job ID is required to check status.');

  console.log(
    `[Real TranscriptionService] Checking status for job ${jobId}...`
  );
  try {
    // Make GET request to the status endpoint
    const statusResponse = await axios.get<WhisperJobStatus>(
      `${WHISPER_API_URL}/status/${jobId}`,
      { timeout: 120000 } // CHANGE: Increased timeout to 2 minutes (120,000 ms) to deal with initial model load
    );

    // Basic validation of the response structure
    if (
      !statusResponse.data ||
      !statusResponse.data.job_id ||
      !statusResponse.data.status
    ) {
      console.error(
        `[Real TranscriptionService] Invalid status response for job ${jobId}:`,
        statusResponse.data
      );
      throw new InternalServerError(
        `Invalid status response structure received for job ${jobId}`
      );
    }
    // Return the status data
    return statusResponse.data;
  } catch (error: any) {
    console.error(
      `[Real TranscriptionService] Error polling status for job ${jobId}:`,
      error
    );
    // Handle specific Axios errors
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 404) {
        // Job ID not found on the service
        throw new NotFoundError(
          `Job ID ${jobId} not found on Whisper service.`
        );
      }
      // Handle connection errors
      if (
        axiosError.code === 'ECONNREFUSED' ||
        axiosError.code === 'ENOTFOUND'
      ) {
        throw new InternalServerError(
          `Could not connect to Whisper service at ${WHISPER_API_URL} to check status.`
        );
      }
      // Other network/request errors
      throw new InternalServerError(
        'Network error checking transcription status.',
        error
      );
    }
    // Fallback for non-Axios errors
    throw new InternalServerError(
      'An unexpected error occurred while checking transcription status.',
      error instanceof Error ? error : undefined
    );
  }
};
// --- End Get Transcription Status ---

// --- Get Structured Transcription Result ---
/**
 * Fetches the full result for a *completed* transcription job and structures it into paragraphs.
 *
 * @param jobId - The ID of the completed job.
 * @returns A promise resolving to the `StructuredTranscript`.
 * @throws {NotFoundError} If the job ID is not found.
 * @throws {InternalServerError} If the job is not completed, results are missing, or other errors occur.
 */
export const getStructuredTranscriptionResult = async (
  jobId: string
): Promise<StructuredTranscript> => {
  console.log(
    `[Real TranscriptionService] Fetching and structuring result for completed job ${jobId}...`
  );

  // 1. Get the final job status (this also implicitly checks if the job exists)
  const jobStatus = await getTranscriptionStatus(jobId); // Can throw NotFoundError

  // 2. Check if the job status is 'completed'
  if (jobStatus.status !== 'completed') {
    console.error(
      `[Real TranscriptionService] Cannot get result: Job ${jobId} status is '${jobStatus.status}' (error: ${jobStatus.error || 'none'}).`
    );
    // Throw error if job didn't complete successfully
    throw new InternalServerError(
      `Cannot get result: Job ${jobId} status is '${jobStatus.status}' (error: ${jobStatus.error || 'none'}).`
    );
  }

  // 3. Check if the result and segments exist
  if (!jobStatus.result?.segments) {
    console.warn(
      `[Real TranscriptionService] Job ${jobId} completed but result or segments are missing. Status object:`,
      jobStatus
    );
    throw new InternalServerError(
      'Transcription completed but no segments were returned by the Whisper service.'
    );
  }

  // 4. Group the segments into paragraphs
  console.log(
    `[Real TranscriptionService] Got ${jobStatus.result.segments.length} segments for job ${jobId}. Grouping into paragraphs...`
  );
  const structuredTranscript = groupSegmentsIntoParagraphs(
    jobStatus.result.segments
  );
  console.log(
    `[Real TranscriptionService] Grouped into ${structuredTranscript.length} paragraphs for job ${jobId}.`
  );

  // 5. Return the structured transcript
  return structuredTranscript;
};
// --- End Get Structured Transcription Result ---
