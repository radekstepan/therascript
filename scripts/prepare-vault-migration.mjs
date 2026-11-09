#!/usr/bin/env node
// scripts/prepare-vault-migration.mjs
//
// One-time upgrade step before the first vault setup. For BOTH dev and
// prod: validates preconditions, takes a restorable backup, splits a
// shared uploads directory per environment, and points each env file at
// its own uploads dir — so the operator never edits config by hand.
//
// Usage:
//   yarn build                                   # dist must be current
//   node ./scripts/prepare-vault-migration.mjs [--dry-run] [--root <dir>]
//
// Requirements: stop the API + worker first (the backup copies live
// database files). After this succeeds, boot each env and set its vault
// password in the UI ("Set vault password"); setup() migrates the data.
// Migrate dev first, verify, then prod.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareVaultMigration } from '@therascript/api/dist/services/vaultMigrationPrep.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.join(here, '..');

function usage(exitCode) {
  console.log(`Usage: node ./scripts/prepare-vault-migration.mjs [--dry-run] [--repair-missing-audio] [--root <dir>]

  --dry-run               Validate + report only; change nothing.
  --repair-missing-audio  Clear audioPath references whose files are already
                          gone (after the backup, so originals are recoverable)
                          instead of aborting on them.
  --root                  Monorepo root (default: ${defaultRoot}).
`);
  process.exit(exitCode);
}

async function main() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let repairMissingAudio = false;
  let rootDir = defaultRoot;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') dryRun = true;
    else if (args[i] === '--repair-missing-audio') repairMissingAudio = true;
    else if (args[i] === '--root' && args[i + 1]) rootDir = path.resolve(args[i + 1]);
    else if (args[i] === '--help' || args[i] === '-h') usage(0);
    else if (args[i].startsWith('--root=')) rootDir = path.resolve(args[i].slice('--root='.length));
    else if (!args[i].startsWith('--')) continue;
  }
  if (args.includes('--root') && !args[args.indexOf('--root') + 1]) usage(2);

  console.log(
    dryRun
      ? '--- Vault migration prep (DRY RUN: no changes) ---'
      : '--- Vault migration prep ---'
  );
  console.log(`Root: ${rootDir}`);
  console.log('If the API/worker are running, stop them first.\n');

  const report = await prepareVaultMigration({
    rootDir,
    dryRun,
    repairMissingAudio,
  });

  for (const env of [report.dev, report.prod]) {
    console.log(`[${env.env}] ${env.status}`);
    console.log(`  db:      ${env.dbPath}`);
    console.log(`  uploads: ${env.uploadsDir}`);
    console.log(`  vault:   ${env.vaultDir}`);
    console.log(`  referenced recordings: ${env.referencedFiles}`);
  }
  if (report.sharedFiles.length > 0) {
    console.log(
      `\nShared recordings copied into both envs (${report.sharedFiles.length}):`
    );
    for (const file of report.sharedFiles) console.log(`  ${file}`);
  }
  if (report.repairedAudioRefs.length > 0) {
    console.log(
      `\n${dryRun ? 'Would clear' : 'Cleared'} dangling audio references (${report.repairedAudioRefs.length}):`
    );
    for (const entry of report.repairedAudioRefs) {
      console.log(`  ${entry.env}:${entry.file}`);
    }
  }
  if (report.orphans.length > 0) {
    console.log(
      `\nUnreferenced files kept in the backup only (${report.orphans.length}):`
    );
    for (const file of report.orphans.slice(0, 20)) console.log(`  ${file}`);
    if (report.orphans.length > 20) console.log(`  ... and ${report.orphans.length - 20} more`);
  }
  if (report.backupDir) {
    console.log(`\nBackup: ${report.backupDir}`);
    console.log(report.restoreHint);
  }
  console.log(
    dryRun
      ? '\nDry run: no changes made. Re-run without --dry-run to prepare.'
      : '\nNext: boot dev, set its vault password in the UI, verify, then do the same for prod.'
  );
}

main().catch((error) => {
  console.error(`\nFAILED: ${error instanceof Error ? error.message : error}`);
  console.error(
    'Precondition failures change nothing. If this failed mid-run, ' +
      'restore from the backup dir printed above.'
  );
  process.exit(1);
});
