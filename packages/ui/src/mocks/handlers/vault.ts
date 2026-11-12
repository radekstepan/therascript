// packages/ui/src/mocks/handlers/vault.ts
//
// GET /api/vault/status — the App vault gate blocks the entire UI until
// the first status fetch succeeds (see App.tsx + useVaultStatus.ts).
// Without this mock the request falls through to the webpack-dev-server
// proxy (-> localhost:3001), which is down under E2E, so every spec
// stalls on the "Connecting to server…" spinner. E2E runs against
// ephemeral mock data with no real vault, so report the backend's
// legacy-fallback shape: unlocked + authenticated, gate open.
import { http, HttpResponse } from 'msw';

export const vaultHandlers = [
  http.get('/api/vault/status', () =>
    HttpResponse.json({
      status: 'unlocked',
      hasVault: false,
      authenticated: true,
      legacyFallback: true,
    })
  ),
];
