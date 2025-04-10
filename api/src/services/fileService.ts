// src/services/fileService.ts
import fs from 'fs/promises';
import path from 'path';
import config from '../config/index.js'; // ADDED .js
import { isNodeError } from '../utils/helpers.js'; // ADDED .js

const transcriptsDir = config.db.transcriptsDir;
const uploadsDir = config.db.uploadsDir;

const getTranscriptPath = (sessionId: number): string => {
  return path.join(transcriptsDir, `${sessionId}.txt`);
};

export const loadTranscriptContent = async (sessionId: number): Promise<string> => {
  const filePath = getTranscriptPath(sessionId);
  try {
    await fs.access(filePath);
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    // --- Use isNodeError ---
    if (isNodeError(error) && error.code === 'ENOENT') {
      console.warn(`[FileService] Transcript file for session ${sessionId} not found.`);
      return ''; // Return empty string if not found
    }
    // --- End Use ---
    console.error(`[FileService] Error loading transcript ${sessionId}:`, error);
    throw new Error(`Could not load transcript ${sessionId}.`);
  }
};

export const saveTranscriptContent = async (sessionId: number, content: string): Promise<string> => {
  const filePath = getTranscriptPath(sessionId);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`[FileService] Transcript saved: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error(`[FileService] Error saving transcript ${sessionId}:`, error);
    throw new Error(`Could not save transcript ${sessionId}.`);
  }
};

export const deleteTranscriptFile = async (sessionId: number): Promise<void> => {
    const filePath = getTranscriptPath(sessionId);
    try {
        await fs.unlink(filePath);
        console.log(`[FileService] Deleted transcript file: ${filePath}`);
    } catch (error) {
        // --- Use isNodeError ---
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`[FileService] Transcript ${sessionId} not found during delete.`);
        } else {
        // --- End Use ---
            console.error(`[FileService] Error deleting transcript ${sessionId}:`, error);
            throw new Error(`Could not delete transcript ${sessionId}.`);
        }
    }
};

export const deleteUploadedFile = async (filePath: string): Promise<void> => {
    if (!filePath || !filePath.startsWith(uploadsDir)) { // Basic safety check
        console.error(`[FileService] Attempted to delete invalid/unsafe path: ${filePath}`);
        return;
    }
    try {
        await fs.unlink(filePath);
        console.log(`[FileService] Deleted uploaded audio file: ${filePath}`);
    } catch (error) {
        // --- Use isNodeError ---
        if (isNodeError(error) && error.code === 'ENOENT') {
            console.warn(`[FileService] Uploaded file not found during delete: ${filePath}`);
        } else {
        // --- End Use ---
            console.error(`[FileService] Error deleting uploaded file ${filePath}:`, error);
            // Decide whether to throw, depends on context
        }
    }
};
