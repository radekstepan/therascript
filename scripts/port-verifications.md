# port-verifications.mjs — Fact-check port between machines

Merge fact-check (verification) data from one SQLite DB into another that
already contains the same base rows **plus newer transcripts**.

Do NOT use Settings → Backup/Restore for this: a full restore wipes the
target DB first, deleting the newer transcripts. This script touches only
the 4 verification tables and never modifies sessions, chats, messages,
or transcripts:

- `verification_jobs`
- `message_verifications`
- `verified_statements`
- `verification_statement_reviews`

## Prerequisites

1. Use the repo's Node version on both machines:
   ```
   nvm use
   ```
2. Bring both databases to the current schema (V20–V22 columns required):
   ```
   node scripts/upgrade-db.js
   ```
3. Find each machine's DB path (`DB_PATH` in its `.env`, default
   `packages/api/data/therapy-analyzer-dev.sqlite`). Stop the API/worker
   on the target machine before merging (or at least don't run audits
   mid-merge).

## Step 1 — Export (on the machine that HAS the fact checks)

```
node scripts/port-verifications.mjs export \
  --source <source.sqlite> \
  --out /tmp/verifications-port.json
```

Both `--source <path> --out <path>` and `--source=<path> --out=<path>`
forms work. The JSON contains the 4 tables plus message texts used as a
safety check on import.

## Step 2 — Merge (on the machine with the newer transcripts)

Copy `verifications-port.json` to the other machine, then:

```
node scripts/port-verifications.mjs merge \
  --target <target.sqlite> \
  --in /tmp/verifications-port.json
```

What happens:
- Target is backed up first to `<target>.bak-<timestamp>`.
- Referenced message/chat/session must exist on the target, and the
  message text must match the source — otherwise the row is skipped
  (protects against diverged DBs reusing the same autoincrement IDs).
- Messages already verified on the target are skipped (never
  overwritten). Job rows are de-duplicated across repeat runs; reviews
  (Dismiss confirmations) insert with `INSERT OR IGNORE` on their
  UNIQUE constraint.
- Active-status jobs (`pending`/`processing`/`canceling`) in the export
  are reconciled to `failed`, same as a backup restore, since no worker
  is running them on the target.

## Step 3 — Verify

- Re-running the same merge should report `0` inserted everywhere.
- Open the `/verification` hub on the target: counts, highlights, and
  Dismissed confirmations should match the source.
- Messages whose transcript was edited on the target will show as
  needing re-audit (judge content fingerprint no longer matches) — this
  is by design, re-run the audit for those.

## Overwriting

To replace verifications that already exist on the target (keeps human
Dismiss confirmations, same as in-app re-audit):

```
node scripts/port-verifications.mjs merge \
  --target <target.sqlite> \
  --in /tmp/verifications-port.json \
  --force
```

## Caveats

- Assumes the target is a superset of the source (same original rows +
  newer ones, so old IDs line up). Fully unrelated DBs will mostly skip.
- Ambiguous-span confirmations (unresolved highlights) embed old
  statement row IDs and import as inert history; normal confirmations
  transfer fully.
