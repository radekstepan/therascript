---
'@therascript/db': patch
---

Add a one-off `scripts/port-verifications.mjs` merge tool (+ usage doc) that ports fact-check data between machines. It exports the 4 verification tables (`verification_jobs`, `message_verifications`, `verified_statements`, `verification_statement_reviews`) to JSON on the source machine and merges them into a target DB that already holds the same base rows plus newer transcripts — something the full backup restore can't do without wiping the target first. The merge only touches verification tables, remaps job IDs, skips rows whose message/chat/session is missing or whose message text diverged, never overwrites existing verifications without `--force`, preserves human Dismiss confirmations, and backs up the target beforehand.
