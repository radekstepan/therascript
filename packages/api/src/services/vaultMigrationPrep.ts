// packages/api/src/services/vaultMigrationPrep.ts
//
// One-time upgrade helper: prepares a legacy install for vault setup
// without the operator editing config by hand. It validates preconditions,
// takes a restorable backup, splits a shared uploads directory per
// environment (dev/prod databases cannot share one: the first migration
// would delete the other's recordings), and points each env file at its
// own uploads dir. After it succeeds, booting each env shows
// "Set vault password", and setup() migrates that env's database.
//
// Safety order: validate EVERYTHING before mutating anything. Any
// problem aborts with a report and leaves the tree untouched. `--dry-run`
// runs validation + reporting only.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openLegacyDatabase } from '@therascript/db';

export type MigrationEnv = 'dev' | 'prod';

const API_ENV_FILES: Record<MigrationEnv, string> = {
  dev: '.env.api.dev',
  prod: '.env.api.prod',
};
const WORKER_ENV_FILES: Record<MigrationEnv, string> = {
  dev: '.env.worker.dev',
  prod: '.env.worker.prod',
};

const DB_SIDECARS = ['-wal', '-shm', '-journal'];

/** Parse KEY=VALUE lines; skips blanks and full-line comments. */
export function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

/** Replace (or append) one KEY= line, preserving the rest byte-for-byte. */
export function upsertEnvVar(
  content: string,
  key: string,
  value: string
): string {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return (
      trimmed.startsWith(`${key}=`) ||
      trimmed.startsWith(`${key} =`) ||
      trimmed.startsWith(`${key}\t=`)
    );
  });
  if (index >= 0) {
    const indent = lines[index].slice(
      0,
      lines[index].length - lines[index].trimStart().length
    );
    lines[index] = `${indent}${key}=${value}`;
    return lines.join('\n');
  }
  const separator = content.endsWith('\n') || content === '' ? '' : '\n';
  return `${content}${separator}${key}=${value}\n`;
}

/**
 * Every non-null audioPath must be a plain basename: the migration copies
 * by entry name and the seal check rejects anything else, so anything
 * exotic aborts the upgrade here instead of mid-setup.
 */
export function isSafeAudioBasename(value: string): boolean {
  return (
    value !== '' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    value !== '.' &&
    value !== '..' &&
    path.basename(value) === value
  );
}

export function assertSafeAudioPath(value: string): void {
  if (!isSafeAudioBasename(value)) {
    throw new Error(
      `Unsafe audioPath reference: ${JSON.stringify(value)} (must be a plain file name)`
    );
  }
}

export interface UploadSplit {
  devFiles: string[];
  prodFiles: string[];
  /** Present on disk but referenced by neither database (kept in backup only). */
  orphans: string[];
  /** Referenced by a database but missing on disk (aborts the upgrade). */
  missing: { env: MigrationEnv; file: string }[];
}

/** Pure set computation over DB references vs directory entries. */
export function planUploadSplit(
  devRefs: string[],
  prodRefs: string[],
  entries: string[]
): UploadSplit {
  const onDisk = new Set(entries);
  const devFiles = [...new Set(devRefs)].sort();
  const prodFiles = [...new Set(prodRefs)].sort();
  const referenced = new Set([...devFiles, ...prodFiles]);
  const missing: UploadSplit['missing'] = [];
  for (const file of devFiles) {
    if (!onDisk.has(file)) missing.push({ env: 'dev', file });
  }
  for (const file of prodFiles) {
    if (!onDisk.has(file)) missing.push({ env: 'prod', file });
  }
  const orphans = entries.filter((entry) => !referenced.has(entry)).sort();
  return { devFiles, prodFiles, orphans, missing };
}

interface EnvPaths {
  env: MigrationEnv;
  apiEnvFile: string;
  workerEnvFile: string;
  dbPath: string;
  uploadsDir: string;
  vaultDir: string;
}

export interface EnvPrepareReport {
  env: MigrationEnv;
  /** skipped-no-database: no legacy DB; setup() will create a fresh vault. */
  status: 'prepared' | 'already-separated' | 'skipped-no-database';
  dbPath: string;
  uploadsDir: string;
  vaultDir: string;
  referencedFiles: number;
}

