# @therascript/vault

Password-protected vault primitives for Therascript.
Pure logic + Node crypto; the only third-party dependency is
[`hash-wasm`](https://github.com/Daninet/hash-wasm) (Argon2id without a
native toolchain, so `yarn install` needs no compiler for this package).

## Layout

```
<vaultRoot>/
  CURRENT                  active generation id
  STAGING                  generation currently being built (setup/restore)
  CLEANUP.json             legacy paths still awaiting deletion
  generations/<genId>/
    vault.db               encrypted database (+ -wal/-shm sidecars while open)
    keys.json              wrapped keys, 0600
    SEALED                 fsync marker written before cutover
    recordings/            encrypted audio (*.enc)
```

## Formats (all versioned)

- **keys.json** — Argon2id(password, salt) → AES-256-GCM seal over
  `{database, recordings}` (32 bytes each). KDF params are bounded on read.
- **recordings** — `VREC01 || baseNonce || chunkSize || ct…`: AES-256-GCM
  chunks with position-bound nonces/AAD, so HTTP range playback decrypts
  only the covered chunks. See `src/recordings.ts`.
- **backups** — `VBAK01 || header || frames… || final`: Argon2id backup
  password + AES-256-GCM chunks with an authenticated empty final chunk,
  so truncation fails closed. See `src/backup.ts`.

## Cipher-capable binding

`openVaultDb` (in `@therascript/db`) requires
[`better-sqlite3-multiple-ciphers`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers)
(SQLite3MultipleCiphers, default cipher) — stock `better-sqlite3` has no
`key()` method, so `openVaultDb` fails closed with `Cipher support is
required` on the plaintext binding. Only `packages/db` depends on the
fork; every other package stays on stock `better-sqlite3`. The fork
ships N-API prebuilds in its tarball (no compile step) and bundles its
own types. Detection is a capability check (`typeof db.key ===
'function'`), and the raw data key travels as a `Buffer` argument —
never inside SQL text. Keying, wrong-key, and plaintext-rejection
coverage lives in `packages/db/src/vaultDb.test.ts`.

## Worker supervision

The API is the only process that can unlock the vault. In vault mode it spawns the
worker after setup/unlock and writes the data keys to the worker's inherited
private pipe (fd 3), so keys never travel through argv/env/files. The worker
opens the same encrypted generation, publishes its vault context, and only then
starts the BullMQ consumers; it signals readiness on stdout.

A standalone worker (`yarn dev:worker` / `yarn start:worker:prod`) is
legacy-only. If a vault exists, or the cipher-capable binding is available and
the API will boot in vault mode, it logs a notice and exits 0 instead of opening
the plaintext database. This keeps the dev/prod wrappers from tearing down the
whole stack with `--kill-others-on-fail`.

Shutdown is two-phase: `prepareShutdown()` drains in-flight requests and aborts
SSE streams while the database/keys stay open for model unload; `shutdown()`
then stops the supervised worker, closes the database, clears keys, and revokes
every browser session. The wrappers allow 25 seconds before `SIGKILL`.

## Upgrading an existing install

Each environment (dev/prod) gets its own vault: `VAULT_DIR` in
`.env.api.dev` / `.env.api.prod` (plus the worker files). One vault holds
exactly one database — envs must not share it. The upgrade needs no manual
config edits:

```
# 1. Stop the API + worker, then prepare (validates, backs up, splits
#    uploads per env, rewrites the env files). Dry-run first if unsure.
yarn build
node ./scripts/prepare-vault-migration.mjs --dry-run
yarn vault:prepare-migration

# 2. Boot dev, open the UI, set the dev vault password. setup() migrates
#    the legacy database into the vault, verifies it, then deletes the
#    legacy files. Verify, then repeat for prod.
#
# If sessions reference recordings that no longer exist on disk, prep
# aborts listing them (setup would fail the same way). Either restore the
# files, or re-run with --repair-missing-audio to clear the dangling
# references after the backup is taken.
```

Safety properties:

- The prep step validates everything before changing anything (vault must
  not exist yet, every referenced recording must be present and a plain
  file name, dev/prod must not share a database or vault). Any failure
  aborts with the tree untouched.
- The prep backup (`pre-vault-backup-<timestamp>/` inside the data dir)
  holds both databases (+ sidecars), the uploads, the env files, and a
  manifest with restore instructions; backup copies are opened to prove
  they are readable before the split proceeds.
- setup() migrates into a _staged_ generation: the legacy files are only
  deleted after integrity check, foreign-key check, per-table row counts,
  and recording coverage all pass on the copy. A crash or failed check
  discards the staged generation and leaves the legacy install usable.
- Migrate dev first and confirm the app works before touching prod.

## Security notes

- Passwords/keys never go to env files, logs, browser storage, or Redis.
  The API→worker handoff uses an inherited private pipe (fd 3), never
  argv/env.
- Browser sessions are memory-only bearer tokens compared in constant time.
  The `HttpOnly`/`SameSite=Lax` cookie persists for 30 days so a reload or
  browser restart does not re-prompt while the API keeps running, but the
  vault re-locks and revokes every session whenever the API process stops;
  the password is required again on the next start. The cookie is `Secure`
  only when `CORS_ORIGIN` uses HTTPS, so plain-HTTP localhost works.
- The unlocked process holds usable keys: run Therascript under a separate
  OS identity and restrict the vault directory when other agents share
  the host.
- Earlier plaintext copies and filesystem snapshots stay readable after
  migration; `CLEANUP.json` tracks their removal.
