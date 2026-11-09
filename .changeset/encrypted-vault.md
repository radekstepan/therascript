---
'@therascript/vault': minor
'@therascript/db': minor
'@therascript/data': minor
'@therascript/config': minor
'@therascript/api': minor
'@therascript/worker': minor
'@therascript/ui': minor
---

Encrypted vault with a password on every app/API boot.

- Adds `@therascript/vault`: Argon2id key wrapping, atomic vault generations, AES-256-GCM recording containers with range playback, sealed `.tvbak` backups, memory-only browser sessions, unlock rate limiting, and the API→worker key pipe.
- API boots locked in vault mode, serves setup/unlock/lock/change-password, gates every non-public route, encrypts recordings, and migrates legacy installs into a staged generation before cutover.
- The API supervises the worker after setup/unlock and hands it the data keys over fd 3. A standalone worker now exits 0 with a notice on vault-capable installs instead of failing the dev/prod process group; plaintext legacy fallback still runs it standalone.
- Vault mode uses SQLite FTS5 search and skips Elasticsearch; schema migration V25 adds the FTS5 tables/triggers.
- Browser sessions use a 30-day `HttpOnly` cookie (Secure only for HTTPS origins) so reloads do not re-prompt while the API keeps running; every API restart revokes sessions.
- Shutdown drains requests, aborts SSE streams, unloads models while the database is still open, then locks the vault (stops the worker, closes the DB, clears keys, revokes sessions). Wrapper SIGTERM grace is raised to 25s.
- UI adds the vault setup/unlock screen, 401-driven gate refresh, password change, and encrypted export/import in Settings. Manual lock buttons are removed; locking belongs to shutdown.
- Documentation updated across the README, AGENTS, architecture, component map, navigation, API reference, data flows, schema reference, and vault README.
