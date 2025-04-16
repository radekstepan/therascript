// <file path="packages/api/src/services/fileService.ts">
import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js';
import { isNodeError } from '../utils/helpers.js';
import type { StructuredTranscript } from '../types/index.js'; // Import the type

const transcriptsDir = config.db.transcriptsDir;
const uploadsDir = config.db.uploadsDir;

// Now uses .json extension
const getTranscriptPath = (sessionId: number): string => {
  return path.join(transcriptsDir, `${sessionId}.json`);
};

// Loads and parses JSON, returns StructuredTranscript
export const loadTranscriptContent = async (sessionId: number): Promise<StructuredTranscript> => {
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

// Saves StructuredTranscript as JSON
export const saveTranscriptContent = async (sessionId: number, content: StructuredTranscript): Promise<string> => {
  const filePath = getTranscriptPath(sessionId);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Stringify the structured content with indentation for readability
    const jsonContent = JSON.stringify(content, null, 2);
    await fs.writeFile(filePath, jsonContent, 'utf-8');
    console.log(`[FileService] Transcript saved: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`[FileService] Error saving transcript ${sessionId}:`, error);
    throw new Error(`Could not save transcript ${sessionId}.`);
  }
};

// Deletes the .json file
export const deleteTranscriptFile = async (sessionId: number): Promise<void> => {
    const filePath = getTranscriptPath(sessionId);
    try {
        await fs.unlink(filePath);
        console.log(`[FileService] Deleted transcript file: ${filePath}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          console.warn(`[FileService] Transcript ${sessionId} not found during delete.`);
        } else {
          console.error(`[FileService] Error deleting transcript ${sessionId}:`, error);
          throw new Error(`Could not delete transcript ${sessionId}.`);
        }
    }
};

export const deleteUploadedFile = async (filePath: string): Promise<void> => {
    // Ensure filePath is within the expected uploads directory for safety
    const resolvedUploadsDir = path.resolve(uploadsDir);
    const resolvedFilePath = path.resolve(filePath);

    if (!resolvedFilePath.startsWith(resolvedUploadsDir)) {
        console.error(`[FileService] Attempted to delete unsafe path outside uploads directory: ${filePath}`);
        return; // Do not proceed if path seems unsafe
    }
    if (!filePath) {
         console.warn('[FileService] deleteUploadedFile called with empty filePath.');
         return;
    }
    try {
        await fs.unlink(resolvedFilePath);
        console.log(`[FileService] Deleted uploaded audio file: ${resolvedFilePath}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`[FileService] Uploaded file not found during delete: ${resolvedFilePath}`);
        } else {
            console.error(`[FileService] Error deleting uploaded file ${resolvedFilePath}:`, error);
            // Decide whether to re-throw or just log
            // throw new Error(`Could not delete uploaded file ${filePath}.`);
        }
    }
};
// </file>
