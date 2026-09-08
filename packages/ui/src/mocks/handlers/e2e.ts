// packages/ui/src/mocks/handlers/e2e.ts
//
// Test-only hooks. Production code never hits /api/__e2e/* paths.
// Specs call POST /api/__e2e/reset in their beforeEach to reseed
// the mutable mock state to the known-good baseline, and
// readiness.spec.ts calls POST /api/__e2e/set-ready to flip the
// readiness overlay on/off.
import { http, HttpResponse } from 'msw';
import {
  e2eMockSeed,
  readReadiness,
  setE2eUploadError,
  writeReadiness,
  type ReadinessShape,
} from '../state';

export const e2eHandlers = [
  // Failure injection for POST /api/sessions/upload
  // (upload-failure.spec.ts). Body: { status, message } or {} to clear.
  http.post('/api/__e2e/set-upload-error', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
    };
    if (typeof body.status === 'number' && typeof body.message === 'string') {
      setE2eUploadError({ status: body.status, message: body.message });
    } else {
      setE2eUploadError(null);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/__e2e/reset', () => {
    e2eMockSeed();
    return HttpResponse.json({ ok: true });
  }),
  http.post('/api/__e2e/set-ready', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ready?: boolean;
      services?: ReadinessShape['services'];
    };
    const current = readReadiness();
    const next: ReadinessShape = {
      ready: typeof body.ready === 'boolean' ? body.ready : current.ready,
      services: body.services ?? current.services,
    };
    writeReadiness(next);
    return HttpResponse.json({ ok: true });
  }),
];
