---
'@therascript/api': patch
'@therascript/data': patch
'@therascript/domain': patch
---

# Task 1: verification accounting, failed-row reporting, admin backup/reset integrity

- **Failed verifications no longer count as verified.** Session and global analytics count only `completed` rows; failed attempts are reported separately via new `failedAiMessages` / `failedMessagesCount` fields.
- **Active-job guard uses a dedicated query** (`hasActiveVerificationJobs()`), and `resetAllVerifications()` now deletes `verification_jobs` rows alongside verifications and statements.
- **Admin full reset, backup export, and import cover verification data.** Reset preserves the full schema and system templates (children-first delete, no table drops), and export/import round-trips `verification_jobs`, `message_verifications`, and `verified_statements` (older backups still import cleanly).
