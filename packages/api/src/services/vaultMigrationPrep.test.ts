// @vitest-environment node
// packages/api/src/services/vaultMigrationPrep.test.ts
//
// Upgrade helper proof: env parsing/rewriting, upload-split planning,
// and the full prepare run against a fixture monorepo (real databases,
// real filesystem) — including every abort path leaving the tree
// untouched.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabase, openLegacyDatabase } from '@therascript/db';
import {
  parseEnvFile,
  upsertEnvVar,
  assertSafeAudioPath,
  planUploadSplit,
  prepareVaultMigration,
} from './vaultMigrationPrep.js';

describe('parseEnvFile / upsertEnvVar', () => {
  it('parses values, skipping comments and blanks', () => {
    expect(
      parseEnvFile(
        '# comment\n\nDB_PATH=a.sqlite\nQUOTED="x y"\nSINGLE=\'z\'\nMALFORMED\n'
      )
    ).toEqual({ DB_PATH: 'a.sqlite', QUOTED: 'x y', SINGLE: 'z' });
  });

  it('replaces one var preserving everything else', () => {
    const content = '# top\nDB_PATH=a.sqlite\nDB_UPLOADS_DIR=uploads\n';
    expect(upsertEnvVar(content, 'DB_UPLOADS_DIR', 'uploads-dev')).toBe(
      '# top\nDB_PATH=a.sqlite\nDB_UPLOADS_DIR=uploads-dev\n'
    );
  });

  it('appends a missing var', () => {
    expect(upsertEnvVar('DB_PATH=a.sqlite\n', 'VAULT_DIR', 'vault')).toBe(
      'DB_PATH=a.sqlite\nVAULT_DIR=vault\n'
    );
    expect(upsertEnvVar('DB_PATH=a.sqlite', 'VAULT_DIR', 'vault')).toBe(
      'DB_PATH=a.sqlite\nVAULT_DIR=vault\n'
    );
  });
});

describe('assertSafeAudioPath', () => {
  it('accepts plain basenames', () => {
    expect(() => assertSafeAudioPath('7-1234.mp3')).not.toThrow();
  });

  it.each(['', 'a/b.mp3', 'a\\b.mp3', '.', '..', '/x.mp3'])(
    'rejects %j',
    (value) => {
      expect(() => assertSafeAudioPath(value)).toThrow(
        'Unsafe audioPath reference'
      );
    }
  );
});

describe('planUploadSplit', () => {
  it('dedups, overlaps, and reports orphans + missing', () => {
    expect(
      planUploadSplit(
        ['a.mp3', 'a.mp3', 'shared.mp3'],
        ['b.mp3', 'shared.mp3', 'gone.mp3'],
        ['a.mp3', 'b.mp3', 'shared.mp3', 'orphan.mp3']
      )
    ).toEqual({
      devFiles: ['a.mp3', 'shared.mp3'],
      prodFiles: ['b.mp3', 'gone.mp3', 'shared.mp3'],
      orphans: ['orphan.mp3'],
      missing: [{ env: 'prod', file: 'gone.mp3' }],
    });
  });
});

