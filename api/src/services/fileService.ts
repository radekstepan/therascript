// src/services/fileService.ts
import fs from 'fs/promises';
import path from 'path';
import config from '../config'; // Relative
import { isNodeError } from '../utils/helpers'; // Relative

const transcriptsDir = config.db.transcriptsDir;
const uploadsDir = config.db.uploadsDir; // Use configured uploads dir

const getTranscriptPath = (sessionId: number): string => {
  // Use .txt extension for transcripts
  return path.join(transcriptsDir, `${sessionId}.txt`);
};

export const loadTranscriptContent = async (sessionId: number): Promise<string> => {
  const filePath = getTranscriptPath(sessionId);
  try {
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.warn(`Transcript file for session ${sessionId} not found.`);
      return ''; // Return empty string if transcript doesn't exist
    }
    console.error(`Error loading transcript for session ${sessionId}:`, error);
    throw new Error(`Could not load transcript for session ${sessionId}.`);
  }
};

export const saveTranscriptContent = async (sessionId: number, content: string): Promise<string> => {
  const filePath = getTranscriptPath(sessionId);
  try {
    // Ensure directory exists (redundant check, done at startup, but safe)
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`Transcript saved to: ${filePath}`);
    return filePath; // Return the path where it was saved
  } catch (error) {
    console.error(`Error saving transcript for session ${sessionId}:`, error);
    throw new Error(`Could not save transcript for session ${sessionId}.`);
  }
};

export const deleteTranscriptFile = async (sessionId: number): Promise<void> => {
    const filePath = getTranscriptPath(sessionId);
    try {
        await fs.unlink(filePath);
        console.log(`Deleted transcript file for session ${sessionId}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`Transcript file for session ${sessionId} not found during delete.`);
            // Ignore if file doesn't exist
        } else {
            console.error(`Error deleting transcript for session ${sessionId}:`, error);
            throw new Error(`Could not delete transcript for session ${sessionId}.`);
        }
    }
};

// Function to delete the temporary uploaded audio file from uploadsDir
export const deleteUploadedFile = async (filePath: string): Promise<void> => {
    // Ensure the path is within the expected uploads directory for safety
    if (!filePath.startsWith(uploadsDir)) {
        console.error(`Attempted to delete file outside uploads directory: ${filePath}`);
        return; // Or throw an error
    }
    try {
        await fs.unlink(filePath);
        console.log(`Deleted uploaded audio file: ${filePath}`);
    } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`Attempted to delete non-existent uploaded file: ${filePath}`);
        } else {
            console.error(`Error deleting uploaded file ${filePath}:`, error);
            // Decide if this should throw an error or just log
        }
    }
};
