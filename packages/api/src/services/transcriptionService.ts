import fs from 'node:fs/promises';
import path from 'node:path';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import config from '../config/index.js'; // Import config
import { isNodeError } from '../utils/helpers.js';
// --- FIX: Import NotFoundError ---
import { InternalServerError, ApiError, BadRequestError, NotFoundError } from '../errors.js';
// --- END FIX ---
import type {
    StructuredTranscript,
    WhisperJobStatus,
    WhisperSegment
} from '../types/index.js';
import { exec as callbackExec } from 'node:child_process'; // <-- Import exec
import * as util from 'node:util';
import * as fsSync from 'node:fs'; // For checking compose file
// --- FIX: Import fileURLToPath ---
import { fileURLToPath } from 'node:url';
// --- END FIX ---

const exec = util.promisify(callbackExec); // <-- Promisify exec


const WHISPER_API_URL = config.whisper.apiUrl;
const WHISPER_MODEL_TO_USE = config.whisper.model; // Get model from config

// --- Docker Management Logic for Whisper ---
const ROOT_DIR = path.resolve(fileURLToPath(import.meta.url), '../../../..'); // Navigate up to project root
const ROOT_COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.yml');
const WHISPER_SERVICE_NAME = 'whisper'; // Match service name in root compose file

// Helper to run docker compose commands for the root file
async function runRootComposeCommand(command: string): Promise<string> {
    if (!fsSync.existsSync(ROOT_COMPOSE_FILE)) {
        console.error(`[Whisper Docker] Root compose file not found at: ${ROOT_COMPOSE_FILE}`);
        throw new InternalServerError(`Root docker-compose.yml not found at ${ROOT_COMPOSE_FILE}`);
    }
    // Use -p <project_name> to avoid conflicts if other compose files are used
    const projectName = path.basename(ROOT_DIR).replace(/[^a-z0-9]/gi, ''); // Simple project name from dir
    const composeCommand = `docker compose -p ${projectName} -f "${ROOT_COMPOSE_FILE}" ${command}`;
    console.log(`[Whisper Docker] Running: ${composeCommand}`);
    try {
        const { stdout, stderr } = await exec(composeCommand);
        if (stderr && !stderr.toLowerCase().includes("warn") && !stderr.toLowerCase().includes("found orphan containers")) {
            console.warn(`[Whisper Docker] Compose stderr: ${stderr}`);
        }
        return stdout.trim();
    } catch (error: any) {
        console.error(`[Whisper Docker] Error executing: ${composeCommand}`);
        if (error.stderr) console.error(`[Whisper Docker] Stderr: ${error.stderr}`);
        if (error.stdout) console.error(`[Whisper Docker] Stdout: ${error.stdout}`);
        throw new InternalServerError(`Failed to run Whisper Docker Compose command: ${command}. Error: ${error.message}`);
    }
}

// Check if the Whisper container is running
async function isWhisperContainerRunning(): Promise<boolean> {
    try {
        const containerId = await runRootComposeCommand(`ps -q ${WHISPER_SERVICE_NAME}`);
        return !!containerId;
    } catch (error: any) {
        console.warn(`[Whisper Docker] Error checking running status (likely not running): ${error.message}`);
        return false;
    }
}

// Check if the Whisper API is responsive
async function isWhisperApiResponsive(): Promise<boolean> {
    try {
        await axios.get(`${WHISPER_API_URL}/health`, { timeout: 3000 });
        return true;
    } catch (error) {
        return false;
    }
}

