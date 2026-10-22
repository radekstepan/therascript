---
'@therascript/api': patch
---

# Task 7 (prod-readiness): failed queue submission no longer orphans an active verification job

- **Fixed orphaned pending rows blocking new audits:** the SQLite job row was committed before `addVerificationJob` was awaited, so a rejected submission left a pending row the active-job guard kept rejecting subsequent audits for, with no worker able to process it and no path forward except manual cancellation.
- **Submission-failure reconciliation:** a rejected submission now marks the row terminal `failed` with the queue error (`Failed to submit verification job to the queue: <detail>`), and the endpoint returns that 500 — so the failure is visible in the job history and a new audit can start immediately.
- **Deterministic queue identity for ambiguous outcomes:** verification jobs are submitted under a stable BullMQ `jobId` (`verification-<dbRowId>`), so re-submitting the same row returns the existing queued job instead of duplicating work. When `add` rejects, the handler checks queue presence first: if the job actually landed (error after server accept), the row stays pending and the endpoint reports success; if queue state itself is unreadable, the job fails closed — safe because the worker's conditional `transitionJobToProcessing` never revives a terminal row.
