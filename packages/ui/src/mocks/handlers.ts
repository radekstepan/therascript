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
//   - POST /api/llm/set-model -> src/api/llm.ts:82 (model selector modal)
//   - GET /api/llm/available-models -> src/api/llm.ts:52 (model picker)
//   - POST /api/analysis-jobs      -> src/api/analysis.ts:39 (create)
//   - GET  /api/analysis-jobs      -> src/api/analysis.ts:48 (list)
//   - GET  /api/analysis-jobs/:id  -> src/api/analysis.ts:57 (detail)
//   - GET  /api/analysis-jobs/:id/stream -> src/api/analysis.ts (SSE)
//   - GET /api/usage/history       -> src/api/usage.ts:82 (UsageSection chart)
//   - GET /api/usage/stats         -> src/api/usage.ts:89 (UsageSection cards)
//   - GET /api/usage/logs          -> src/api/usage.ts:96 (UsageSection table)
import { http, HttpResponse } from 'msw';

const NOW_ISO = new Date().toISOString();
const INTAKE_DATE = '2026-06-23';

const MOCK_INTAKE_SESSION = {
  id: 1,
  fileName: 'intake-2026-06-23.mp3',
  clientName: 'Jane Doe',
  sessionName: 'Intake Session',
  date: `${INTAKE_DATE}T12:00:00.000Z`,
  sessionType: 'Intake',
  therapy: 'CBT',
  numSpeakers: 2,
  audioPath: null,
  status: 'completed',
  whisperJobId: null,
  transcriptTokenCount: 1234,
  duration: 1800,
  errorMessage: null,
  showSpeakers: 1,
};

