---
'@therascript/ui': patch
---

Replace the session chat header's actionable Fact Check Chat button with a passive verified-status icon. The icon appears only when every eligible AI note in the selected transcript chat has a completed verification (flagged completions count; failed, skipped, or absent assessments do not), reusing the backend's eligibility rules — user messages, empty notes, the automatic welcome message, and notes with no preceding user turn are excluded, while trivial greetings stay eligible via the worker's fast path. Hovering or keyboard-focusing the icon shows chat-scoped stats (checked/eligible notes, failed count, claim verdict totals, omissions, pooled accuracy, with claim-less chats labeled unknown rather than 0%). The icon never starts verification; audits launch from the /verification hub. It hides the moment a new unchecked note is added and refreshes on verification changes or chat switches.
