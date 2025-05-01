// =========================================
// File: packages/api/src/services/fileService.ts
// =========================================
import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto'; // Import crypto for unique name generation
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
// --- REMOVED StructuredTranscript import as file functions are removed ---
// --- REMOVED Tiktoken imports ---

// --- Keep upload directory ---
const uploadsDir = config.db.uploadsDir;
// --- Remove transcripts directory ---
// const transcriptsDir = config.db.transcriptsDir;

// --- MOVED tokenizer logic to tokenizerService.ts ---


// Helper to create a safe, unique filename
// Example: 123-1678886400000-audio.mp3
const generateUniqueAudioFilename = (sessionId: number, originalFilename: string): string => {
    const timestamp = Date.now();
    const extension = path.extname(originalFilename).toLowerCase();
    // Basic slugify for the ID part (though sessionID is numeric)
    const safeSessionId = String(sessionId).replace(/[^a-z0-9]/gi, '_');
    // Remove potentially problematic characters from extension too
    const safeExtension = extension.replace(/[^a-z0-9.]/gi, '');
    return `${safeSessionId}-${timestamp}${safeExtension}`;
};

// Function to save the uploaded audio file
// Returns the *relative* path (identifier) that should be stored in the DB
export const saveUploadedAudio = async (
    sessionId: number,
    originalFilename: string,
    audioBuffer: Buffer
): Promise<string> => {
    const uniqueFilename = generateUniqueAudioFilename(sessionId, originalFilename);
    const absoluteFilePath = path.join(uploadsDir, uniqueFilename);
    const relativeFilePath = uniqueFilename; // Store just the filename

    console.log(`[FileService] Saving audio for session ${sessionId}: ${originalFilename} -> ${absoluteFilePath}`);
    try {
        // Ensure the uploads directory exists
        await fs.mkdir(uploadsDir, { recursive: true });
        await fs.writeFile(absoluteFilePath, audioBuffer);
        console.log(`[FileService] Audio saved successfully to: ${absoluteFilePath}`);
        return relativeFilePath; // Return the unique filename (relative path)
    } catch (error) {
        console.error(`[FileService] Error saving uploaded audio file for session ${sessionId} (${uniqueFilename}):`, error);
        throw new Error(`Could not save uploaded audio file for session ${sessionId}.`);
    }
};


// --- REMOVED getTranscriptPath ---

// --- FIX: getAudioAbsolutePath expects RELATIVE filename, returns absolute path ---
// Renamed from getTranscriptPath for clarity
const getAudioAbsolutePath = (relativeFilename: string | null): string | null => {
    if (!relativeFilename) return null;
    // Make sure we don't accidentally join an absolute path
    if (path.isAbsolute(relativeFilename)) {
        console.error(`[FileService:getAudioAbsolutePath] Received absolute path '${relativeFilename}' when expecting relative. Returning null.`);
        return null; // Or handle error differently
    }
    const absolutePath = path.resolve(uploadsDir, relativeFilename);
    // --- ADDED SAFETY CHECK ---
    const resolvedUploadsDir = path.resolve(uploadsDir);
    if (!absolutePath.startsWith(resolvedUploadsDir)) {
        console.error(`[FileService:getAudioAbsolutePath] Resolved path '${absolutePath}' is outside the expected uploads directory '${resolvedUploadsDir}'. Aborting.`);
        return null; // Prevent potential path traversal
    }
    // --- END SAFETY CHECK ---
    return absolutePath;
};
// --- End FIX ---


// --- REMOVED loadTranscriptContent ---

// --- REMOVED saveTranscriptContent ---

// --- REMOVED deleteTranscriptFile ---

// Performs a hard delete of the audio file using fs.unlink.
export const deleteUploadedAudioFile = async (relativeAudioIdentifier: string | null): Promise<void> => {
    // Resolve the relative filename to an absolute path first
    const absoluteFilePath = getAudioAbsolutePath(relativeAudioIdentifier);

    if (!absoluteFilePath) {
        console.warn(`[FileService] deleteUploadedAudioFile called with null or invalid relative identifier: ${relativeAudioIdentifier}. Skipping deletion.`);
        return;
    }

    // Safety Check moved to getAudioAbsolutePath
    console.log(`[FileService] Attempting to delete uploaded audio file: ${absoluteFilePath}`);
    try {
        await fs.unlink(absoluteFilePath);
        console.log(`[FileService] Deleted uploaded audio file: ${absoluteFilePath}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`[FileService] Uploaded audio file not found during delete: ${absoluteFilePath}`);
        } else {
            console.error(`[FileService] Error deleting uploaded audio file ${absoluteFilePath}:`, error);
            // Decide whether to re-throw or just log
            throw new Error(`Could not delete uploaded audio file ${absoluteFilePath}.`);
        }
    }
};


// Expose the new function and the helper for resolving paths
export { getAudioAbsolutePath };
