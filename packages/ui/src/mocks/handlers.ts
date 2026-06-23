// packages/ui/src/mocks/handlers.ts
//
// Single source of truth for MSW request handlers. Consumed by:
//   - src/mocks/browser.ts (runtime, when E2E_TESTING=true in the browser)
//   - src/mocks/server.ts  (Vitest + jsdom, future)
//
// Keep this file boring and exhaustive for the endpoints each spec touches.
// Any new handler must return a payload that matches the *backend* response
// shape so the UI's axios/React Query parsers don't blow up.
//
// Reference shapes:
//   - GET /api/sessions/      -> src/api/session.ts:29
//   - GET /api/chats          -> src/api/chat.ts:153
//   - GET /api/status/readiness -> src/api/meta.ts:31
//   - GET /api/jobs/active-count -> src/api/jobs.ts:5
import { http, HttpResponse } from 'msw';

const NOW_ISO = new Date().toISOString();
const INTAKE_DATE = '2026-06-23';

const MOCK_INTAKE_SESSION = {
  id: 1,
  fileName: 'intake-2026-06-23.mp3',
  clientName: 'Jane Doe',
  sessionName: 'Intake Session',
  date: `${INTAKE_DATE}T12:00:00.000Z`,
  sessionType: 'intake',
  therapy: 'cbt',
  numSpeakers: 2,
  audioPath: null,
  status: 'completed',
  whisperJobId: null,
  transcriptTokenCount: 1234,
  duration: 1800,
  errorMessage: null,
  showSpeakers: 1,
};

const MOCK_STANDALONE_CHAT = {
  id: 42,
  sessionId: null,
  timestamp: Date.parse('2026-06-22T10:15:00.000Z'),
  name: null,
  tags: null,
};

export const handlers = [
  // Readiness must return 200 + ready: true; otherwise App.tsx:241-243
  // mounts the <ReadinessOverlay/> and never renders the Landing page.
  http.get('/api/status/readiness', () =>
    HttpResponse.json({
      ready: true,
      services: {
        database: 'connected',
        elasticsearch: 'connected',
        llm: 'connected',
        whisper: 'connected',
      },
      timestamp: NOW_ISO,
    })
  ),

  http.get('/api/sessions/', () => HttpResponse.json([MOCK_INTAKE_SESSION])),

  http.get('/api/chats', () => HttpResponse.json([MOCK_STANDALONE_CHAT])),

  http.get('/api/jobs/active-count', () =>
    HttpResponse.json({ total: 0, transcription: 0, analysis: 0 })
  ),
];
