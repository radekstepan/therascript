---
'@therascript/data': patch
'@therascript/api': patch
'@therascript/domain': patch
'@therascript/ui': patch
---

Show the Fact Check shield icon for fact-checked sessions in the session list. The sessions endpoint now reports `factCheckedChatCount` (chats with at least one completed verification); rows with chats keep the speech bubble, while rows with fact-checked chats show the ShieldCheck glyph from the chat header's Fact Check action, with a "N chats, M fact-checked" label.
