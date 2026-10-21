---
'@therascript/data': patch
---

Exclude transcripts with no user messages from fact check. AI messages are now verifiable only when a preceding user message exists in the same chat, so welcome-only and default chats are never audited and sessions whose AI replies never answer a user turn no longer appear in the fact-check transcripts list.
