// packages/api/src/services/speakerLabelUtils.ts
//
// Defensive speaker-label stripping for chat history when a session has
// `showSpeakers === 0`.
//
// The transcript itself already omits `${p.speaker}: ` prefixes via
// `transcriptRepository.getTranscriptTextForSession(sessionId, false)`, so this
// helper exists only to sanitize *stale* history messages that were stored
// while speaker labels were still enabled.
//
// IMPORTANT: the previous implementation used
// `/((?:SPEAKER_\d+)|(?:[A-Z][A-Za-z]+)):\s/g`, whose `[A-Z][A-Za-z]+:\s`
// branch matched any capitalized word followed by `": "` and corrupted normal
// assistant prose ("Summary: ", "Note: ", "Example: ", ...). This helper
// therefore strips ONLY line-start diarization labels (`SPEAKER_00: `, ...)
// and leaves all other prose untouched.
//
// Shared by `sessionChatHandler.ts` (prompt construction) and
// `contextUsageService.ts` (token estimation) so the estimate always matches
// the actual prompt.

/** Line-start diarization labels only, e.g. `SPEAKER_00: `. */
export const HISTORY_SPEAKER_LABEL_REGEX = /^SPEAKER_\d+:\s+/gm;

/**
 * Remove defensive speaker labels from a stored chat message when speaker
 * labels are disabled for the session. Prose labels (`Summary: `, `Note: `,
 * ...) and mid-line occurrences are preserved.
 */
export function stripSpeakerLabelsFromHistory(text: string): string {
  return text.replace(HISTORY_SPEAKER_LABEL_REGEX, '');
}
