import type { BackendChatMessage } from '@therascript/domain';

/**
 * Extract the visible answer from model-generated text by removing
 * `<think>...</think>` reasoning envelopes.
 *
 * Stored reasoning is for display/debugging only; only the visible answer
 * may be reused as prompt context. This helper is the single contract for
 * that rule — chat history sanitization, analysis reduce prompts, and JSON
 * repair all share it.
 *
 * Behavior:
 * - Removes all complete `<think>...</think>` blocks (multiline, repeated,
 *   case-insensitive).
 * - Removes an unclosed opening `<think>` block through the end of the text
 *   (interrupted or legacy responses).
 * - Removes stray closing `</think>` tags left without an opener.
 * - Preserves answer text before and after blocks. When removal would join
 *   two non-whitespace characters into one word, a single space is inserted.
 * - Pure and idempotent: repeated application is safe, and the input is
 *   never mutated.
 *
 * Only the `<think>` envelope observed in provider output and stored chat
 * text is handled. No other delimiters are guessed in untagged prose.
 */
export function extractVisibleAnswer(text: string): string {
  if (!text) return text;

  // Complete blocks: <think>...</think>, case-insensitive, non-greedy.
  const completeRe = /<think>[\s\S]*?<\/think>/gi;
  let result = text.replace(
    completeRe,
    (match, offset: number, whole: string) => {
      const before = offset > 0 ? whole[offset - 1] : undefined;
      const after =
        offset + match.length < whole.length
          ? whole[offset + match.length]
          : undefined;
      if (
        before !== undefined &&
        after !== undefined &&
        !/\s/.test(before) &&
        !/\s/.test(after)
      ) {
        return ' ';
      }
      return '';
    }
  );

  // Unclosed opening block through the end of the text.
  const openIdx = result.search(/<think>/i);
  if (openIdx !== -1) {
    result = result.slice(0, openIdx);
  }

  // Stray closing tags without an opener.
  result = result.replace(
    /<\/think>/gi,
    (match, offset: number, whole: string) => {
      const before = offset > 0 ? whole[offset - 1] : undefined;
      const after =
        offset + match.length < whole.length
          ? whole[offset + match.length]
          : undefined;
      if (
        before !== undefined &&
        after !== undefined &&
        !/\s/.test(before) &&
        !/\s/.test(after)
      ) {
        return ' ';
      }
      return '';
    }
  );

  return result;
}

/** Separator used when normalizing adjacent user turns into one message. */
export const MERGED_USER_TURN_SEPARATOR = '\n\n---\n\n';

/**
 * Prepare stored chat messages for use as LLM prompt context.
 *
 * - Extracts visible answers from `ai` (assistant) messages via
 *   {@link extractVisibleAnswer}.
 * - Omits `ai` messages that become empty after extraction. Thinking is
 *   never replaced with a fabricated answer.
 * - Preserves all `user` questions and `system` messages verbatim:
 *   transcripts, user instructions, and literal quoted tags are source
 *   material, not model-generated reasoning.
 * - Drops leading `ai` messages before the first `user` turn (the initial
 *   welcome message), which strict alternating-role templates reject.
 * - Merges adjacent `user` messages (which arise when an empty assistant
 *   turn between them is removed) into a single user turn with a clear
 *   separator, so strict templates never see `user -> user`.
 *
 * Pure: input objects are never mutated; `ai` messages are shallow-copied
 * with cleaned text and merged user turns are new objects. Idempotent:
 * applying it to already-prepared messages is a no-op.
 */
export function prepareLlmChatMessages(
  messages: BackendChatMessage[]
): BackendChatMessage[] {
  // Clean assistant text (new objects for `ai`, passthrough for others).
  const cleaned: BackendChatMessage[] = [];
  for (const msg of messages) {
    if (msg.sender === 'ai') {
      cleaned.push({ ...msg, text: extractVisibleAnswer(msg.text) });
    } else {
      cleaned.push(msg);
    }
  }

  // Omit reasoning-only assistant turns.
  const nonEmpty = cleaned.filter(
    (msg) => msg.sender !== 'ai' || msg.text.trim().length > 0
  );

  // Drop leading assistant turns before the first user message (welcome
  // messages). Leading system messages are preserved.
  const firstUserIdx = nonEmpty.findIndex((msg) => msg.sender === 'user');
  let trimmed: BackendChatMessage[];
  if (firstUserIdx === -1) {
    trimmed = nonEmpty.filter((msg) => msg.sender === 'system');
  } else {
    const leadingSystems = nonEmpty
      .slice(0, firstUserIdx)
      .filter((msg) => msg.sender === 'system');
    trimmed = [...leadingSystems, ...nonEmpty.slice(firstUserIdx)];
  }

  // Normalize adjacent user turns into a single turn.
  const merged: BackendChatMessage[] = [];
  for (const msg of trimmed) {
    const prev = merged[merged.length - 1];
    if (prev && prev.sender === 'user' && msg.sender === 'user') {
      merged[merged.length - 1] = {
        ...prev,
        text: prev.text + MERGED_USER_TURN_SEPARATOR + msg.text,
      };
    } else {
      merged.push(msg);
    }
  }

  return merged;
}