export interface PrepareReport {
  dryRun: boolean;
  backupDir: string | null;
  dev: EnvPrepareReport;
  prod: EnvPrepareReport;
  /** Overlap copied into both per-env dirs. */
  sharedFiles: string[];
  orphans: string[];
  /** Cleared in dry-run: would clear. Empty unless repair was requested. */
  repairedAudioRefs: { env: MigrationEnv; file: string }[];
  restoreHint: string | null;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function isNonEmptyFile(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function readAudioPaths(dbPath: string): string[] {
  const connection = openLegacyDatabase(dbPath);
  try {
    const rows = connection
      .prepare(
        'SELECT DISTINCT audioPath AS p FROM sessions WHERE audioPath IS NOT NULL'
      )
      .all() as { p: string }[];
    return rows.map((row) => row.p);
  } finally {
    connection.close();
  }
}

function requireVar(
  vars: Record<string, string>,
  file: string,
  key: string
): string {
  const value = vars[key];
  if (value === undefined || value === '') {
    throw new Error(`Missing ${key} in ${file}; cannot plan the upgrade.`);
  }
  return value;
}

async function loadEnvPaths(
  rootDir: string,
  env: MigrationEnv
): Promise<EnvPaths> {
  const apiEnvFile = path.join(rootDir, API_ENV_FILES[env]);
  const workerEnvFile = path.join(rootDir, WORKER_ENV_FILES[env]);
  let apiContent: string;
  let workerContent: string;
  try {
    apiContent = await fs.readFile(apiEnvFile, 'utf8');
  } catch {
    throw new Error(`Missing env file: ${apiEnvFile}`);
  }
  try {
    workerContent = await fs.readFile(workerEnvFile, 'utf8');
  } catch {
    throw new Error(`Missing env file: ${workerEnvFile}`);
  }
  const api = parseEnvFile(apiContent);
  const worker = parseEnvFile(workerContent);
  const dbPath = path.resolve(
    rootDir,
    requireVar(api, API_ENV_FILES[env], 'DB_PATH')
  );
  const workerDb = worker['DB_PATH'];
  if (workerDb !== undefined && path.resolve(rootDir, workerDb) !== dbPath) {
    throw new Error(
      `DB_PATH mismatch between ${API_ENV_FILES[env]} and ${WORKER_ENV_FILES[env]}; fix by hand before upgrading.`
    );
  }
  const uploadsDir = path.resolve(
    rootDir,
    requireVar(api, API_ENV_FILES[env], 'DB_UPLOADS_DIR')
  );
  const vaultDir = path.resolve(
    rootDir,
    requireVar(api, API_ENV_FILES[env], 'VAULT_DIR')
  );
  return { env, apiEnvFile, workerEnvFile, dbPath, uploadsDir, vaultDir };
}

function backupStamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Validates, backs up, splits uploads, and rewrites env files. Throws
 * before changing anything when a precondition fails. With `dryRun`, runs
 * validation + reporting only. With `repairMissingAudio`, clears
 * audioPath references whose files are already gone (after the backup, so
 * the originals stay recoverable) instead of aborting on them.
 */
export async function prepareVaultMigration(options: {
  rootDir: string;
  dryRun?: boolean;
  repairMissingAudio?: boolean;
  now?: Date;
}): Promise<PrepareReport> {
  const { rootDir } = options;
  const dryRun = options.dryRun ?? false;
  const repairMissingAudio = options.repairMissingAudio ?? false;
  const dev = await loadEnvPaths(rootDir, 'dev');
  const prod = await loadEnvPaths(rootDir, 'prod');

  if (dev.dbPath === prod.dbPath) {
    throw new Error(
      'Dev and prod point at the same database; nothing to split. Give each env its own DB_PATH first.'
    );
  }
  if (dev.vaultDir === prod.vaultDir) {
    throw new Error(
      'Dev and prod share one VAULT_DIR; one vault holds exactly one database. Give each env its own VAULT_DIR first.'
    );
  }
  // A live vault has a CURRENT/STAGING pointer or generation data. Bare
  // directory husks (created by server boot's layout recovery) are fine.
  const vaultLooksLive = async (vaultDir: string): Promise<boolean> => {
    if (
      (await exists(path.join(vaultDir, 'CURRENT'))) ||
      (await exists(path.join(vaultDir, 'STAGING')))
    ) {
      return true;
    }
    try {
      return (await fs.readdir(path.join(vaultDir, 'generations'))).length > 0;
    } catch {
      return false;
    }
  };
  for (const env of [dev, prod]) {
    if (await vaultLooksLive(env.vaultDir)) {
      throw new Error(
        `Vault already exists at ${env.vaultDir}; ${env.env} looks migrated. ` +
          'This helper only prepares unmigrated installs.'
      );
    }
  }

  const sharedUploads = dev.uploadsDir === prod.uploadsDir;
  const devHasDb = await isNonEmptyFile(dev.dbPath);
  const prodHasDb = await isNonEmptyFile(prod.dbPath);
  const devRefs = devHasDb ? readAudioPaths(dev.dbPath) : [];
  const prodRefs = prodHasDb ? readAudioPaths(prod.dbPath) : [];
  for (const ref of [...devRefs, ...prodRefs]) assertSafeAudioPath(ref);

  // Entries per uploads dir (missing dir == empty; setup tolerates that).
  const readEntries = async (dir: string): Promise<string[]> => {
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      return dirents
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  };

  const formatMissing = (missing: UploadSplit['missing']): string =>
    missing.map((entry) => `${entry.env}:${entry.file}`).join(', ');

  const missingError = (missing: UploadSplit['missing']): Error =>
    new Error(
      `Missing recording files (aborting before any change): ${formatMissing(missing)}. ` +
        'Restore the files, or re-run with --repair-missing-audio to clear ' +
        'references whose audio is already unrecoverable.'
    );

  // Backup lives next to the uploads dir.
  const backupBase = path.dirname(dev.uploadsDir);
  const backupDir = path.join(
    backupBase,
    `pre-vault-backup-${backupStamp(options.now ?? new Date())}`
  );

  const takeBackup = async (): Promise<void> => {
    await fs.mkdir(backupDir, { recursive: true });
    // Databases (+ sidecars) under fixed names + a manifest for restore.
    const manifest: { backupPath: string; originalPath: string }[] = [];
    const backupDb = async (label: string, dbPath: string): Promise<void> => {
      if (!(await isNonEmptyFile(dbPath))) return;
      for (const suffix of ['', ...DB_SIDECARS]) {
        const source = `${dbPath}${suffix}`;
        if (!(await exists(source))) continue;
        const target = path.join(backupDir, `${label}.sqlite${suffix}`);
        await fs.copyFile(source, target);
        manifest.push({ backupPath: target, originalPath: source });
      }
    };
    await backupDb('dev', dev.dbPath);
    await backupDb('prod', prod.dbPath);
    const uploadsBackup = path.join(backupDir, 'uploads');
    if (sharedUploads) {
      if (await exists(dev.uploadsDir)) {
        await fs.cp(dev.uploadsDir, uploadsBackup, { recursive: true });
      }
    } else {
      for (const [label, dir] of [
        ['dev', dev.uploadsDir],
        ['prod', prod.uploadsDir],
      ] as const) {
        if (await exists(dir)) {
          await fs.cp(dir, path.join(uploadsBackup, label), {
            recursive: true,
          });
        }
      }
    }
    const envBackup = path.join(backupDir, 'env');
    await fs.mkdir(envBackup, { recursive: true });
    for (const file of [
      dev.apiEnvFile,
      dev.workerEnvFile,
      prod.apiEnvFile,
      prod.workerEnvFile,
    ]) {
      await fs.copyFile(file, path.join(envBackup, path.basename(file)));
    }
    await fs.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(
        { createdAt: new Date().toISOString(), files: manifest },
        null,
        2
      )
    );
    // The backup must open: a torn copy aborts the upgrade, not the restore.
    const verifyBackup = async (
      label: string,
      originalDb: string
    ): Promise<void> => {
      if (!(await isNonEmptyFile(originalDb))) return;
      const copy = path.join(backupDir, `${label}.sqlite`);
      const connection = openLegacyDatabase(copy);
      try {
        connection.prepare('SELECT count(*) FROM sqlite_schema').get();
      } finally {
        connection.close();
      }
    };
    await verifyBackup('dev', dev.dbPath);
    await verifyBackup('prod', prod.dbPath);
  };

  // Clears dangling audioPath references in the legacy databases. Runs
  // only after takeBackup, so the originals stay recoverable.
  const repairRefs = async (missing: UploadSplit['missing']): Promise<void> => {
    const byEnv = new Map<MigrationEnv, string[]>();
    for (const entry of missing) {
      const list = byEnv.get(entry.env) ?? [];
      list.push(entry.file);
      byEnv.set(entry.env, list);
    }
    for (const [env, files] of byEnv) {
      const dbPath = env === 'dev' ? dev.dbPath : prod.dbPath;
      const connection = openLegacyDatabase(dbPath);
      try {
        const placeholders = files.map(() => '?').join(',');
        connection
          .prepare(
            `UPDATE sessions SET audioPath = NULL WHERE audioPath IN (${placeholders})`
          )
          .run(...files);
      } finally {
        connection.close();
      }
    }
  };

  if (!sharedUploads) {
    // Already separated: verify references resolve (repairing when asked).
    const collectMissing = async (): Promise<UploadSplit['missing']> => {
      const missing: UploadSplit['missing'] = [];
      const checkEnv = async (
        env: EnvPaths,
        refs: string[]
      ): Promise<number> => {
        const entries = new Set(await readEntries(env.uploadsDir));
        let count = 0;
        for (const ref of [...new Set(refs)]) {
          count += 1;
          if (!entries.has(ref)) missing.push({ env: env.env, file: ref });
        }
        return count;
      };
      await checkEnv(dev, devHasDb ? readAudioPaths(dev.dbPath) : []);
      await checkEnv(prod, prodHasDb ? readAudioPaths(prod.dbPath) : []);
      return missing;
    };
    let missing = await collectMissing();
    let repairedAudioRefs: UploadSplit['missing'] = [];
    let didBackup = false;
    if (missing.length > 0) {
      if (!repairMissingAudio) throw missingError(missing);
      if (!dryRun) {
        await takeBackup();
        didBackup = true;
        await repairRefs(missing);
        repairedAudioRefs = missing;
        missing = await collectMissing();
        if (missing.length > 0) {
          throw new Error(
            `Repair failed, still missing: ${formatMissing(missing)}`
          );
        }
      } else {
        repairedAudioRefs = missing;
        missing = [];
      }
    }
    const countRefs = (env: EnvPaths, hasDb: boolean): number =>
      hasDb ? [...new Set(readAudioPaths(env.dbPath))].length : 0;
    const reportEnv = (
      env: EnvPaths,
      hasDb: boolean,
      count: number
    ): EnvPrepareReport => ({
      env: env.env,
      status: hasDb ? 'already-separated' : 'skipped-no-database',
      dbPath: env.dbPath,
      uploadsDir: env.uploadsDir,
      vaultDir: env.vaultDir,
      referencedFiles: count,
    });
    return {
      dryRun,
      backupDir: didBackup ? backupDir : null,
      dev: reportEnv(dev, devHasDb, countRefs(dev, devHasDb)),
      prod: reportEnv(prod, prodHasDb, countRefs(prod, prodHasDb)),
      sharedFiles: [],
      orphans: [],
      repairedAudioRefs,
      restoreHint: didBackup
        ? `Restore: copy ${path.join(backupDir, 'dev.sqlite')} over dev DB_PATH (+ sidecars), ` +
          `${path.join(backupDir, 'prod.sqlite')} over prod DB_PATH, and ` +
          `${path.join(backupDir, 'env')}/*.env.* over the env files (see manifest.json).`
        : null,
    };
  }

  const entries = await readEntries(dev.uploadsDir);
  let split = planUploadSplit(devRefs, prodRefs, entries);
  let repairedAudioRefs: UploadSplit['missing'] = [];
  if (split.missing.length > 0 && !repairMissingAudio) {
    throw missingError(split.missing);
  }
  const devUploadsDir = `${dev.uploadsDir}-dev`;
  const prodUploadsDir = `${prod.uploadsDir}-prod`;
  for (const dir of [devUploadsDir, prodUploadsDir]) {
    if (await exists(dir)) {
      throw new Error(
        `Split target already exists: ${dir}. Remove it (or restore from backup) before retrying.`
      );
    }
  }
  if (!dryRun) {
    await takeBackup();
    if (split.missing.length > 0 && repairMissingAudio) {
      await repairRefs(split.missing);
      repairedAudioRefs = split.missing;
      const freshDevRefs = devHasDb ? readAudioPaths(dev.dbPath) : [];
      const freshProdRefs = prodHasDb ? readAudioPaths(prod.dbPath) : [];
      split = planUploadSplit(freshDevRefs, freshProdRefs, entries);
      if (split.missing.length > 0) {
        throw new Error(
          `Repair failed, still missing: ${formatMissing(split.missing)}`
        );
      }
    }

    // Split (copy), verify copies, then remove the shared original.
    await fs.mkdir(devUploadsDir, { recursive: true });
    await fs.mkdir(prodUploadsDir, { recursive: true });
    for (const file of split.devFiles) {
      await fs.copyFile(
        path.join(dev.uploadsDir, file),
        path.join(devUploadsDir, file)
      );
    }
    for (const file of split.prodFiles) {
      await fs.copyFile(
        path.join(dev.uploadsDir, file),
        path.join(prodUploadsDir, file)
      );
    }
    for (const [dir, files] of [
      [devUploadsDir, split.devFiles],
      [prodUploadsDir, split.prodFiles],
    ] as const) {
      for (const file of files) {
        if (!(await isNonEmptyFile(path.join(dir, file)))) {
          throw new Error(
            `Split verification failed for ${path.join(dir, file)}; shared uploads left untouched.`
          );
        }
      }
    }
    await fs.rm(dev.uploadsDir, { recursive: true, force: true });

    // Point each env at its own uploads dir (root-relative, as before).
    const rewriteUploadsDir = async (
      file: string,
      dir: string
    ): Promise<void> => {
      const content = await fs.readFile(file, 'utf8');
      const relative = path.relative(rootDir, dir);
      await fs.writeFile(
        file,
        upsertEnvVar(content, 'DB_UPLOADS_DIR', relative)
      );
    };
    await rewriteUploadsDir(dev.apiEnvFile, devUploadsDir);
    await rewriteUploadsDir(dev.workerEnvFile, devUploadsDir);
    await rewriteUploadsDir(prod.apiEnvFile, prodUploadsDir);
    await rewriteUploadsDir(prod.workerEnvFile, prodUploadsDir);
  }

  if (dryRun && split.missing.length > 0 && repairMissingAudio) {
    repairedAudioRefs = split.missing;
  }
  // Computed after any repair so it reflects the final reference sets.
  const sharedFiles = split.devFiles.filter((file) =>
    split.prodFiles.includes(file)
  );
  const reportEnv = (
    env: EnvPaths,
    hasDb: boolean,
    dir: string,
    files: string[]
  ): EnvPrepareReport => ({
    env: env.env,
    status: hasDb ? 'prepared' : 'skipped-no-database',
    dbPath: env.dbPath,
    uploadsDir: dir,
    vaultDir: env.vaultDir,
    referencedFiles: files.length,
  });
  return {
    dryRun,
    backupDir: dryRun ? null : backupDir,
    dev: reportEnv(dev, devHasDb, devUploadsDir, split.devFiles),
    prod: reportEnv(prod, prodHasDb, prodUploadsDir, split.prodFiles),
    sharedFiles,
    orphans: split.orphans,
    repairedAudioRefs,
    restoreHint: dryRun
      ? null
      : `Restore: copy ${path.join(backupDir, 'dev.sqlite')} over dev DB_PATH (+ sidecars), ` +
        `${path.join(backupDir, 'prod.sqlite')} over prod DB_PATH, ` +
        `${path.join(backupDir, 'uploads')} over the uploads dir, and ` +
        `${path.join(backupDir, 'env')}/*.env.* over the env files (see manifest.json).`,
  };
}
