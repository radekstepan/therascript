import fs from 'fs/promises';
import path from 'path';
import crypto from 'node:crypto'; // Import crypto for unique name generation
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
import type { StructuredTranscript } from '../types/index.js'; // Import the type
// --- Import Tiktoken class and TiktokenEncoding type ---
import { get_encoding, type Tiktoken, type TiktokenEncoding } from '@dqbd/tiktoken';

const transcriptsDir = config.db.transcriptsDir;
const uploadsDir = config.db.uploadsDir;

// --- Tokenizer Initialization ---
let tokenizer: Tiktoken | null = null; // <-- Changed type to Tiktoken | null
try {
    // Use cl100k_base encoding, common for models like gpt-4, gpt-3.5-turbo, text-embedding-ada-002
    // If using other models, you might need a different encoding.
    tokenizer = get_encoding("cl100k_base");
    console.log('[FileService] Tiktoken tokenizer (cl100k_base) initialized.');
} catch (e) {
    console.error('[FileService] Failed to initialize Tiktoken tokenizer:', e);
    tokenizer = null; // Ensure tokenizer is null if init fails
}
// --- End Tokenizer Initialization ---

// --- Token Calculation Helper ---
// Returns null if tokenizer failed to initialize
const calculateTokenCount = (text: string): number | null => {
    if (!tokenizer) {
        console.warn('[FileService] Tokenizer not available, cannot calculate token count.');
        return null;
    }
    if (!text) {
        return 0;
    }
    try {
        const tokens = tokenizer.encode(text); // <-- This should now work correctly
        return tokens.length;
    } catch (e) {
        console.error('[FileService] Error calculating tokens:', e);
        return null; // Return null on error
    }
};
// Expose the helper for use elsewhere (e.g., sessionHandler)
export { calculateTokenCount };
// --- End Token Calculation Helper ---


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


// --- FIX: getTranscriptPath now expects ID, not a relative path ---
// It constructs the expected ABSOLUTE path within the transcripts directory
const getTranscriptPath = (sessionId: number): string => {
  return path.join(transcriptsDir, `${sessionId}.json`);
};

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


// Loads and parses JSON, returns StructuredTranscript
export const loadTranscriptContent = async (sessionId: number): Promise<StructuredTranscript> => {
  // Use the helper that creates the path based on ID
  const filePath = getTranscriptPath(sessionId);
  console.log(`[FileService DEBUG] Attempting to load transcript from: ${filePath}`); // DEBUG LOG
  try {
    await fs.access(filePath); // Check existence first
    console.log(`[FileService DEBUG] File found: ${filePath}`); // DEBUG LOG
    const fileContent = await fs.readFile(filePath, 'utf-8');
    console.log(`[FileService DEBUG] Raw file content (first 200 chars): "${fileContent.substring(0, 200).replace(/\n/g, '\\n')}"`); // DEBUG LOG
    if (!fileContent.trim()) {
        console.warn(`[FileService] Transcript file for session ${sessionId} is empty.`);
        return [];
    }
    // Parse the JSON content
    const transcriptData = JSON.parse(fileContent) as StructuredTranscript;
     // Basic validation (optional, but good practice)
     if (!Array.isArray(transcriptData)) {
         console.error(`[FileService] Invalid transcript format for session ${sessionId}: Expected an array, got ${typeof transcriptData}.`);
         throw new Error('Invalid transcript format: Expected an array.');
     }
     console.log(`[FileService] Loaded and parsed transcript for session ${sessionId}. Found ${transcriptData.length} paragraphs.`);
     return transcriptData;
  } catch (error: any) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.warn(`[FileService] Transcript file for session ${sessionId} not found at ${filePath}.`);
      return []; // Return empty array if file not found
    }
    if (error instanceof SyntaxError) {
         console.error(`[FileService] Error parsing transcript JSON for session ${sessionId}:`, error);
         // Log snippet of content that failed parsing
         try {
            const contentSnippet = await fs.readFile(filePath, 'utf-8').catch(() => 'Could not read file for snippet');
            console.error(`[FileService DEBUG] Content snippet failing parse (first 200 chars): "${contentSnippet.substring(0,200).replace(/\n/g, '\\n')}"`);
         } catch {}
         throw new Error(`Could not parse transcript ${sessionId}. Invalid JSON format.`);
    }
    console.error(`[FileService] Error loading transcript ${sessionId}:`, error);
    throw new Error(`Could not load transcript ${sessionId}.`);
  }
};

// Saves StructuredTranscript as JSON, returns the relative path stored AND token count
export const saveTranscriptContent = async (
    sessionId: number,
    content: StructuredTranscript
): Promise<{ relativePath: string; tokenCount: number | null }> => { // <-- Return type changed
  // Get the absolute path for saving
  const absoluteFilePath = getTranscriptPath(sessionId);
  // Determine the relative path to store/return (relative to transcriptsDir base)
  const relativeFilePath = `${sessionId}.json`;
  try {
    await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
    // Stringify the structured content with indentation for readability
    const jsonContent = JSON.stringify(content, null, 2);
    await fs.writeFile(absoluteFilePath, jsonContent, 'utf-8');
    console.log(`[FileService] Transcript saved to absolute path: ${absoluteFilePath}`);

    // --- Calculate token count ---
    const fullText = content.map(p => p.text).join('\n\n');
    const tokenCount = calculateTokenCount(fullText);
    console.log(`[FileService] Calculated token count for session ${sessionId}: ${tokenCount ?? 'N/A'}`);
    // --- End Calculation ---

    // Return the relative path and token count
    return { relativePath: relativeFilePath, tokenCount: tokenCount };
  } catch (error) {
    console.error(`[FileService] Error saving transcript ${sessionId}:`, error);
    throw new Error(`Could not save transcript ${sessionId}.`);
  }
};

// Deletes the .json file based on Session ID
export const deleteTranscriptFile = async (sessionId: number): Promise<void> => {
    const filePath = getTranscriptPath(sessionId); // Gets absolute path
    try {
        await fs.unlink(filePath);
        console.log(`[FileService] Deleted transcript file: ${filePath}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          console.warn(`[FileService] Transcript file for session ${sessionId} not found during delete.`);
        } else {
          console.error(`[FileService] Error deleting transcript ${sessionId}:`, error);
          throw new Error(`Could not delete transcript ${sessionId}.`);
        }
    }
};

// --- FIX: deleteUploadedFile now accepts RELATIVE audio identifier for safety ---
// --- Changed function name to reflect it deletes audio ---
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
