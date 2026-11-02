#!/usr/bin/env node
// scripts/port-verifications.mjs
//
// One-off merge of fact-check (verification) data from one SQLite DB into
// another that already contains the same base rows plus newer transcripts.
//
// Why not a full backup restore? importDataService() in
// packages/api/src/api/adminHandler.ts calls resetAllDataService() first,
// which would WIPE the newer transcripts on the target. This script only
// touches the 4 verification tables:
//
//   verification_jobs, message_verifications, verified_statements,
//   verification_statement_reviews
//
// (Schema: packages/db/src/sqliteService.ts, migrations V20/V21/V22.)
//
// All verification rows are keyed by INTEGER FKs (message_id, chat_id,
// session_id) — no UUIDs. This works ID-for-ID when the target DB is a
// superset of the source (same original rows + newer ones, so old
// autoincrement IDs are identical). Every row is safety-checked before
// insert: referenced message/chat/session must exist in the target, and
// message text must match (guards against divergent DBs).
//
// Usage (run with the repo's Node, see .nvmrc — `nvm use` first):
//
//   node scripts/port-verifications.mjs export \
//     --source /path/to/source.sqlite --out /tmp/verifications-port.json
//
//   # copy the JSON to the other machine, then:
//   node scripts/port-verifications.mjs merge \
//     --target /path/to/target.sqlite --in /tmp/verifications-port.json
//
//   # overwrite verifications that already exist on the target:
//   node scripts/port-verifications.mjs merge --target ... --in ... --force
//
// Safety:
//   - Target DB is backed up to <target>.bak-<timestamp> before merging.
//   - Default mode never overwrites: messages already verified on the
//     target are skipped. Use --force to replace them.
//   - Reviews are inserted with INSERT OR IGNORE on their
//     UNIQUE(message_id, context_revision, finding_key) constraint.
//   - Run `node scripts/upgrade-db.js` on both DBs first so both are on
//     the latest schema version.

import Database from 'better-sqlite3';
import fs from 'node:fs';

const TABLES = [
  'verification_jobs',
  'message_verifications',
  'verified_statements',
  'verification_statement_reviews',
];

function parseArgs(argv) {
  const args = {};
  let cmd = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && cmd === null) {
      cmd = a;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[a.slice(2)] = argv[++i];
      } else {
        args[a.slice(2)] = true;
      }
    }
  }
  return { cmd, args };
}

function targetColumns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

