# @therascript/db — Developer Notes

Purpose: Shared SQLite initialization, migration, and thin query helpers.

## Key files
- Service: `src/sqliteService.ts`
- Config: `src/config.ts`
- Barrel: `src/index.ts`

## Behavior
- On first access, opens database, enables WAL, runs migrations up to `LATEST_SCHEMA_VERSION` (currently 7), and seeds system templates.
- Exposes `db` proxy and helper functions: `run`, `get`, `all`, `exec`, `transaction`, `closeDb`.

## Usage
- Each service (API/Worker) must call `configureDb({ dbPath, isDev })` before using `db`.

## Gotchas
- If `configureDb` wasn’t called, `getConfig()` throws; ensure configuration occurs in entrypoints (`api/src/server.ts`, `worker/src/index.ts`).