const MOCK_FOLLOWUP_SESSION = {
  id: 2,
  fileName: 'followup-2026-06-30.mp3',
  clientName: 'Jane Doe',
  sessionName: 'Follow-up Session',
  date: '2026-06-30T12:00:00.000Z',
  sessionType: 'Individual',
  therapy: 'CBT',
  numSpeakers: 2,
  audioPath: null,
  status: 'completed',
  whisperJobId: null,
  transcriptTokenCount: 1450,
  duration: 1950,
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

// --- Mutable LLM state for the chat e2e spec ---------------------------
// The chat e2e spec exercises the "Configure AI Model" flow: it picks a
// model, hits /api/llm/set-model, then expects the next /api/llm/status
// poll to report `loaded: true` with `activeModel === <selected name>`.
// Handlers below mutate this state so the next status poll reflects the
// change. State is scoped to a single worker (module instance) and the
// chat spec runs serially to keep it consistent.
const MOCK_CHAT_ID = 10;
const MOCK_LOCAL_DEFAULT_BASE_URL = 'http://localhost:1234';

let mockActiveModel = '';
let mockModelLoaded = false;

// Accumulated chat messages for the mocked chat. Pushed to in the
// POST /api/sessions/1/chats/10/messages handler and read back by the
// GET /api/sessions/1/chats/10 handler. Without this buffer the chat
// refetch (triggered by ChatInterface after the stream completes) would
// return messages: [] and clobber the optimistic insert + the streamed
// AI response, so the bubbles would flash for ~100ms and disappear.
let mockChatMessages: Array<{
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  thinkingTokens?: number | null;
  duration?: number | null;
  isTruncated?: boolean;
}> = [];
let mockMessageCounter = 0;

const localModelDetails = (name: string) => ({
  name,
  modified_at: NOW_ISO,
  size: 4_500_000_000,
  digest: `sha256:${name}`,
  details: {
    format: 'gguf',
    family: name.startsWith('qwen') ? 'qwen' : 'llama',
    families: null,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
  },
  defaultContextSize: 8192,
  size_vram: 4_500_000_000,
  expires_at: null,
  architecture: null,
});

const LOCAL_MODELS = [
  localModelDetails('qwen2.5-7b-instruct'),
  localModelDetails('mistral-7b-local'),
];

const REMOTE_MODELS = [
  {
    ...localModelDetails('gpt-4o'),
    details: {
      format: 'gguf',
      family: 'gpt',
      families: null,
      parameter_size: 'unknown',
      quantization_level: 'unknown',
    },
  },
  {
    ...localModelDetails('claude-3.5-sonnet'),
    details: {
      format: 'gguf',
      family: 'claude',
      families: null,
      parameter_size: 'unknown',
      quantization_level: 'unknown',
    },
  },
];

// --- Mutable analysis job state for the deep-analysis e2e spec ---------
// The analysis e2e spec exercises the "Analyze Multiple Sessions" modal
// (CreateAnalysisJobModal): it POSTs to /api/analysis-jobs, expects the
// app to navigate to /analysis-jobs/:jobId, then asserts the streamed
// strategy + map + reduce phases render the end-state UI. The POST
// handler snapshots the request body here so the GET /:jobId and SSE
// stream handlers can echo it back consistently.
const MOCK_ANALYSIS_JOB_ID = 1;
const MOCK_INTERMEDIATE_QUESTION =
  'For each session, identify recurring anxiety triggers and the coping strategies the patient reported. Note any CBT techniques the therapist modeled in response.';
const MOCK_FINAL_SYNTHESIS_INSTRUCTIONS =
  'Synthesize the per-session findings into a single narrative that highlights evolution over time, common patterns, and concrete recommendations for the next session.';
const MOCK_REDUCE_RESPONSE =
  'Across both sessions the patient consistently described anxiety spikes tied to work deadlines and a tendency to catastrophize. In the follow-up, the therapist introduced cognitive reframing and the patient reported partial success applying it. Recommended next steps: continue reframing practice, introduce a worry log, and revisit the link between sleep quality and anxiety intensity.';

let mockAnalysisJob: {
  id: number;
  originalPrompt: string;
  shortPrompt: string;
  modelName: string;
  sessionIds: number[];
} | null = null;

// ============================================================
// --- e2e mock state (search, crud, templates, analysis jobs) --
// ============================================================
// Mutable stores for the new specs. Kept separate from
// `mockChatMessages` and `mockAnalysisJob` so concurrent specs
// don't clobber each other. `e2eMockSeed` (below) reseeds them
// via POST /api/__e2e/reset in the specs' `beforeEach`.
let e2eSessions: Array<{
  id: number;
  fileName: string;
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
  numSpeakers: number;
  audioPath: string | null;
  status: string;
  whisperJobId: string | null;
  transcriptTokenCount: number;
  duration: number;
  errorMessage: string | null;
  showSpeakers: number;
}> = [{ ...MOCK_INTAKE_SESSION }, { ...MOCK_FOLLOWUP_SESSION }];

let e2eSessionChats: Record<
  number,
  Array<{
    id: number;
    sessionId: number;
    timestamp: number;
    name: string | null;
  }>
> = {
  // 1 has two chats. Chat 10 is the most recent so the existing
  // session-chat.spec.ts auto-redirect to it still works; the
  // chat-navigation.spec.ts navigates to chat 11 explicitly.
  1: [
    {
      id: 10,
      sessionId: 1,
      timestamp: Date.parse('2026-06-23T14:00:00.000Z'),
      name: null,
    },
    {
      id: 11,
      sessionId: 1,
      timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
      name: 'Second chat',
    },
  ],
  2: [],
  3: [],
};

let e2eStandaloneChats: Array<{
  id: number;
  sessionId: null;
  timestamp: number;
  name: string | null;
  tags: string[] | null;
}> = [
  {
    id: 42,
    sessionId: null,
    timestamp: Date.parse('2026-06-22T10:15:00.000Z'),
    name: null,
    tags: null,
  },
  { id: 43, sessionId: null, timestamp: Date.now(), name: null, tags: null },
];

let e2eTemplates: Array<{
  id: number;
  title: string;
  text: string;
  createdAt: number;
}> = [
  {
    id: 1,
    title: 'system_analyst',
    text: 'You are a careful clinical analyst. Cite the speaker before each claim.',
    createdAt: Date.parse('2026-06-01T09:00:00.000Z'),
  },
  {
    id: 2,
    title: 'CBT reframing coach',
    text: 'Help the user identify cognitive distortions and propose reframes.',
    createdAt: Date.parse('2026-06-10T11:00:00.000Z'),
  },
];

let e2eNextTemplateId = 3;

let e2eAnalysisJobs: Array<{
  id: number;
  original_prompt: string;
  short_prompt: string;
  status:
    | 'processing'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'canceling'
    | 'pending'
    | 'generating_strategy'
    | 'mapping'
    | 'reducing';
  final_result: string | null;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
  model_name: string;
  context_size: number;
  strategy_json: string;
}> = [
  {
    id: 100,
    original_prompt: 'Summarize sleep issues across these sessions.',
    short_prompt: 'Sleep Issues (mapping)',
    status: 'mapping',
    final_result: null,
    error_message: null,
    created_at: Date.now() - 60_000,
    completed_at: null,
    model_name: 'qwen2.5-7b-instruct',
    context_size: 8192,
    strategy_json: JSON.stringify({
      intermediate_question: 'Identify sleep-related complaints per session.',
      final_synthesis_instructions:
        'Combine the per-session findings into a short narrative.',
    }),
  },
  {
    id: 101,
    original_prompt: 'Find progress markers for client goals.',
    short_prompt: 'Client Progress (completed)',
    status: 'completed',
    final_result:
      'The client reached two of three goals in the last 4 sessions.',
    error_message: null,
    created_at: Date.now() - 600_000,
    completed_at: Date.now() - 580_000,
    model_name: 'mistral-7b-local',
    context_size: 8192,
    strategy_json: JSON.stringify({
      intermediate_question: 'List per-session goal progress.',
      final_synthesis_instructions:
        'Aggregate progress markers into a summary.',
    }),
  },
];

// Readiness overlay test hook. The readiness spec sets this to false
// before navigating to the app; the readiness handler reads it on
// every call so the overlay either shows or clears accordingly.
//
// The flag is persisted to `localStorage` (key: `e2e:readiness`)
// because MSW handlers run inside the service worker's JS
// context, which is a different realm from the page's
// `globalThis`. `localStorage` is the only storage the page and
// the SW share. Page navigations re-evaluate the page's bundle
// and would otherwise reset a module-level `let`, but the
// `localStorage` write survives.
const E2E_READINESS_KEY = 'e2e:readiness';
type ReadinessShape = {
  ready: boolean;
  services: {
    database: string;
    elasticsearch: string;
    llm: string;
    whisper: string;
  };
};
const DEFAULT_READINESS: ReadinessShape = {
  ready: true,
  services: {
    database: 'connected',
    elasticsearch: 'connected',
    llm: 'connected',
    whisper: 'connected',
  },
};
const readReadiness = (): ReadinessShape => {
  try {
    const raw = localStorage.getItem(E2E_READINESS_KEY);
    if (!raw) return DEFAULT_READINESS;
    return { ...DEFAULT_READINESS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READINESS;
  }
};
const writeReadiness = (next: ReadinessShape) => {
  try {
    localStorage.setItem(E2E_READINESS_KEY, JSON.stringify(next));
  } catch {
    // Ignore — localStorage is unavailable in some test contexts.
  }
};

const e2eMockSeed = () => {
  e2eSessions = [{ ...MOCK_INTAKE_SESSION }, { ...MOCK_FOLLOWUP_SESSION }];
  e2eSessionChats = {
    1: [
      {
        id: 10,
        sessionId: 1,
        timestamp: Date.parse('2026-06-23T14:00:00.000Z'),
        name: null,
      },
      {
        id: 11,
        sessionId: 1,
        timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
        name: 'Second chat',
      },
    ],
    2: [],
    3: [],
  };
  e2eStandaloneChats = [
    {
      id: 42,
      sessionId: null,
      timestamp: Date.parse('2026-06-22T10:15:00.000Z'),
      name: null,
      tags: null,
    },
    {
      id: 43,
      sessionId: null,
      timestamp: Date.now(),
      name: null,
      tags: null,
    },
  ];
  e2eTemplates = [
    {
      id: 1,
      title: 'system_analyst',
      text: 'You are a careful clinical analyst. Cite the speaker before each claim.',
      createdAt: Date.parse('2026-06-01T09:00:00.000Z'),
    },
    {
      id: 2,
      title: 'CBT reframing coach',
      text: 'Help the user identify cognitive distortions and propose reframes.',
      createdAt: Date.parse('2026-06-10T11:00:00.000Z'),
    },
  ];
  e2eNextTemplateId = 3;
  e2eAnalysisJobs = [
    {
      id: 100,
      original_prompt: 'Summarize sleep issues across these sessions.',
      short_prompt: 'Sleep Issues (mapping)',
      status: 'mapping',
      final_result: null,
      error_message: null,
      created_at: Date.now() - 60_000,
      completed_at: null,
      model_name: 'qwen2.5-7b-instruct',
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: 'Identify sleep-related complaints per session.',
        final_synthesis_instructions:
          'Combine the per-session findings into a short narrative.',
      }),
    },
    {
      id: 101,
      original_prompt: 'Find progress markers for client goals.',
      short_prompt: 'Client Progress (completed)',
      status: 'completed',
      final_result:
        'The client reached two of three goals in the last 4 sessions.',
      error_message: null,
      created_at: Date.now() - 600_000,
      completed_at: Date.now() - 580_000,
      model_name: 'mistral-7b-local',
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: 'List per-session goal progress.',
        final_synthesis_instructions:
          'Aggregate progress markers into a summary.',
      }),
    },
  ];
  writeReadiness(DEFAULT_READINESS);
};

