import { BackendSession } from '../types/index.js';

// Type guard for file system errors
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

// --- REMOVED transcript file helpers ---
// Function to reliably split transcript into paragraphs
// export const splitTranscriptIntoParagraphs = (transcript: string): string[] => {
//     if (!transcript) return [];
//     return transcript.replace(/\r\n/g, '\n').split(/\n\s*\n/).filter(p => p.trim() !== '');
// };
//
// Function to update a specific paragraph
// export const updateParagraphInTranscript = (transcript: string, index: number, newText: string): string => {
//     const paragraphsWithBlanks = transcript.replace(/\r\n/g, '\n').split(/(\n\s*\n)/);
//     let paragraphIndexInFullSplit = -1;
//     let visibleIndexCounter = -1;
//
//     for (let i = 0; i < paragraphsWithBlanks.length; i += 2) {
//         const contentPart = paragraphsWithBlanks[i];
//         if (contentPart.trim() !== '') {
//             visibleIndexCounter++;
//             if (visibleIndexCounter === index) {
//                 paragraphIndexInFullSplit = i;
//                 break;
//             }
//         }
//     }
//
//     if (paragraphIndexInFullSplit !== -1) {
//         paragraphsWithBlanks[paragraphIndexInFullSplit] = newText.trim();
//         return paragraphsWithBlanks.join('');
//     } else {
//         console.warn(`Paragraph index ${index} not found during update.`);
//         return transcript;
//     }
// };
// --- END REMOVAL ---

// Helper to create session DTO for list views
// Removed transcriptPath from DTO creation
export const createSessionListDTO = (
  session: BackendSession
): Omit<BackendSession, /* 'transcriptPath' | */ 'chats'> => {
  // Selectively pick or omit fields for the DTO
  // This ensures the returned object matches the SessionListResponseItemSchema
  // --- FIX: Remove transcriptPath from destructuring ---
  const { chats, ...dto } = session; // Remove transcriptPath here
  return dto; // Return only the metadata fields expected by the schema
};