describe('prepareVaultMigration', () => {
  let root: string;
  let dataDir: string;

  const envFile = (env: 'dev' | 'prod', role: 'api' | 'worker'): string =>
    `.env.${role}.${env}`;

  async function writeEnvFiles(
    overrides: Record<string, string> = {}
  ): Promise<void> {
    const vars = (env: 'dev' | 'prod'): string =>
      [
        '# fixture env',
        `DB_PATH=packages/api/data/therapy-analyzer-${env}.sqlite`,
        'DB_UPLOADS_DIR=packages/api/data/uploads',
        `VAULT_DIR=packages/api/data/vault-${env}`,
      ].join('\n') + '\n';
    for (const env of ['dev', 'prod'] as const) {
      for (const role of ['api', 'worker'] as const) {
        let content = vars(env);
        const key = `${role}.${env}`;
        if (overrides[key] !== undefined) content = overrides[key];
        await fs.writeFile(path.join(root, envFile(env, role)), content);
      }
    }
  }

  function seedDb(dbPath: string, audioPaths: (string | null)[]): void {
    const connection = openLegacyDatabase(dbPath);
    try {
      initializeDatabase(connection);
      let index = 0;
      for (const audioPath of audioPaths) {
        connection
          .prepare(
            'INSERT INTO sessions (fileName, clientName, sessionName, date, sessionType, therapy, audioPath) VALUES (?,?,?,?,?,?,?)'
          )
          .run(
            `${index}.mp3`,
            'Client',
            `Session ${index}`,
            '2026-11-08',
            'individual',
            'CBT',
            audioPath
          );
        index += 1;
      }
    } finally {
      connection.close();
    }
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-migrate-prep-'));
    dataDir = path.join(root, 'packages', 'api', 'data');
    await fs.mkdir(path.join(dataDir, 'uploads'), { recursive: true });
    await writeEnvFiles();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function backups(): Promise<string[]> {
    const entries = await fs.readdir(dataDir);
    return entries.filter((entry) => entry.startsWith('pre-vault-backup-'));
  }

  it('backs up, splits, rewrites envs, and reports', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), [
      'dev-only.mp3',
      'shared.mp3',
      null,
    ]);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), [
      'prod-only.mp3',
      'shared.mp3',
    ]);
    for (const file of [
      'dev-only.mp3',
      'prod-only.mp3',
      'shared.mp3',
      'orphan.mp3',
    ]) {
      await fs.writeFile(path.join(dataDir, 'uploads', file), `bytes-${file}`);
    }

    const report = await prepareVaultMigration({ rootDir: root });

    expect(report.dryRun).toBe(false);
    expect(report.backupDir).not.toBeNull();
    expect(report.sharedFiles).toEqual(['shared.mp3']);
    expect(report.orphans).toEqual(['orphan.mp3']);
    expect(report.dev.status).toBe('prepared');
    expect(report.prod.status).toBe('prepared');
    expect(report.dev.referencedFiles).toBe(2);
    expect(report.restoreHint).toContain('manifest.json');

    // Backup: databases + uploads + env files + manifest.
    const backupEntries = await fs.readdir(report.backupDir!);
    expect(backupEntries).toEqual(
      expect.arrayContaining([
        'dev.sqlite',
        'prod.sqlite',
        'uploads',
        'env',
        'manifest.json',
      ])
    );
    expect(await fs.readdir(path.join(report.backupDir!, 'uploads'))).toEqual(
      expect.arrayContaining([
        'dev-only.mp3',
        'prod-only.mp3',
        'shared.mp3',
        'orphan.mp3',
      ])
    );

    // Split: overlap lands in both, shared original removed.
    expect(await fs.readdir(path.join(dataDir, 'uploads-dev'))).toEqual([
      'dev-only.mp3',
      'shared.mp3',
    ]);
    expect(await fs.readdir(path.join(dataDir, 'uploads-prod'))).toEqual([
      'prod-only.mp3',
      'shared.mp3',
    ]);
    await expect(fs.stat(path.join(dataDir, 'uploads'))).rejects.toThrow();

    // Env files point at per-env dirs, nothing else changed.
    for (const env of ['dev', 'prod'] as const) {
      for (const role of ['api', 'worker'] as const) {
        const content = await fs.readFile(
          path.join(root, envFile(env, role)),
          'utf8'
        );
        expect(content).toContain(
          `DB_UPLOADS_DIR=packages/api/data/uploads-${env}`
        );
        expect(content).toContain('# fixture env');
      }
    }
  });

  it('dry-run validates and changes nothing', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), ['a.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), ['b.mp3']);
    await fs.writeFile(path.join(dataDir, 'uploads', 'a.mp3'), 'a');
    await fs.writeFile(path.join(dataDir, 'uploads', 'b.mp3'), 'b');

    const report = await prepareVaultMigration({ rootDir: root, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.backupDir).toBeNull();
    expect(await backups()).toEqual([]);
    expect(await fs.readdir(dataDir)).toEqual(
      expect.arrayContaining(['uploads'])
    );
    expect(await fs.readdir(dataDir)).not.toContain('uploads-dev');
    const content = await fs.readFile(path.join(root, '.env.api.dev'), 'utf8');
    expect(content).toContain('DB_UPLOADS_DIR=packages/api/data/uploads');
  });

  it('aborts on missing recordings before any mutation', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), ['gone.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);

    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'dev:gone.mp3'
    );
    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      '--repair-missing-audio'
    );
    expect(await backups()).toEqual([]);
  });

  it('repairs dangling refs after backup, then splits', async () => {
    const devDb = path.join(dataDir, 'therapy-analyzer-dev.sqlite');
    seedDb(devDb, ['gone.mp3', 'ok.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);
    await fs.writeFile(path.join(dataDir, 'uploads', 'ok.mp3'), 'ok');

    const report = await prepareVaultMigration({
      rootDir: root,
      repairMissingAudio: true,
    });

    expect(report.repairedAudioRefs).toEqual([
      { env: 'dev', file: 'gone.mp3' },
    ]);
    // Legacy DB repaired; backup preserves the original references.
    const readRefs = (dbPath: string): (string | null)[] => {
      const connection = openLegacyDatabase(dbPath);
      try {
        return (
          connection.prepare('SELECT audioPath AS p FROM sessions').all() as {
            p: string | null;
          }[]
        ).map((row) => row.p);
      } finally {
        connection.close();
      }
    };
    expect(readRefs(devDb).sort()).toEqual([null, 'ok.mp3']);
    expect(readRefs(path.join(report.backupDir!, 'dev.sqlite')).sort()).toEqual(
      ['gone.mp3', 'ok.mp3']
    );
    // Split proceeded on the repaired references.
    expect(await fs.readdir(path.join(dataDir, 'uploads-dev'))).toEqual([
      'ok.mp3',
    ]);
  });

  it('dry-run with repair reports would-repair and changes nothing', async () => {
    const devDb = path.join(dataDir, 'therapy-analyzer-dev.sqlite');
    seedDb(devDb, ['gone.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);

    const report = await prepareVaultMigration({
      rootDir: root,
      dryRun: true,
      repairMissingAudio: true,
    });

    expect(report.repairedAudioRefs).toEqual([
      { env: 'dev', file: 'gone.mp3' },
    ]);
    expect(await backups()).toEqual([]);
    const connection = openLegacyDatabase(devDb);
    try {
      expect(
        (
          connection.prepare('SELECT audioPath AS p FROM sessions').all() as {
            p: string | null;
          }[]
        ).map((row) => row.p)
      ).toEqual(['gone.mp3']);
    } finally {
      connection.close();
    }
  });

  it('aborts on unsafe audioPath references', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), ['../evil.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);

    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'Unsafe audioPath reference'
    );
    expect(await backups()).toEqual([]);
  });

  it('aborts when a vault already exists', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), []);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);
    await fs.mkdir(path.join(dataDir, 'vault-dev', 'generations'), {
      recursive: true,
    });
    await fs.writeFile(path.join(dataDir, 'vault-dev', 'CURRENT'), 'gen_1');

    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'already exists'
    );
    expect(await backups()).toEqual([]);
  });

  it('ignores bare vault directory husks left by boot recovery', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), ['a.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), []);
    await fs.writeFile(path.join(dataDir, 'uploads', 'a.mp3'), 'a');
    await fs.mkdir(path.join(dataDir, 'vault-dev', 'generations'), {
      recursive: true,
    });

    const report = await prepareVaultMigration({ rootDir: root });

    expect(report.dev.status).toBe('prepared');
  });

  it('aborts when dev and prod share a database or vault', async () => {
    await writeEnvFiles({
      'api.prod':
        [
          'DB_PATH=packages/api/data/therapy-analyzer-dev.sqlite',
          'DB_UPLOADS_DIR=packages/api/data/uploads',
          'VAULT_DIR=packages/api/data/vault-prod',
        ].join('\n') + '\n',
      'worker.prod':
        [
          'DB_PATH=packages/api/data/therapy-analyzer-dev.sqlite',
          'DB_UPLOADS_DIR=packages/api/data/uploads',
          'VAULT_DIR=packages/api/data/vault-prod',
        ].join('\n') + '\n',
    });
    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'same database'
    );

    await writeEnvFiles();
    await fs.writeFile(
      path.join(root, '.env.api.prod'),
      [
        'DB_PATH=packages/api/data/therapy-analyzer-prod.sqlite',
        'DB_UPLOADS_DIR=packages/api/data/uploads',
        'VAULT_DIR=packages/api/data/vault-dev',
      ].join('\n') + '\n'
    );
    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'share one VAULT_DIR'
    );
  });

  it('aborts on api/worker DB_PATH mismatch', async () => {
    await fs.writeFile(
      path.join(root, '.env.worker.dev'),
      [
        'DB_PATH=packages/api/data/other.sqlite',
        'DB_UPLOADS_DIR=packages/api/data/uploads',
        'VAULT_DIR=packages/api/data/vault-dev',
      ].join('\n') + '\n'
    );
    await expect(prepareVaultMigration({ rootDir: root })).rejects.toThrow(
      'DB_PATH mismatch'
    );
  });

  it('skips envs without a database', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), ['b.mp3']);
    await fs.writeFile(path.join(dataDir, 'uploads', 'b.mp3'), 'b');

    const report = await prepareVaultMigration({ rootDir: root });

    expect(report.dev.status).toBe('skipped-no-database');
    expect(report.prod.status).toBe('prepared');
    expect(await fs.readdir(path.join(dataDir, 'uploads-dev'))).toEqual([]);
    expect(await fs.readdir(path.join(dataDir, 'uploads-prod'))).toEqual([
      'b.mp3',
    ]);
  });

  it('second run verifies the separated layout and changes nothing', async () => {
    seedDb(path.join(dataDir, 'therapy-analyzer-dev.sqlite'), ['a.mp3']);
    seedDb(path.join(dataDir, 'therapy-analyzer-prod.sqlite'), ['b.mp3']);
    await fs.writeFile(path.join(dataDir, 'uploads', 'a.mp3'), 'a');
    await fs.writeFile(path.join(dataDir, 'uploads', 'b.mp3'), 'b');
    await prepareVaultMigration({ rootDir: root });

    const report = await prepareVaultMigration({ rootDir: root });

    expect(report.dev.status).toBe('already-separated');
    expect(report.prod.status).toBe('already-separated');
    expect(report.backupDir).toBeNull();
    expect(await backups()).toHaveLength(1);
  });
});
