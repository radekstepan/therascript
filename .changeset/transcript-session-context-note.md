---
'@therascript/api': minor
'@therascript/data': minor
'@therascript/db': minor
'@therascript/domain': minor
'@therascript/services': minor
'@therascript/worker': minor
---

# Transcript session context: upload-time speaker count + pure-text disclaimer

Every LLM prompt that reasons about a session transcript now carries a
`SESSION CONTEXT` note stating how many speakers the session involves and
that the transcript is pure text with no non-verbal communication.

- **Speaker count is the explicit upload-time choice, never derived.** The
  optional "number of speakers" dropdown already drove Whisper diarization,
  but the value was passed only to the transcription job and never stored.
  New `sessions.numSpeakers` column (V23 migration, `NULL` = unknown /
  diarization disabled for legacy rows), persisted at upload and returned by
  the session endpoints.
- **Shared `buildTranscriptSessionNote` helper** (`@therascript/services`):
  states the speaker count when ≥ 2, otherwise that it was not specified,
  plus the guardrails — pure-text transcription only, no non-verbal cues,
  do not infer emotions/attitudes/states (e.g. "angry") unless explicitly
  stated in the spoken words; therapist follow-up notes are extra
  information, not transcript content.
- **Injected into all three transcript-grounded paths:** session chat system
  prompt (ahead of the transcript block, KV-cache stable), analysis map
  phase system message, and the verification Judge system prompt (counted in
  the Judge context-budget overhead).
