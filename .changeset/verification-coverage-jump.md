---
'@therascript/ui': patch
---

Add jump-to-transcript navigation from the verification dashboard's Transcripts coverage tab. Each session name is now a link to `/sessions/:sessionId`, reusing SessionView's latest-chat auto-redirect so reviewers can jump straight from a coverage row into the session transcript.