// Insert only the columns present in BOTH the payload row and the target
// table. All columns added by V21/V22 migrations are nullable or have
// defaults, so this is safe across schema versions.
function insertRow(db, table, row, { orIgnore = false } = {}) {
  const cols = targetColumns(db, table).filter((c) => c !== 'id' && c in row);
  if (cols.length === 0) throw new Error(`No matching columns for ${table}`);
  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`
  );
  return stmt.run(...cols.map((c) => row[c]));
}

function doExport(sourcePath, outPath) {
  const db = new Database(sourcePath, { readonly: true });
  try {
    const version = db.pragma('user_version', { simple: true });
    const data = { exportedAt: Date.now(), user_version: version };
    for (const t of TABLES) {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(t);
      data[t] = exists ? db.prepare(`SELECT * FROM ${t}`).all() : [];
    }
    // Message texts for the verified messages, so the merge step can refuse
    // to attach a verification to a diverged message (edited text or a
    // different DB lineage reusing the same autoincrement id). A text
    // mismatch means the fingerprinted material_revision is stale anyway.
    const mvIds = (data.message_verifications ?? []).map((mv) => mv.message_id);
    data.message_texts = {};
    if (mvIds.length > 0) {
      const placeholders = mvIds.map(() => '?').join(', ');
      for (const r of db.prepare(`SELECT id, text FROM messages WHERE id IN (${placeholders})`).all(...mvIds)) {
        data.message_texts[r.id] = r.text;
      }
    }
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`Source user_version: ${version}`);
    for (const t of TABLES) console.log(`  ${t}: ${data[t].length} rows`);
    console.log(`Wrote ${outPath}`);
  } finally {
    db.close();
  }
}

function doMerge(targetPath, inPath, force) {
  const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));

  // Safety backup of the target before touching anything.
  const backupPath = `${targetPath}.bak-${Date.now()}`;
  fs.copyFileSync(targetPath, backupPath);
  console.log(`Target backed up to ${backupPath}`);

  const db = new Database(targetPath);
  try {
    db.pragma('foreign_keys = ON');
    const version = db.pragma('user_version', { simple: true });
    console.log(`Target user_version: ${version} (source was ${data.user_version ?? 'unknown'})`);

    const targetSessions = new Set(
      db.prepare('SELECT id FROM sessions').all().map((r) => r.id)
    );
    const targetChats = new Set(
      db.prepare('SELECT id FROM chats').all().map((r) => r.id)
    );
    const targetMessages = new Map(
      db.prepare('SELECT id, chatId, text FROM messages').all().map((r) => [r.id, r])
    );
    const alreadyVerified = new Set(
      db.prepare('SELECT message_id FROM message_verifications').all().map((r) => r.message_id)
    );

    const stats = { jobs: 0, jobsSkipped: 0, verifications: 0, skipped: 0, overwritten: 0, textMismatch: 0, statements: 0, reviews: 0, reviewsSkipped: 0 };
    const oldToNewJobId = new Map();
    const oldToNewMvId = new Map();
    const oldToNewStatementId = new Map();

    const mergeTxn = db.transaction(() => {
      // 1. Jobs (disposable history; always inserted as new rows, unless
      // an identical job from a previous merge run already exists).
      for (const job of data.verification_jobs ?? []) {
        const dupe = db.prepare(
          'SELECT id FROM verification_jobs WHERE created_at = ? AND scope = ? AND IFNULL(model_name, ?) = IFNULL(?, ?)'
        ).get(job.created_at, job.scope, '', job.model_name, '');
        if (dupe && !force) {
          oldToNewJobId.set(job.id, dupe.id);
          stats.jobsSkipped += 1;
          continue;
        }
        const row = { ...job };
        // Remap chat_id defensively; NULL when the chat is absent on target.
        if (row.chat_id != null && !targetChats.has(row.chat_id)) {
          row.chat_id = null;
          stats.jobsSkipped += 0; // job kept, link dropped (noted below)
        }
        // Remap session_ids_json: keep only ids present on the target.
        if (row.session_ids_json != null) {
          try {
            const ids = JSON.parse(row.session_ids_json);
            if (Array.isArray(ids)) {
              const kept = ids.filter((id) => targetSessions.has(id));
              if (kept.length !== ids.length) {
                console.log(`  job ${job.id}: dropped ${ids.length - kept.length} session id(s) missing on target`);
              }
              row.session_ids_json = JSON.stringify(kept);
            }
          } catch { /* keep verbatim if unparseable */ }
        }
        if (['pending', 'processing', 'canceling'].includes(row.status)) {
          row.status = 'failed';
          row.completed_at = row.completed_at ?? Date.now();
          row.error_message =
            'Job interrupted by verification port: it was still active when exported. Start a new audit to retry.';
        }
        const res = insertRow(db, 'verification_jobs', row);
        oldToNewJobId.set(job.id, res.lastInsertRowid);
        stats.jobs += 1;
      }

      // 2. Per-message verifications (UNIQUE on message_id).
      for (const mv of data.message_verifications ?? []) {
        const targetMsg = targetMessages.get(mv.message_id);
        if (!targetMsg || !targetChats.has(mv.chat_id) || !targetSessions.has(mv.session_id)) {
          console.log(`  skip verification for message ${mv.message_id}: message/chat/session missing on target`);
          stats.skipped += 1;
          continue;
        }
        if (targetMsg.text !== undefined && data.message_texts?.[mv.message_id] !== undefined
            && targetMsg.text !== data.message_texts[mv.message_id]) {
          console.log(`  skip verification for message ${mv.message_id}: text differs on target (diverged DB or edited message)`);
          stats.skipped += 1;
          stats.textMismatch += 1;
          continue;
        }
        if (alreadyVerified.has(mv.message_id) && !force) {
          stats.skipped += 1;
          continue;
        }
        if (alreadyVerified.has(mv.message_id) && force) {
          // Mirrors deleteMessageVerification: drop the assessment + its
          // statements, keep human reviews (message-owned).
          const existing = db.prepare('SELECT id FROM message_verifications WHERE message_id = ?').get(mv.message_id);
          if (existing) {
            db.prepare('DELETE FROM verified_statements WHERE message_verification_id = ?').run(existing.id);
            db.prepare('DELETE FROM message_verifications WHERE id = ?').run(existing.id);
            stats.overwritten += 1;
          }
        }
        const row = { ...mv };
        row.verification_job_id =
          mv.verification_job_id != null ? (oldToNewJobId.get(mv.verification_job_id) ?? null) : null;
        const res = insertRow(db, 'message_verifications', row);
        oldToNewMvId.set(mv.id, res.lastInsertRowid);
        stats.verifications += 1;
      }

      // 3. Statements (children of the assessment; deleted+reinserted on re-audit).
      for (const st of data.verified_statements ?? []) {
        const newMvId = oldToNewMvId.get(st.message_verification_id);
        if (!newMvId || !targetMessages.has(st.message_id) || !targetSessions.has(st.session_id)) {
          stats.skipped += 1;
          continue;
        }
        const res = insertRow(db, 'verified_statements', { ...st, message_verification_id: newMvId });
        oldToNewStatementId.set(st.id, res.lastInsertRowid);
        stats.statements += 1;
      }

      // 4. Human confirmations (message-owned; matched by content fingerprint).
      for (const review of data.verification_statement_reviews ?? []) {
        if (!targetMessages.has(review.message_id) || !targetSessions.has(review.session_id)) {
          stats.reviewsSkipped += 1;
          continue;
        }
        const row = { ...review };
        row.confirmed_statement_id =
          review.confirmed_statement_id != null
            ? (oldToNewStatementId.get(review.confirmed_statement_id) ?? null)
            : null;
        const res = insertRow(db, 'verification_statement_reviews', row, { orIgnore: true });
        if (res.changes === 0) stats.reviewsSkipped += 1;
        else stats.reviews += 1;
      }
    });
    mergeTxn();

    console.log('Merge complete:');
    console.log(`  jobs inserted: ${stats.jobs} (already present: ${stats.jobsSkipped})`);
    console.log(`  verifications inserted: ${stats.verifications} (skipped: ${stats.skipped}, overwritten: ${stats.overwritten}, text mismatches: ${stats.textMismatch})`);
    console.log(`  statements inserted: ${stats.statements}`);
    console.log(`  reviews inserted: ${stats.reviews} (skipped/duplicates: ${stats.reviewsSkipped})`);
    if (!force) console.log('Tip: re-run with --force to overwrite messages already verified on the target.');
  } finally {
    db.close();
  }
}

const { cmd, args } = parseArgs(process.argv.slice(2));
if (cmd === 'export' && args.source && args.out) {
  doExport(args.source, args.out);
} else if (cmd === 'merge' && args.target && (args.in || args.input)) {
  doMerge(args.target, args.in || args.input, args.force === true || args.force === 'true');
} else {
  console.log(`Usage:
  node scripts/port-verifications.mjs export --source <source.sqlite> --out <port.json>
  node scripts/port-verifications.mjs merge --target <target.sqlite> --in <port.json> [--force]`);
  process.exit(1);
}
