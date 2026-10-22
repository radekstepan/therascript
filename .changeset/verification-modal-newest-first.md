---
'@therascript/ui': patch
---

List transcripts newest-first in the Run Verification Audit picker. The transcript list in `StartVerificationModal` was sorted alphabetically by session name; it now sorts by session date descending, with descending session id as the deterministic tie-breaker and missing/invalid dates last. The ordering applies identically whether "Hide already-verified transcripts" is on or off, and selections (tracked by session id) survive toggling the filter.