let mockStandaloneChatMessages: Array<{
  id: number;
  chatId: number;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  thinkingTokens?: number | null;
  duration?: number | null;
  isTruncated?: boolean;
}> = [];

// --- Usage mock data (UsageSection in SettingsPage) -------------------
// UsageSection.tsx:67-85 fires /api/usage/{history,stats,logs} on mount
// and on every filter change. Without MSW handlers, the requests fall
// through to the webpack-dev-server proxy, hit a stopped API on
// http://localhost:3001, and produce ECONNREFUSED noise in test output.
// Shapes mirror src/api/usage.ts interfaces and the Elysia response
// schemas in packages/api/src/routes/usageRoutes.ts:9-114.
const USAGE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Deterministic but realistic-looking per-week cost seeds. Re-mixed
// across `weeks` so the chart always shows a non-trivial bar pattern
// (mix of LLM-only, whisper-only, both, and one empty week) regardless
// of the `?weeks=N` query param the UsageSection sends.
const USAGE_LLM_WEEK_TOKENS = [
  142_000, 98_000, 165_000, 78_000, 0, 121_000, 88_000, 154_000, 67_000,
  110_000, 132_000, 95_000,
];
const USAGE_WHISPER_WEEK_SECS = [
  312, 240, 0, 0, 195, 268, 0, 305, 412, 220, 0, 178,
];

const buildUsageWeeks = (count: number) => {
  const now = Date.now();
  const currentWeekEnd = now - (now % USAGE_WEEK_MS) + USAGE_WEEK_MS;
  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const idx = (count - 1 - i) % USAGE_LLM_WEEK_TOKENS.length;
    const weekEnd = currentWeekEnd - i * USAGE_WEEK_MS;
    const weekStart = weekEnd - USAGE_WEEK_MS;
    const llmTokens = USAGE_LLM_WEEK_TOKENS[idx];
    const whisperSecs = USAGE_WHISPER_WEEK_SECS[idx];
    // Qwen 2.5 7B: $0.18/1M prompt, $0.18/1M completion (mock).
    const llmCost = (llmTokens / 1_000_000) * 0.18;
    // Whisper: $0.006/min (mock).
    const whisperCost = (whisperSecs / 60) * 0.006;
    weeks.push({
      weekStart,
      weekEnd,
      llm: {
        totalPromptTokens: Math.floor(llmTokens * 0.7),
        totalCompletionTokens: Math.floor(llmTokens * 0.3),
        estimatedCost: llmCost,
        callCount:
          llmTokens > 0 ? Math.max(1, Math.floor(llmTokens / 3500)) : 0,
      },
      whisper: {
        totalDuration: whisperSecs,
        estimatedCost: whisperCost,
        callCount:
          whisperSecs > 0 ? Math.max(1, Math.floor(whisperSecs / 60)) : 0,
      },
      totalCost: llmCost + whisperCost,
    });
  }
  return weeks;
};

const MOCK_USAGE_HISTORY = {
  weeks: buildUsageWeeks(12),
  pricing: {
    llm: {
      'qwen2.5-7b-instruct': {
        promptCostPer1M: 0.18,
        completionCostPer1M: 0.18,
      },
      'mistral-7b-local': { promptCostPer1M: 0.2, completionCostPer1M: 0.2 },
    },
    whisper: {
      'large-v3': { costPerMinute: 0.006 },
    },
  },
};

const MOCK_USAGE_STATS = (() => {
  const llmTotalPrompt = 985_400;
  const llmTotalCompletion = 422_300;
  const llmTotalCost =
    ((llmTotalPrompt + llmTotalCompletion) / 1_000_000) * 0.18;
  const whisperTotalDuration = 8_124;
  const whisperTotalCost = (whisperTotalDuration / 60) * 0.006;
  return {
    llm: {
      totalPromptTokens: llmTotalPrompt,
      totalCompletionTokens: llmTotalCompletion,
      estimatedCost: llmTotalCost,
      callCount: 482,
      callsByModel: {
        'qwen2.5-7b-instruct': 312,
        'mistral-7b-local': 170,
      },
      callsBySource: {
        'session-chat': 264,
        analysis: 138,
        'standalone-chat': 80,
      },
    },
    whisper: {
      totalDuration: whisperTotalDuration,
      estimatedCost: whisperTotalCost,
      callCount: 14,
      callsByModel: {
        'large-v3': 14,
      },
    },
    totalEstimatedCost: llmTotalCost + whisperTotalCost,
  };
})();

