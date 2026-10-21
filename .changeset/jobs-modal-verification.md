---
'@therascript/ui': patch
---

Show in-progress fact-check jobs in the Active Jobs Queue modal. The sidebar badge counts verification jobs via GET /api/jobs/active-count, but the modal never queried them, so during a fact check the badge showed 1 while the modal showed "No active jobs in the queue". The modal now fetches verification jobs, filters to pending/processing (same active definition as the badge and the audit page), and renders a Verification Jobs section linking to /verification.
