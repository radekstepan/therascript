// packages/ui/src/utils/therapistNotes.ts
//
// Helpers for per-session therapist notes: normalization and the
// "this conversation predates the note" check behind the stale-chat
// warning in the session chat input.

interface TimestampedMessage {
  sender: string;
  timestamp: number;
}

/** Trimmed note text, or null when there is effectively no note. */
export function normalizeTherapistNote(
  note: string | null | undefined
): string | null {
  const trimmed = note?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/**
 * True when a conversation holds turns that were generated without the
 * session's current therapist note: the note exists, the chat already has
 * at least one user message, and the note was saved at or after that
 * first question. New/empty chats (no user turns yet) are never stale.
 */
export function isChatStaleForTherapistNote(
  note: string | null | undefined,
  noteUpdatedAt: number | null | undefined,
  messages: TimestampedMessage[] | null | undefined
): boolean {
  if (!normalizeTherapistNote(note)) return false;
  const firstUserTimestamp = (messages ?? [])
    .filter((m) => m.sender === 'user')
    .reduce<
      number | null
    >((min, m) => (min === null || m.timestamp < min ? m.timestamp : min), null);
  if (firstUserTimestamp === null) return false;
  // Unknown revision (rows that predate the timestamp column): a
  // conversation with existing turns cannot be proven current, so warn.
  if (noteUpdatedAt == null) return true;
  // `>=` on purpose: a note saved in the same millisecond as the first
  // question cannot have informed the turns that followed it.
  return noteUpdatedAt >= firstUserTimestamp;
}