const buildUsageLogs = () => {
  const HOUR = 60 * 60 * 1000;
  const now = Date.now();
  return [
    {
      id: 1,
      type: 'llm' as const,
      source: 'session-chat',
      model: 'qwen2.5-7b-instruct',
      promptTokens: 1840,
      completionTokens: 96,
      duration: null,
      timestamp: now - 12 * 60_000,
      estimatedCost: 0.000349,
    },
    {
      id: 2,
      type: 'whisper' as const,
      source: 'transcription',
      model: 'large-v3',
      promptTokens: null,
      completionTokens: null,
      duration: 1842,
      timestamp: now - 3 * HOUR,
      estimatedCost: 0.1842,
    },
    {
      id: 3,
      type: 'llm' as const,
      source: 'analysis',
      model: 'mistral-7b-local',
      promptTokens: 4210,
      completionTokens: 312,
      duration: null,
      timestamp: now - 5 * HOUR,
      estimatedCost: 0.000814,
    },
    {
      id: 4,
      type: 'llm' as const,
      source: 'session-chat',
      model: 'qwen2.5-7b-instruct',
      promptTokens: 1208,
      completionTokens: 64,
      duration: null,
      timestamp: now - 9 * HOUR,
      estimatedCost: 0.000229,
    },
    {
      id: 5,
      type: 'whisper' as const,
      source: 'transcription',
      model: 'large-v3',
      promptTokens: null,
      completionTokens: null,
      duration: 2010,
      timestamp: now - 26 * HOUR,
      estimatedCost: 0.201,
    },
    {
      id: 6,
      type: 'llm' as const,
      source: 'standalone-chat',
      model: 'qwen2.5-7b-instruct',
      promptTokens: 612,
      completionTokens: 188,
      duration: null,
      timestamp: now - 31 * HOUR,
      estimatedCost: 0.000144,
    },
    {
      id: 7,
      type: 'llm' as const,
      source: 'analysis',
      model: 'qwen2.5-7b-instruct',
      promptTokens: 3842,
      completionTokens: 240,
      duration: null,
      timestamp: now - 2 * 24 * HOUR,
      estimatedCost: 0.000735,
    },
    {
      id: 8,
      type: 'whisper' as const,
      source: 'transcription',
      model: 'large-v3',
      promptTokens: null,
      completionTokens: null,
      duration: 1602,
      timestamp: now - 3 * 24 * HOUR,
      estimatedCost: 0.1602,
    },
  ];
};

