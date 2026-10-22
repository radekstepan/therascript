---
'@therascript/data': patch
'@therascript/api': patch
'@therascript/ui': patch
---

Add a Client filter to the Fact Check issues feed. The `GET /api/verification/statements` endpoint accepts a `clientName` query parameter (exact match on the session's client), and the feed's filter row gains a Client dropdown fed by the audited sessions, alongside severity and authoring-model filters.
