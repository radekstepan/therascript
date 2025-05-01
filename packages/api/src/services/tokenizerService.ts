// =========================================
// File: packages/api/src/services/tokenizerService.ts
// NEW FILE
// =========================================
/* packages/api/src/services/tokenizerService.ts */
// Handles text tokenization using Tiktoken.
import { get_encoding, Tiktoken } from '@dqbd/tiktoken';

// --- Tokenizer Initialization ---
let tokenizer: Tiktoken | null = null;
const ENCODING_NAME = "cl100k_base"; // Common encoding

try {
    // Use cl100k_base encoding, common for models like gpt-4, gpt-3.5-turbo, text-embedding-ada-002
    // If using other models, you might need a different encoding.
    tokenizer = get_encoding(ENCODING_NAME);
    console.log(`[TokenizerService] Tiktoken tokenizer ('${ENCODING_NAME}') initialized successfully.`);
} catch (e) {
    console.error(`[TokenizerService] FATAL: Failed to initialize Tiktoken tokenizer ('${ENCODING_NAME}'):`, e);
    tokenizer = null; // Ensure tokenizer is null if init fails
}

/**
 * Calculates the number of tokens for a given text string.
 * Returns null if the tokenizer is unavailable or if an error occurs during encoding.
 * @param text - The input text string.
 * @returns The number of tokens, or null if calculation fails.
 */
export const calculateTokenCount = (text: string): number | null => {
    if (!tokenizer) {
        console.warn('[TokenizerService] Tokenizer not available, cannot calculate token count.');
        return null;
    }
    if (!text) { return 0; }
    try {
        const tokens = tokenizer.encode(text);
        return tokens.length;
    } catch (e) { console.error('[TokenizerService] Error calculating tokens:', e); return null; }
};