export const handlers = [
  // Readiness, sessions list, single-session fetch, and the chat list
  // are all served by the e2e-aware handlers further below. The block
  // intentionally sits after the existing transcript/chat endpoints
  // so those keep working for the chat + transcript-edit specs.

  // Structured transcript paragraphs for the intake session. Small but
  // non-empty so the Transcription panel renders content and the
  // transcript token count is plausibly non-zero.
  http.patch('/api/sessions/1/transcript', async () => {
    // Return updated transcript
    return HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'Therapist: Hi Jane, thanks for coming in today. Can you tell me what brought you here?',
        speaker: 'Therapist',
      },
      {
        id: 1,
        timestamp: 6000,
        text: 'Jane: I have been feeling VERY anxious for the past few months, especially at work.',
        speaker: 'Jane',
      },
      {
        id: 2,
        timestamp: 14000,
        text: 'Therapist: That sounds difficult. Let us explore that together.',
        speaker: 'Therapist',
      },
    ]);
  }),

  http.get('/api/sessions/1/transcript', () =>
    HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'Therapist: Hi Jane, thanks for coming in today. Can you tell me what brought you here?',
        speaker: 'Therapist',
      },
      {
        id: 1,
        timestamp: 6000,
        text: 'Jane: I have been feeling anxious for the past few months, especially at work.',
        speaker: 'Jane',
      },
      {
        id: 2,
        timestamp: 14000,
        text: 'Therapist: That sounds difficult. Let us explore that together.',
        speaker: 'Therapist',
      },
    ])
  ),

  // Context-usage snapshot for the active chat. Non-zero prompt/percent
  // so the ChatPanelHeader progress bar renders and the chat e2e spec
  // can assert it is visible.
  http.get('/api/sessions/1/chats/10/context-usage', () =>
    HttpResponse.json({
      model: {
        name: mockActiveModel || 'mock-model',
        configuredContextSize: 8192,
        defaultContextSize: 8192,
        effectiveContextSize: 8192,
      },
      breakdown: {
        systemTokens: 312,
        transcriptTokens: 1234,
        chatHistoryTokens: 0,
        inputDraftTokens: 6,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 1552,
        percentUsed: 0.19,
        remainingForPrompt: 5616,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    })
  ),

  // Streaming chat message endpoint. Emits a thinking status, two
  // visible chunks ("Hello " then "from the mock LLM"), then a done
  // event with completionTokens + duration so the bubble's tokens/s
  // metric renders. Sets X-User-Message-Id so the optimistic user
  // message gets reconciled by the client. Persists the user + AI
  // messages into mockChatMessages so a subsequent GET /chats/10
  // refetch (triggered by ChatInterface after the stream completes)
  // does not clobber the optimistic insert.
  http.post('/api/sessions/1/chats/10/messages', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const userText = typeof body.text === 'string' ? body.text : '';

    mockMessageCounter += 1;
    const userMessageId = 100 + (mockMessageCounter - 1) * 2;
    const aiMessageId = 101 + (mockMessageCounter - 1) * 2;
    const timestamp = Date.now();

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ status: 'thinking' }));
        controller.enqueue(sse({ status: 'responding' }));
        controller.enqueue(sse({ chunk: 'Hello ' }));
        controller.enqueue(sse({ chunk: 'from the mock LLM' }));
        controller.enqueue(
          sse({
            done: true,
            completionTokens: 24,
            thinkingTokens: 0,
            duration: 1200,
            isTruncated: false,
          })
        );
        controller.close();
      },
    });

    mockChatMessages.push({
      id: userMessageId,
      chatId: MOCK_CHAT_ID,
      sender: 'user',
      text: userText,
      timestamp,
    });
    mockChatMessages.push({
      id: aiMessageId,
      chatId: MOCK_CHAT_ID,
      sender: 'ai',
      text: 'Hello from the mock LLM',
      timestamp: timestamp + 1,
      promptTokens: null,
      completionTokens: 24,
      thinkingTokens: 0,
      duration: 1200,
      isTruncated: false,
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-User-Message-Id': String(userMessageId),
      },
    });
  }),

  // /api/chats list + create is served by the e2e-aware handlers
  // further below.

  http.get('/api/chats/:chatId', ({ params }) => {
    const chatId = parseInt(params.chatId as string, 10);
    return HttpResponse.json({
      id: chatId,
      sessionId: null,
      timestamp: Date.now(),
      name: null,
      tags: null,
      messages: chatId === 43 ? mockStandaloneChatMessages : [],
    });
  }),

  http.get('/api/chats/:chatId/context-usage', () => {
    return HttpResponse.json({
      model: {
        name: mockActiveModel || 'mock-model',
        configuredContextSize: 8192,
        defaultContextSize: 8192,
        effectiveContextSize: 8192,
      },
      breakdown: {
        systemTokens: 312,
        transcriptTokens: 0,
        chatHistoryTokens: 0,
        inputDraftTokens: 6,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 318,
        percentUsed: 0.04,
        remainingForPrompt: 6850,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    });
  }),

  http.post('/api/chats/:chatId/messages', async ({ request, params }) => {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const userText = typeof body.text === 'string' ? body.text : '';
    const chatId = parseInt(params.chatId as string, 10);

    mockMessageCounter += 1;
    const userMessageId = 100 + (mockMessageCounter - 1) * 2;
    const aiMessageId = 101 + (mockMessageCounter - 1) * 2;
    const timestamp = Date.now();

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sse({ status: 'thinking' }));
        controller.enqueue(sse({ status: 'responding' }));
        controller.enqueue(sse({ chunk: 'Hello ' }));
        controller.enqueue(sse({ chunk: 'from standalone mock LLM' }));
        controller.enqueue(
          sse({
            done: true,
            completionTokens: 24,
            thinkingTokens: 0,
            duration: 1200,
            isTruncated: false,
          })
        );
        controller.close();
      },
    });

    mockStandaloneChatMessages.push({
      id: userMessageId,
      chatId,
      sender: 'user',
      text: userText,
      timestamp,
    });
    mockStandaloneChatMessages.push({
      id: aiMessageId,
      chatId,
      sender: 'ai',
      text: 'Hello from standalone mock LLM',
      timestamp: timestamp + 1,
      promptTokens: null,
      completionTokens: 24,
      thinkingTokens: 0,
      duration: 1200,
      isTruncated: false,
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'X-User-Message-Id': String(userMessageId),
      },
    });
  }),

  http.get('/api/transcription/status/:jobId', ({ params }) => {
    return HttpResponse.json({
      job_id: params.jobId,
      status: 'completed',
      progress: 100,
      duration: 120,
      message: 'Transcription completed',
    });
  }),

  http.post('/api/sessions/upload', async () => {
    return HttpResponse.json(
      {
        sessionId: 3,
        jobId: 'mock-job-id',
        message: 'Upload successful, transcription queued.',
      },
      { status: 202 }
    );
  }),

  http.get('/api/sessions/3', () =>
    HttpResponse.json({
      ...MOCK_INTAKE_SESSION,
      id: 3,
      status: 'completed',
      chats: [],
    })
  ),

  http.get('/api/sessions/3/transcript', () =>
    HttpResponse.json([
      {
        id: 0,
        timestamp: 0,
        text: 'New session transcript.',
        speaker: 'Therapist',
      },
    ])
  ),

  http.get('/api/jobs/active-count', () =>
    HttpResponse.json({ total: 0, transcription: 0, analysis: 0 })
  ),

  http.get('/api/system/gpu-stats', () => HttpResponse.json(MOCK_GPU_STATS)),

  http.post('/api/admin/reindex-elasticsearch', () =>
    HttpResponse.json({
      message: 'Re-indexing complete',
      transcriptsIndexed: 0,
      messagesIndexed: 0,
      errors: [],
    })
  ),

  http.post('/api/jobs/reset-transcription', () =>
    HttpResponse.json({
      success: true,
    })
  ),

  // /api/llm/available-models branches on the baseUrl query param so the
  // LlmEndpointModelPicker can render disjoint local and remote lists.
  // The chat e2e spec asserts that the two lists differ.
  http.get('/api/llm/available-models', ({ request }) => {
    const url = new URL(request.url);
    const baseUrl = url.searchParams.get('baseUrl');
    const isLocal = !baseUrl || baseUrl === MOCK_LOCAL_DEFAULT_BASE_URL;
    return HttpResponse.json({
      models: isLocal ? LOCAL_MODELS : REMOTE_MODELS,
    });
  }),

  // /api/llm/models/:name/estimate-vram is fired by LlmSettingsForm
  // whenever a model is selected. The real backend computes the
  // estimate from model architecture + context size; we return a
  // canned value so the form doesn't fall through to the webpack
  // proxy (and produce ECONNREFUSED noise in test output).
  http.get(/\/api\/llm\/models\/[^/]+\/estimate-vram$/, () =>
    HttpResponse.json({
      model: 'mock-model',
      context_size: 8192,
      estimated_vram_bytes: 5_500_000_000,
      estimated_ram_bytes: 0,
      vram_per_token_bytes: 256,
      breakdown: {
        weights_bytes: 4_500_000_000,
        weights_vram_bytes: 4_500_000_000,
        weights_ram_bytes: 0,
        kv_cache_bytes: 800_000_000,
        overhead_bytes: 200_000_000,
      },
    })
  ),

  // /api/llm/set-model flips the in-memory state so the next
  // /api/llm/status poll returns `loaded: true` and `activeModel` set.
  http.post('/api/llm/set-model', async ({ request }) => {
    const body = (await request.json()) as {
      modelName?: string;
      baseUrl?: string | null;
    };
    if (body.modelName) {
      mockActiveModel = body.modelName;
      mockModelLoaded = true;
    }
    return HttpResponse.json({
      message: `Active model set to ${body.modelName}`,
    });
  }),

  // /api/llm/status — reflects the mutable state set by /set-model.
  http.get('/api/llm/status', () => {
    const details = mockActiveModel ? localModelDetails(mockActiveModel) : null;
    return HttpResponse.json({
      activeModel: mockActiveModel,
      modelChecked: mockActiveModel,
      loaded: mockModelLoaded,
      details,
      configuredContextSize: mockActiveModel ? 8192 : null,
      configuredTemperature: 0.7,
      configuredTopP: 0.9,
      configuredRepeatPenalty: 1.1,
      configuredNumGpuLayers: null,
      configuredThinkingBudget: -1,
      activeBaseUrl: MOCK_LOCAL_DEFAULT_BASE_URL,
      defaultBaseUrl: MOCK_LOCAL_DEFAULT_BASE_URL,
      isRemoteBaseUrl: false,
    });
  }),

  // --- Analysis job handlers (deep-analysis e2e spec) -------------------
  // POST /api/analysis-jobs — CreateAnalysisJobModal.submit mutates here.
  // We snapshot the request body so GET /:jobId and the SSE stream can
  // echo the same prompt, model, and sessionIds back. The backend returns
  // 202 + { jobId }; we follow the real shape so the modal's
  // `navigate('/analysis-jobs')` lands on the correct URL.
  http.post('/api/analysis-jobs', async ({ request }) => {
    const body = (await request.json()) as {
      prompt?: string;
      modelName?: string | null;
      sessionIds?: number[];
    };
    mockAnalysisJob = {
      id: MOCK_ANALYSIS_JOB_ID,
      originalPrompt: body.prompt ?? '',
      shortPrompt: 'Anxiety Trends Analysis',
      modelName: body.modelName || mockActiveModel || 'qwen2.5-7b-instruct',
      sessionIds: body.sessionIds ?? [],
    };
    return HttpResponse.json({ jobId: MOCK_ANALYSIS_JOB_ID }, { status: 202 });
  }),

  // GET /api/analysis-jobs — list view. The union of
  // `e2eAnalysisJobs` (analysis-jobs.spec.ts) and `mockAnalysisJob`
  // (the deep-analysis spec) is served by the e2e-aware handler
  // further below. The deep-analysis spec finds its row by the
  // unique `Anxiety Trends Analysis` short_prompt so the order is
  // irrelevant.

  // GET /api/analysis-jobs/:jobId — full job detail with parsed strategy
  // + per-session summaries + final_result. Mirrors the real backend's
  // `getAnalysisJobHandler` shape (analysisRoutes.ts:53) so React Query
  // and the JobDetailView can render the end-state UI directly.
  http.get('/api/analysis-jobs/1', () => {
    if (!mockAnalysisJob) {
      return HttpResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    const created = Date.now() - 5_000;
    const summaries = mockAnalysisJob.sessionIds.map((sessionId, idx) => {
      const session =
        sessionId === 1 ? MOCK_INTAKE_SESSION : MOCK_FOLLOWUP_SESSION;
      return {
        id: 100 + idx,
        analysis_job_id: MOCK_ANALYSIS_JOB_ID,
        session_id: sessionId,
        summary_text: `Session ${sessionId} analysis: noted anxiety spikes tied to work deadlines.`,
        status: 'completed',
        error_message: null,
        sessionName: session.sessionName,
        sessionDate: session.date,
      };
    });
    return HttpResponse.json({
      id: MOCK_ANALYSIS_JOB_ID,
      original_prompt: mockAnalysisJob.originalPrompt,
      short_prompt: mockAnalysisJob.shortPrompt,
      status: 'completed',
      final_result: MOCK_REDUCE_RESPONSE,
      error_message: null,
      created_at: created,
      completed_at: created + 4_000,
      model_name: mockAnalysisJob.modelName,
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      }),
      summaries,
      strategy: {
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      },
    });
  }),

  // GET /api/analysis-jobs/:jobId/stream — SSE feed for the JobDetailView.
  // Mirrors the event-shape contract in useAnalysisStream.ts:8-33 and
  // streamAnalysisJobHandler (analysisHandler.ts:644). The real handler
  // uses setImmediate between events to yield to the event loop; we use
  // setTimeout(50ms) for the same reason — without a yield React cannot
  // process intermediate state updates between enqueues.
  //
  // For the end-state-only assertion, we send the full completed state
  // in the snapshot and then a terminal `status: 'completed'` to close
  // the EventSource (useAnalysisStream.ts:285). The hook restores the
  // map/reduce logs from the snapshot, the JobDetailView's polled
  // `analysisJob` query returns the matching completed state from the
  // GET /:jobId handler above, and the UI shows the deep-analysis
  // end-state without any per-phase timing assertions.
  http.get('/api/analysis-jobs/1/stream', () => {
    if (!mockAnalysisJob) {
      return new HttpResponse('Job not found', { status: 404 });
    }
    const created = Date.now() - 5_000;
    const completed = created + 4_000;
    const summaries = mockAnalysisJob.sessionIds.map((sessionId, idx) => {
      const session =
        sessionId === 1 ? MOCK_INTAKE_SESSION : MOCK_FOLLOWUP_SESSION;
      return {
        id: 100 + idx,
        analysis_job_id: MOCK_ANALYSIS_JOB_ID,
        session_id: sessionId,
        summary_text: `Session ${sessionId} analysis: noted anxiety spikes tied to work deadlines.`,
        status: 'completed',
        error_message: null,
        sessionName: session.sessionName,
        sessionDate: session.date,
      };
    });
    const jobSnapshot = {
      id: MOCK_ANALYSIS_JOB_ID,
      original_prompt: mockAnalysisJob.originalPrompt,
      short_prompt: mockAnalysisJob.shortPrompt,
      status: 'completed',
      final_result: MOCK_REDUCE_RESPONSE,
      error_message: null,
      created_at: created,
      completed_at: completed,
      model_name: mockAnalysisJob.modelName,
      context_size: 8192,
      strategy_json: JSON.stringify({
        intermediate_question: MOCK_INTERMEDIATE_QUESTION,
        final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
      }),
    };

    const encoder = new TextEncoder();
    const sse = (payload: unknown) =>
      encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (data: object) => {
          controller.enqueue(sse(data));
        };

        // 1. Snapshot with the fully completed state. The hook reads
        // `summaries[*].summary_text` into mapLogs and
        // `job.final_result` into reduceLog so the visible UI matches
        // the final answer when the stream closes.
        enqueue({
          type: 'snapshot',
          phase: 'status',
          job: jobSnapshot,
          summaries,
        });

        // 2. Send a `reduce` end event with non-zero completionTokens
        // + duration so the hook populates reduceMetrics. The
        // AnalysisJobsPage.tsx:621 tokens/s footer is gated on both
        // fields being truthy, so without this the metric never
        // renders. The end event must arrive *before* the terminal
        // status because the hook closes the EventSource on
        // status: 'completed' (useAnalysisStream.ts:285).
        enqueue({
          type: 'end',
          phase: 'reduce',
          promptTokens: 1840,
          completionTokens: 96,
          duration: 4800,
        });

        // 3. Yield so the snapshot + end events can flush, then send
        // the terminal status event to close the stream.
        setTimeout(() => {
          enqueue({
            type: 'status',
            phase: 'status',
            status: 'completed',
          });
          controller.close();
        }, 50);
      },
    });

    return new HttpResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
      },
    });
  }),

  // GET /api/usage/history?weeks=N — drives the Weekly Cost History bar
  // chart. UsageSection.tsx:57 defaults to 12 weeks and re-queries on
  // every Select.Root change (4, 8, or 12 weeks), so we honor the param.
  http.get('/api/usage/history', ({ request }) => {
    const url = new URL(request.url);
    const weeksParam = url.searchParams.get('weeks');
    const weeks = weeksParam ? Math.max(1, parseInt(weeksParam, 10) || 12) : 12;
    return HttpResponse.json({
      weeks: buildUsageWeeks(weeks),
      pricing: MOCK_USAGE_HISTORY.pricing,
    });
  }),

  // GET /api/usage/stats — powers the Total LLM Tokens / Total Whisper
  // Duration / Total Estimated Cost cards and the Model + Source filter
  // dropdowns in UsageSection.tsx:366-405. callsByModel and
  // callsBySource are intentionally non-empty so the Select.Content
  // dropdowns render real options.
  http.get('/api/usage/stats', () => HttpResponse.json(MOCK_USAGE_STATS)),

  // GET /api/usage/logs — drives the "Detailed Usage Logs" table in
  // UsageSection.tsx:418-552. Mix of LLM and whisper entries with
  // recency-graded timestamps so formatDistanceToNow produces a range
  // of "X minutes/hours/days ago" labels. Query params (start, end,
  // type, model, source, limit, offset) are accepted but ignored — the
  // real backend filters server-side; the mock always returns a stable
  // payload so the table renders without 500s.
  http.get('/api/usage/logs', () => {
    const items = buildUsageLogs();
    return HttpResponse.json({
      items,
      total: items.length,
      limit: 100,
      offset: 0,
    });
  }),

  // ============================================================
  // --- e2e mock state (search, crud, templates, analysis jobs) --
  // ============================================================
  // The state itself is declared at module scope above (so the
  // handlers stay closure-light). The handlers below only read /
  // mutate the same variables.

  // Test-only hooks. Production code never hits these.
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

  // GET /api/status/readiness — reads the localStorage-backed flag
  // so the readiness spec can flip the overlay on/off across page
  // navigations. The page and the MSW service worker share
  // localStorage, while the page's module-level state would reset
  // on every page navigation.
  http.get('/api/status/readiness', () => {
    const r = readReadiness();
    return HttpResponse.json({
      ready: r.ready,
      services: r.services,
      timestamp: new Date().toISOString(),
    });
  }),

  // --- Search (search.spec.ts) ------------------------------------
  // Mirrors src/api/search.ts — query is the lowercase "q" param.
  // Returns one transcript hit + one chat hit for "anxiety" so the
  // spec can assert both navigation branches, and an empty result set
  // for any other query.
  http.get('/api/search', ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    if (!q || (!q.includes('anxious') && !q.includes('anxiety'))) {
      return HttpResponse.json({ query: q, total: 0, results: [] });
    }
    return HttpResponse.json({
      query: q,
      total: 2,
      results: [
        {
          id: '1_1',
          type: 'transcript',
          chatId: null,
          sessionId: 1,
          sender: null,
          timestamp: 6000,
          snippet:
            'I have been feeling anxious for the past few months, especially at work.',
          highlights: {
            text: [
              'I have been feeling <mark>anxious</mark> for the past few months, especially at work.',
            ],
          },
          score: 2.5,
          clientName: 'Jane Doe',
        },
        {
          id: 'chat-msg-100',
          type: 'chat',
          chatId: 10,
          sessionId: 1,
          sender: 'user',
          timestamp: Date.now() - 60_000,
          snippet: 'What coping strategies have you tried for anxiety?',
          highlights: {
            text: [
              'What coping strategies have you tried for <mark>anxiety</mark>?',
            ],
          },
          score: 1.8,
          clientName: 'Jane Doe',
        },
      ],
    });
  }),

  // --- Session CRUD (crud.spec.ts) -------------------------------
  // GET /api/sessions/ — served from the mutable `e2eSessions` list
  // so delete + edit are observable on the next landing fetch.
  http.get('/api/sessions/', () => HttpResponse.json(e2eSessions)),

  // PUT /api/sessions/:id/metadata — edit session. Returns the merged
  // record. The spec verifies the row's text + the toast.
  http.put('/api/sessions/:id/metadata', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    e2eSessions = e2eSessions.map((s) =>
      s.id === id
        ? {
            ...s,
            sessionName:
              typeof body.sessionName === 'string'
                ? body.sessionName
                : s.sessionName,
            clientName:
              typeof body.clientName === 'string'
                ? body.clientName
                : s.clientName,
            date: typeof body.date === 'string' ? body.date : s.date,
            sessionType:
              typeof body.sessionType === 'string'
                ? body.sessionType
                : s.sessionType,
            therapy:
              typeof body.therapy === 'string' ? body.therapy : s.therapy,
          }
        : s
    );
    const updated = e2eSessions.find((s) => s.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/sessions/:id — removes the session from the list.
  http.delete('/api/sessions/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    e2eSessions = e2eSessions.filter((s) => s.id !== id);
    delete e2eSessionChats[id];
    return HttpResponse.json({ message: `Session ${id} deleted.` });
  }),

  // GET /api/sessions/:id — returns chats from the e2e mutable store.
  // The deep-analysis spec's `chatExistsInSession` check on
  // sessionMetadata.chats still passes for id=1 (id 10 + 11).
  http.get('/api/sessions/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const session = e2eSessions.find((s) => s.id === id);
    if (!session) {
      return HttpResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return HttpResponse.json({
      ...session,
      chats: e2eSessionChats[id] || [],
    });
  }),

  // POST /api/sessions/:id/chats/ — start a new chat for a session.
  http.post('/api/sessions/:id/chats/', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    const existing = e2eSessionChats[id] || [];
    const nextId = existing.length
      ? Math.max(...existing.map((c) => c.id)) + 1
      : 10;
    const newChat = {
      id: nextId,
      sessionId: id,
      timestamp: Date.now(),
      name: null,
    };
    e2eSessionChats[id] = [...existing, newChat];
    return HttpResponse.json(newChat);
  }),

  // GET /api/sessions/:sessionId/chats/:chatId — used by the chat
  // panel when the user navigates between chats. Returns the
  // canned mock transcript from the existing chat spec handler when
  // chatId === 10, otherwise returns an empty chat.
  http.get('/api/sessions/:sessionId/chats/:chatId', ({ params }) => {
    const chatId = parseInt(params.chatId as string, 10);
    if (chatId === 10) {
      return HttpResponse.json({
        id: 10,
        sessionId: 1,
        timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
        name: null,
        messages: mockChatMessages,
      });
    }
    return HttpResponse.json({
      id: chatId,
      sessionId: parseInt(params.sessionId as string, 10),
      timestamp: Date.now(),
      name: null,
      messages: [],
    });
  }),

  // Context-usage for any non-10 session chat (the chat-navigation
  // spec navigates to chat 11). Mirrors the canned chat-10 response
  // but with transcriptTokens=0 since the new chat has no transcript
  // grounded tokens yet.
  http.get('/api/sessions/:sessionId/chats/:chatId/context-usage', () =>
    HttpResponse.json({
      model: {
        name: mockActiveModel || 'mock-model',
        configuredContextSize: 8192,
        defaultContextSize: 8192,
        effectiveContextSize: 8192,
      },
      breakdown: {
        systemTokens: 312,
        transcriptTokens: 0,
        chatHistoryTokens: 0,
        inputDraftTokens: 0,
      },
      reserved: { outputTokens: 1024 },
      totals: {
        promptTokens: 312,
        percentUsed: 0.04,
        remainingForPrompt: 6856,
        remainingForOutput: 1024,
      },
      thresholds: { warnAt: 0.6, dangerAt: 0.85 },
    })
  ),

  // --- Standalone chat CRUD (crud.spec.ts) -----------------------
  // GET /api/chats — served from the mutable list.
  http.get('/api/chats', () => HttpResponse.json(e2eStandaloneChats)),

  // POST /api/chats — create. Adds a new id 44 by default.
  http.post('/api/chats', () => {
    const newChat = {
      id: 44,
      sessionId: null,
      timestamp: Date.now(),
      name: null,
      tags: null,
    };
    e2eStandaloneChats = [...e2eStandaloneChats, newChat];
    return HttpResponse.json(newChat, { status: 201 });
  }),

  // PATCH /api/chats/:id/details — edit name + tags.
  http.patch('/api/chats/:id/details', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string | null;
      tags?: string[] | null;
    };
    e2eStandaloneChats = e2eStandaloneChats.map((c) =>
      c.id === id
        ? {
            ...c,
            name: body.name === undefined ? c.name : body.name,
            tags: body.tags === undefined ? c.tags : body.tags,
          }
        : c
    );
    const updated = e2eStandaloneChats.find((c) => c.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/chats/:id — removes from the list.
  http.delete('/api/chats/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    e2eStandaloneChats = e2eStandaloneChats.filter((c) => c.id !== id);
    return HttpResponse.json({ message: `Chat ${id} deleted.` });
  }),

  // --- Analysis job actions (analysis-jobs.spec.ts) --------------
  // GET /api/analysis-jobs — list. The deep-analysis spec's job is
  // appended when POSTed, so the union is what the list returns.
  http.get('/api/analysis-jobs', () => {
    const baseList = e2eAnalysisJobs.map((j) => ({ ...j }));
    if (mockAnalysisJob) {
      const created = Date.now() - 5_000;
      baseList.push({
        id: mockAnalysisJob.id,
        original_prompt: mockAnalysisJob.originalPrompt,
        short_prompt: mockAnalysisJob.shortPrompt,
        status: 'completed',
        final_result: MOCK_REDUCE_RESPONSE,
        error_message: null,
        created_at: created,
        completed_at: created + 4_000,
        model_name: mockAnalysisJob.modelName,
        context_size: 8192,
        strategy_json: JSON.stringify({
          intermediate_question: MOCK_INTERMEDIATE_QUESTION,
          final_synthesis_instructions: MOCK_FINAL_SYNTHESIS_INSTRUCTIONS,
        }),
      });
    }
    return HttpResponse.json(baseList);
  }),

  // POST /api/analysis-jobs/:id/cancel — transitions the processing
  // job to "canceling" so the UI's spinner shows. A subsequent list
  // fetch observes "canceled".
  http.post('/api/analysis-jobs/:id/cancel', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    e2eAnalysisJobs = e2eAnalysisJobs.map((j) =>
      j.id === id ? { ...j, status: 'canceled', completed_at: Date.now() } : j
    );
    return HttpResponse.json({ message: `Job ${id} cancellation requested.` });
  }),

  // DELETE /api/analysis-jobs/:id — removes the job from the list.
  http.delete('/api/analysis-jobs/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    e2eAnalysisJobs = e2eAnalysisJobs.filter((j) => j.id !== id);
    return HttpResponse.json({ message: `Job ${id} deleted.` });
  }),

  // --- Templates (templates.spec.ts) -----------------------------
  // GET /api/templates — list seeded templates.
  http.get('/api/templates', () => HttpResponse.json(e2eTemplates)),

  // POST /api/templates — create.
  http.post('/api/templates', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
    };
    const tpl = {
      id: e2eNextTemplateId++,
      title: body.title || 'Untitled',
      text: body.text || '',
      createdAt: Date.now(),
    };
    e2eTemplates = [...e2eTemplates, tpl];
    return HttpResponse.json(tpl, { status: 201 });
  }),

  // PUT /api/templates/:id — update.
  http.put('/api/templates/:id', async ({ request, params }) => {
    const id = parseInt(params.id as string, 10);
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      text?: string;
    };
    e2eTemplates = e2eTemplates.map((t) =>
      t.id === id
        ? {
            ...t,
            title: typeof body.title === 'string' ? body.title : t.title,
            text: typeof body.text === 'string' ? body.text : t.text,
          }
        : t
    );
    const updated = e2eTemplates.find((t) => t.id === id);
    return HttpResponse.json(updated);
  }),

  // DELETE /api/templates/:id — remove.
  http.delete('/api/templates/:id', ({ params }) => {
    const id = parseInt(params.id as string, 10);
    e2eTemplates = e2eTemplates.filter((t) => t.id !== id);
    return HttpResponse.json({ message: `Template ${id} deleted.` });
  }),

  // --- Settings data management (settings-data.spec.ts) ----------
  http.post('/api/admin/reset-all-data', () =>
    HttpResponse.json({
      message: 'All application data has been reset.',
      errors: [],
    })
  ),
];
