---
'@therascript/worker': patch
---

# Task 2 (prod-readiness): structurally invalid judge JSON fails instead of auditing perfectly

- **Fixed perfect audits from invalid judge output:** parsed-but-invalid JSON such as `{}` or `{"error":"unable to assess"}` previously bypassed the repair retry, normalized to empty claim/omission lists, and was saved as completed with accuracy 1.0. Non-array `claims` and claim arrays whose entries were all unusable did the same.
- **Structural validation before scoring:** every parsed judge response is now validated (`validateJudgeOutputStructure`) — top-level object with array-typed `claims` and `omissions`, plus at least one usable record per non-empty array. Invalid output runs the bounded repair retry (with a schema-shaped reminder), then persists a failed verification with accumulated usage instead of a clean completed row.
- Explicitly valid zero-claim results (`claims: [], omissions: []`) and the trivial-greeting fast path still complete with accuracy 1.0.
