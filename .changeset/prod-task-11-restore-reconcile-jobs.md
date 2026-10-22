---
'@therascript/api': patch
---

# Task 11 (prod-readiness): restored active verification jobs no longer block new audits

- **Fixed permanently active rows after backup restore:** verification backups taken mid-audit include `pending`/`processing` jobs, which the import restored verbatim even though the target has an empty queue with no worker running them. `hasActiveVerificationJobs()` then blocked starting another audit or resetting verifications indefinitely.
- **Restore-time reconciliation:** nonterminal job rows are now restored as `failed` with a clear explanation (`Job interrupted by backup restore: ... Start a new audit to retry.`) and a completion timestamp, so the job history shows a recoverable terminal state and new audits start immediately. Terminal rows (`completed`/`failed`/`canceled`) are preserved verbatim.
