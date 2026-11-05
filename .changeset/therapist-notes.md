---
'@therascript/db': minor
'@therascript/domain': minor
'@therascript/data': minor
'@therascript/services': minor
'@therascript/api': minor
'@therascript/ui': minor
---

Per-session therapist notes. The transcript `...` menu gains an Add/Edit Therapist Notes entry opening a textarea modal; the note is stored on the session (migration V24: `therapistNote` + `therapistNoteUpdatedAt`) and injected ahead of the transcript as a `THERAPIST NOTES` block in every session-chat prompt, with the `system_prompt` default updated to describe it (existing uncustomized prompts upgrade on boot). Typing in a conversation whose earlier turns predate the current note shows an amber warning above the input suggesting a new chat.
