// packages/services/src/transcriptContext.ts
//
// Shared preamble injected into every LLM system prompt that reasons about
// a session transcript. It tells the model (a) how many speakers the
// session was recorded with (the explicit `numSpeakers` choice made at
// upload — never derived), and (b) that the transcript is pure text with
// no non-verbal communication, so emotional states must not be invented.

/**
 * Build the per-session transcript context note prepended to LLM system
 * prompts (session chat, analysis map phase, verification judge).
 *
 * `numSpeakers` is the explicit upload-time choice:
 *   - >= 2: diarization enabled for that many speakers.
 *   - 0, 1, null, undefined: diarization disabled or unspecified — the
 *     number of distinct voices is unknown.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function buildTranscriptSessionNote(
  numSpeakers?: number | null
): string {
  const speakerClause =
    typeof numSpeakers === 'number' &&
    Number.isInteger(numSpeakers) &&
    numSpeakers >= 2
      ? `This session transcript involves ${numSpeakers} speakers (speaker count specified at upload; includes all participants).`
      : `Speaker count for this session was not specified at upload (diarization disabled or unknown), so the number of distinct voices is unknown.`;

  return (
    `SESSION CONTEXT:\n` +
    `- ${speakerClause}\n` +
    `- The transcript below is a pure text transcription only. It contains no non-verbal communication ` +
    `(tone of voice, facial expressions, body language, emotional displays). ` +
    `Do not infer emotions, attitudes, or non-verbal states (e.g. "angry", "upset", "crying") ` +
    `unless they are explicitly stated in the spoken words themselves.\n` +
    `- The therapist's own session notes, when provided, appear in a THERAPIST NOTES block before the transcript ` +
    `(the therapist may also add observations in follow-up questions, e.g. stating that someone was angry). ` +
    `Treat such therapist-provided notes as extra information, ` +
    `not as transcript content. Base transcript claims only on explicit spoken content.`
  );
}

/**
 * Build the THERAPIST NOTES block injected into LLM system prompts ahead
 * of the transcript block. Returns an empty string when there is no note,
 * so callers can append conditionally without extra branching.
 *
 * Pure function: no I/O. Exported for unit testing.
 */
export function buildTherapistNotesBlock(note?: string | null): string {
  const trimmed = note?.trim() ?? '';
  if (!trimmed) return '';
  return (
    `---\n` +
    `THERAPIST NOTES (written by the therapist — authoritative extra context, not spoken transcript content):\n` +
    `"""\n${trimmed}\n"""\n` +
    `---`
  );
}
