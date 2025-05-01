// Purpose: Handles text tokenization using Tiktoken library.
//          Provides a utility to calculate token counts for text strings.
import { get_encoding, Tiktoken } from '@dqbd/tiktoken'; // Import necessary functions/types from tiktoken

// --- Tokenizer Initialization ---
let tokenizer: Tiktoken | null = null; // Holds the tokenizer instance
// Use cl100k_base encoding, which is standard for many OpenAI models (GPT-3.5, GPT-4, embeddings).
// If using models requiring different encodings, this would need adjustment or dynamic selection.
const ENCODING_NAME = "cl100k_base";

try {
    // Attempt to load the specified encoding.
    tokenizer = get_encoding(ENCODING_NAME);
    console.log(`[TokenizerService] Tiktoken tokenizer ('${ENCODING_NAME}') initialized successfully.`);
} catch (e) {
    // Log a fatal error if initialization fails, as token counting will not work.
    console.error(`[TokenizerService] FATAL: Failed to initialize Tiktoken tokenizer ('${ENCODING_NAME}'):`, e);
    // Ensure tokenizer remains null if initialization fails.
    tokenizer = null;
}
// --- End Tokenizer Initialization ---

/**
 * Calculates the number of tokens for a given text string using the loaded Tiktoken tokenizer.
 *
 * @param text - The input text string to tokenize.
 * @returns The number of tokens calculated, or `null` if the tokenizer is unavailable
 *          or if an error occurs during the encoding process. Returns `0` for empty/nullish input text.
 */
export const calculateTokenCount = (text: string | null | undefined): number | null => {
    // If tokenizer failed to initialize, return null.
    if (!tokenizer) {
        console.warn('[TokenizerService] Tokenizer not available, cannot calculate token count.');
        return null;
    }
    // Handle null, undefined, or empty strings gracefully.
    if (!text) {
        return 0;
    }
    try {
        // Encode the text into tokens.
        const tokens = tokenizer.encode(text);
        // Return the number of tokens.
        return tokens.length;
    } catch (e) {
        // Log errors during encoding (e.g., potentially very large strings or unusual characters).
        console.error('[TokenizerService] Error calculating tokens:', e);
        return null; // Return null on encoding error.
    }
};
