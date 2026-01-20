import { get_encoding, Tiktoken } from '@dqbd/tiktoken';

let tokenizer: Tiktoken | null = null;
const ENCODING_NAME = 'cl100k_base';

try {
  tokenizer = get_encoding(ENCODING_NAME);
  console.log(
    `[TokenizerService] Tiktoken tokenizer ('${ENCODING_NAME}') initialized successfully.`
  );
} catch (e) {
  console.error(
    `[TokenizerService] FATAL: Failed to initialize Tiktoken tokenizer ('${ENCODING_NAME}'):`,
    e
  );
  tokenizer = null;
}

export const calculateTokenCount = (
  text: string | null | undefined
): number | null => {
  if (!tokenizer) {
    console.warn(
      '[TokenizerService] Tokenizer not available, cannot calculate token count.'
    );
    return null;
  }
  if (!text) {
    return 0;
  }
  try {
    const tokens = tokenizer.encode(text);
    return tokens.length;
  } catch (e) {
    console.error('[TokenizerService] Error calculating tokens:', e);
    return null;
  }
};