// Ensure Whisper service is running and healthy
export async function ensureWhisperReady(timeoutMs = 90000): Promise<void> { // Increased timeout for model loading
    console.log("[Whisper Docker] Ensuring Whisper service is ready...");
    if (await isWhisperContainerRunning() && await isWhisperApiResponsive()) {
        console.log("[Whisper Docker] ✅ Whisper container running and API responsive.");
        return;
    }

    if (!(await isWhisperContainerRunning())) {
        console.log("[Whisper Docker] 🅾️ Whisper container not running. Attempting to start...");
        try {
            // Use --remove-orphans to clean up potential stale containers
            await runRootComposeCommand(`up -d --remove-orphans ${WHISPER_SERVICE_NAME}`);
            console.log(`[Whisper Docker] 'docker compose up -d whisper' command issued.`);
        } catch (startError: any) {
            console.error("[Whisper Docker] ❌ Failed to issue start command for Whisper service:", startError);
            throw new InternalServerError("Failed to start Whisper Docker service.", startError);
        }
    } else {
        console.log("[Whisper Docker] Container process found, but API was not responsive. Waiting...");
    }

    // Wait for API to become responsive (health check)
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
        console.log("[Whisper Docker] ⏳ Waiting for Whisper API (/health) to become responsive...");
        if (await isWhisperApiResponsive()) {
            console.log("[Whisper Docker] ✅ Whisper API is now responsive.");
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }

    console.error(`[Whisper Docker] ❌ Whisper API did not become responsive within ${timeoutMs / 1000} seconds.`);
    throw new InternalServerError(`Whisper service started but API did not respond within timeout.`);
}

// Function to stop the Whisper service (optional, could be called after jobs)
export async function stopWhisperService(): Promise<void> {
    console.log("[Whisper Docker] Attempting to stop Whisper service...");
    try {
        await runRootComposeCommand(`down`); // Use down to stop and remove
        console.log("[Whisper Docker] ✅ Whisper service stopped.");
    } catch (error: any) {
        console.error("[Whisper Docker] ❌ Failed to stop Whisper service:", error);
        // Decide if this should throw or just warn
        // throw new InternalServerError("Failed to stop Whisper Docker service.", error);
    }
}
// --- End Docker Management Logic ---


// --- Helper Function: Group segments into paragraphs (Corrected) ---
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
// --- End Helper ---

// --- Start Transcription Job ---
export const startTranscriptionJob = async (filePath: string): Promise<string> => {
    const absoluteFilePath = path.resolve(filePath);
    const fileName = path.basename(absoluteFilePath);

    // --- Ensure Whisper is Ready ---
    try {
         await ensureWhisperReady();
         console.log(`[TranscriptionService] Whisper service is ready. Proceeding with job submission for: ${fileName}`);
    } catch (error) {
         console.error(`[TranscriptionService] Could not ensure Whisper service readiness before starting job.`, error);
         // Propagate the error (already likely an InternalServerError)
         throw error;
    }
    // --- End Ensure Whisper ---

    console.log(`[TranscriptionService] Requesting transcription job for: ${fileName} via ${WHISPER_API_URL} using model '${WHISPER_MODEL_TO_USE}'`); // Log model

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
        // *** ADD model_name to the form data ***
        form.append('model_name', WHISPER_MODEL_TO_USE);

        console.log(`[TranscriptionService] Sending audio file and model name to ${WHISPER_API_URL}/transcribe ...`);
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

// --- Get Transcription Status (Fixed NotFoundError import) ---
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
                 // Don't throw InternalServerError here, the job might just not exist
                 console.warn(`[TranscriptionService] Job ID ${jobId} not found on Whisper service.`);
                 throw new NotFoundError(`Job ID ${jobId} not found on Whisper service.`); // <-- Use imported NotFoundError
                // throw new InternalServerError(`Job ID ${jobId} not found on Whisper service.`);
            }
             if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
                 throw new InternalServerError(`Could not connect to Whisper service at ${WHISPER_API_URL} to check status.`);
             }
              throw new InternalServerError('Network error checking transcription status.', error);
        }
         throw new InternalServerError('An unexpected error occurred while checking transcription status.', error instanceof Error ? error : undefined);
    }
};

// --- Get Structured Transcription Result (No change needed) ---
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