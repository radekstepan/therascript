---
'@therascript/ui': patch
---

# Remove Clear Response Fact Check button from Fact Check modal

- The `StatementVerdictModal` footer no longer renders the "Clear Response Fact Check" action (which deleted the whole response's verification and returned it to the unverified pool). Per-response clearing stays available where it matters: the failed-verification footer in `ChatMessageBubble` still offers "Clear" so failed messages can be retried, and the `/verification` hub keeps Reset All Verifications.
- Drops the now-unused `messageId` prop (and the `deleteMessageVerification` client import) from the modal; `ChatMessages` no longer passes it.
