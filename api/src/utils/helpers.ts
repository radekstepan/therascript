// src/utils/helpers.ts
import { BackendSession } from "../types"; // Relative
import fs from 'fs/promises';
import path from 'path';

// Simple ID generator (replace with UUID in production if needed) - Less needed with SQLite AUTOINCREMENT
// export const generateId = (): number => Date.now() + Math.floor(Math.random() * 1000);

// Type guard for file system errors
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

// Function to reliably split transcript into paragraphs
export const splitTranscriptIntoParagraphs = (transcript: string): string[] => {
    if (!transcript) return [];
    return transcript
        .replace(/\r\n/g, '\n') // Normalize line breaks
        .split(/\n\s*\n/)       // Split on one or more blank lines
        .filter(p => p.trim() !== ''); // Remove empty paragraphs
};

// Function to update a specific paragraph
export const updateParagraphInTranscript = (
    transcript: string,
    index: number,
    newText: string
): string => {
    const paragraphsWithBlanks = transcript
        .replace(/\r\n/g, '\n')
        .split(/(\n\s*\n)/); // Split but keep delimiters

    let paragraphIndexInFullSplit = -1;
    let visibleIndexCounter = -1;

    // Find the correct index in the array that includes blank lines/delimiters
    for (let i = 0; i < paragraphsWithBlanks.length; i += 2) { // Step by 2 (content + delimiter)
        const contentPart = paragraphsWithBlanks[i];
        if (contentPart.trim() !== '') {
            visibleIndexCounter++;
            if (visibleIndexCounter === index) {
                paragraphIndexInFullSplit = i;
                break;
            }
        }
    }

    if (paragraphIndexInFullSplit !== -1) {
        paragraphsWithBlanks[paragraphIndexInFullSplit] = newText.trim(); // Update with trimmed text
        return paragraphsWithBlanks.join(''); // Join back together
    } else {
        console.warn(`Paragraph index ${index} not found during update. Returning original transcript.`);
        return transcript; // Return original if index mapping failed
    }
};

// Helper to create session DTO (Data Transfer Object) for listing
export const createSessionListDTO = (session: BackendSession): Partial<BackendSession> => {
    // Exclude transcriptPath and chats which are not needed for list view
    const { transcriptPath, chats, ...dto } = session;
    return dto;
};
