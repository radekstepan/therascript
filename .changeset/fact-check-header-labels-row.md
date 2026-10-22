---
'@therascript/ui': patch
---

Restructure the Fact Check header so the title row holds only the "Fact Check" heading and the Reset / Run Verification Audit actions (right-aligned), with the failure and unverified-coverage badges moved to a separate wrapping labels row below. Remove the header's one-click "Retry Failed" button; per-transcript retries in the coverage tab now open the Run Verification Audit dialog pre-scoped to that session with skip-already-verified on by default.
