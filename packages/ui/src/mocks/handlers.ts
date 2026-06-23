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
//   - GET /api/system/gpu-stats -> src/api/system.ts:90 (sidebar widget)
//   - GET /api/llm/status     -> src/api/llm.ts:31 (sidebar / chat view)
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

// `available: false` tells the UI to render the "GPU stats unavailable"
// state instead of trying to render zero GPUs. Matches the shape in
// types.ts:50-68.
const MOCK_GPU_STATS = {
  available: false,
  driverVersion: null,
  cudaVersion: null,
  gpus: [],
  summary: {
    gpuCount: 0,
    totalMemoryMb: 0,
    totalMemoryUsedMb: 0,
    avgGpuUtilizationPercent: null,
    avgMemoryUtilizationPercent: null,
    avgTemperatureCelsius: null,
    totalPowerDrawWatts: null,
    totalPowerLimitWatts: null,
    isUnifiedMemory: false,
  },
  systemMemory: {
    totalMb: 0,
    usedMb: 0,
    freeMb: 0,
    percentUsed: 0,
  },
};

// `loaded: false` so chat surfaces render the "configure model" CTA instead
// of a streaming indicator. Matches LlmStatus in types.ts:175-194.
const MOCK_LLM_STATUS = {
  activeModel: '',
  modelChecked: '',
  loaded: false,
  details: null,
  configuredContextSize: null,
  configuredTemperature: 0.7,
  configuredTopP: 0.9,
  configuredRepeatPenalty: 1.1,
  configuredNumGpuLayers: null,
  configuredThinkingBudget: -1,
  activeBaseUrl: 'http://localhost:1234',
  defaultBaseUrl: 'http://localhost:1234',
  isRemoteBaseUrl: false,
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

  http.get('/api/system/gpu-stats', () => HttpResponse.json(MOCK_GPU_STATS)),

  http.get('/api/llm/status', () => HttpResponse.json(MOCK_LLM_STATUS)),
];
