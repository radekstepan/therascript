// packages/ui/src/mocks/handlers/readiness.ts
//
// GET /api/status/readiness — fired by App.tsx on every mount. The
// readiness spec flips the overlay on/off by calling
// /api/__e2e/set-ready, which writes to localStorage so the
// mutation survives page navigations (MSW runs in a different
// realm from the page's `globalThis`).
import { http, HttpResponse } from 'msw';
import { readReadiness } from '../state';

export const readinessHandlers = [
  http.get('/api/status/readiness', () => {
    const r = readReadiness();
    return HttpResponse.json({
      ready: r.ready,
      services: r.services,
      timestamp: new Date().toISOString(),
    });
  }),
];
