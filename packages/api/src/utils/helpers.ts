// packages/api/src/utils/helpers.ts
import { BackendSession } from '../types/index.js';

// Type guard for file system errors
export const isNodeError = (error: unknown): error is NodeJS.ErrnoException => {
  return error instanceof Error && 'code' in error;
};

/**
 * Cleans common model-specific tokens (like end-of-turn) from LLM output.
 * @param text The raw text from the language model.
 * @returns The cleaned text.
 */
export const cleanLlmOutput = (text: string): string => {
  // Comprehensive list of end-of-turn and similar tokens that might appear in LLM output
  const tokensToRemove = [
    // End of turn tokens
    '</end_of_turn>',
    '<end_of_turn>',
    '<|end_of_turn|>',
    '<|endofturn|>',
    '<|eot_id|>', // Llama 3
    '<|eot|>',
    '<eos>',
    '</s>',
    // Start of turn tokens
    '<start_of_turn>user',
    '<start_of_turn>model',
    '<start_of_turn>assistant',
    '<start_of_turn>',
    '<|start_of_turn|>',
    '<|startofturn|>',
    '<|start_header_id|>', // Llama 3
    '<|end_header_id|>', // Llama 3
    '<|eom_id|>', // Llama 3
    // Other common instruction/system tokens
    '[/INST]',
    '[INST]',
    '<s>',
  ];

  let cleanedText = text;
  for (const token of tokensToRemove) {
    const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedToken, 'gi');
    cleanedText = cleanedText.replace(regex, '');
  }

  // Additional cleanup for common LLM artifacts
  cleanedText = cleanedText
    // Remove multiple spaces that might be left after token removal
    .replace(/\s+/g, ' ')
    // Remove leading/trailing whitespace from each line
    .replace(/^\s+|\s+$/gm, '')
    // Remove multiple consecutive newlines, leaving just one
    .replace(/(\r\n|\n|\r){2,}/g, '\n')
    // Trim final result
    .trim();

  return cleanedText;
};

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
