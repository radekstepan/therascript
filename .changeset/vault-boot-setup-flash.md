---
'@therascript/ui': patch
---

# Fix vault boot race showing "Set vault password" instead of "Unlock vault"

- **No more setup/unlock flip on boot:** the UI boots faster than the API, so the first `GET /api/vault/status` can fail while the server is still starting. The vault gate fell back to `hasVault: false` and rendered the "Set vault password" (setup) form; the next poll (or a reload) then returned the real `hasVault: true` and flipped to "Unlock vault".
- **`useVaultStatus` exposes `isUnresolved`:** true until the first status fetch succeeds, so callers can distinguish "server not reached yet" from "genuinely no vault".
- **`App` waits for the first successful fetch:** while unresolved it keeps the connecting spinner (with a "Connecting to server…" hint when the fetch errored) instead of rendering the setup/unlock choice on the fallback value.
