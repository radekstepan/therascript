---
'@therascript/ui': patch
'@therascript/api': patch
---

# Task 8: missing audio shows a specific warning instead of an unsupported-format error

- **New `GET /api/sessions/:sessionId/audio/status` probe:** returns `{ available }` using the same on-disk existence check as the audio streaming endpoint, so the UI can confirm a missing file without downloading the recording just to observe a 404.
- **Amber "The audio file doesn't exist." warning:** shown for both normal in-app deletion (no `audioPath`) and external deletion (stale path whose file is gone). The media element only mounts after the server confirms the file exists, so browser media error code 4 now reliably means a genuinely unsupported format.
- **Genuine failures stay distinguishable:** decode, unsupported-format, and network errors keep their own red messages; an inconclusive probe (offline/server error) never produces the missing warning.
- **Clean state transitions:** loading/playback indicators stop and playback/seek controls hide while a missing warning shows (transcript stays readable); error/availability state resets when sessions or audio sources change, and each source is probed at most once.
