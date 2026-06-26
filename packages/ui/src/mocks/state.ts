// packages/ui/src/mocks/state.ts
//
// Shared mutable state, constants, and helpers used by the per-domain
// handler files under ./handlers/. Lives in its own module so the
// handlers stay closure-light and so cross-domain coupling (e.g.
// `e2eSessions` shared between crud.spec.ts and analysis.spec.ts) is
// explicit.
//
// State is deliberately module-level and lives for the lifetime of
// the MSW service worker. Specs that need a clean baseline call
// POST /api/__e2e/reset in their `beforeEach` (see handlers/e2e.ts),
// which invokes `e2eMockSeed()` below.
const NOW_ISO = new Date().toISOString();
const INTAKE_DATE = '2026-06-23';

export const MOCK_INTAKE_SESSION = {
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

export const MOCK_FOLLOWUP_SESSION = {
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

export const MOCK_STANDALONE_CHAT = {
  id: 42,
  sessionId: null,
  timestamp: Date.parse('2026-06-22T10:15:00.000Z'),
  name: null,
  tags: null,
};

// `available: false` tells the UI to render the "GPU stats unavailable"
// state instead of trying to render zero GPUs. Matches the shape in
// types.ts:50-68.
export const MOCK_GPU_STATS = {
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
export const MOCK_CHAT_ID = 10;
export const MOCK_LOCAL_DEFAULT_BASE_URL = 'http://localhost:1234';

export let mockActiveModel = '';
export let mockModelLoaded = false;

// The "active" base URL the user most recently selected. `null` means
// "use the local default" (which the /api/llm/status handler fills
// in from MOCK_LOCAL_DEFAULT_BASE_URL). The real backend persists
// this in app_settings.llm_base_url via
// activeModelService.setActiveBaseUrl; the mock mirrors the same
// round-trip so a subsequent re-open of the Configure AI Model
// dialog sees the user's remote URL reflected in the picker.
export let mockActiveBaseUrl: string | null = null;
export const setMockActiveBaseUrl = (value: string | null) => {
  mockActiveBaseUrl = value && value.length > 0 ? value : null;
};

// --- Mutable remote LLM API token state --------------------------------
// POST /api/llm/api-token writes to `mockLlmApiToken` and the next
// /api/llm/status poll reports `hasRemoteApiToken: !!mockLlmApiToken`.
// Cleared to null by /api/__e2e/reset. The token value itself is never
// returned to the UI — only its presence — mirroring the real backend.
export let mockLlmApiToken: string | null = null;
export const setMockLlmApiToken = (value: string | null) => {
  mockLlmApiToken = value && value.length > 0 ? value : null;
};

// Accumulated chat messages for the mocked chat. Pushed to in the
// POST /api/sessions/1/chats/10/messages handler and read back by the
// GET /api/sessions/1/chats/10 handler. Without this buffer the chat
// refetch (triggered by ChatInterface after the stream completes) would
// return messages: [] and clobber the optimistic insert + the streamed
// AI response, so the bubbles would flash for ~100ms and disappear.
export interface MockChatMessage {
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
}

export let mockChatMessages: MockChatMessage[] = [];
export let mockMessageCounter = 0;

export const setMockActiveModel = (value: string) => {
  mockActiveModel = value;
};
export const setMockModelLoaded = (value: boolean) => {
  mockModelLoaded = value;
};
export const appendMockChatMessages = (msgs: MockChatMessage[]) => {
  mockChatMessages = [...mockChatMessages, ...msgs];
};
export const setMockMessageCounter = (n: number) => {
  mockMessageCounter = n;
};

export const localModelDetails = (name: string) => ({
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

export const LOCAL_MODELS = [
  localModelDetails('qwen2.5-7b-instruct'),
  localModelDetails('mistral-7b-local'),
];

export const REMOTE_MODELS = [
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
export const MOCK_ANALYSIS_JOB_ID = 1;
export const MOCK_INTERMEDIATE_QUESTION =
  'For each session, identify recurring anxiety triggers and the coping strategies the patient reported. Note any CBT techniques the therapist modeled in response.';
export const MOCK_FINAL_SYNTHESIS_INSTRUCTIONS =
  'Synthesize the per-session findings into a single narrative that highlights evolution over time, common patterns, and concrete recommendations for the next session.';
export const MOCK_REDUCE_RESPONSE =
  'Across both sessions the patient consistently described anxiety spikes tied to work deadlines and a tendency to catastrophize. In the follow-up, the therapist introduced cognitive reframing and the patient reported partial success applying it. Recommended next steps: continue reframing practice, introduce a worry log, and revisit the link between sleep quality and anxiety intensity.';

export interface MockAnalysisJob {
  id: number;
  originalPrompt: string;
  shortPrompt: string;
  modelName: string;
  sessionIds: number[];
}

export let mockAnalysisJob: MockAnalysisJob | null = null;

export const setMockAnalysisJob = (job: MockAnalysisJob) => {
  mockAnalysisJob = job;
};

// ============================================================
// --- e2e mock state (search, crud, templates, analysis jobs) --
// ============================================================
// Mutable stores for the new specs. Kept separate from
// `mockChatMessages` and `mockAnalysisJob` so concurrent specs
// don't clobber each other. `e2eMockSeed` (below) reseeds them
// via POST /api/__e2e/reset in the specs' `beforeEach`.
export interface E2ESession {
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
}

export let e2eSessions: E2ESession[] = [
  { ...MOCK_INTAKE_SESSION },
  { ...MOCK_FOLLOWUP_SESSION },
];

export interface E2EChatMeta {
  id: number;
  sessionId: number;
  timestamp: number;
  name: string | null;
}

export let e2eSessionChats: Record<number, E2EChatMeta[]> = {
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

export interface E2EStandaloneChat {
  id: number;
  sessionId: null;
  timestamp: number;
  name: string | null;
  tags: string[] | null;
}

export let e2eStandaloneChats: E2EStandaloneChat[] = [
  {
    id: 42,
    sessionId: null,
    timestamp: Date.parse('2026-06-22T10:15:00.000Z'),
    name: null,
    tags: null,
  },
  { id: 43, sessionId: null, timestamp: Date.now(), name: null, tags: null },
];

export interface E2ETemplate {
  id: number;
  title: string;
  text: string;
  createdAt: number;
}

export let e2eTemplates: E2ETemplate[] = [
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

export let e2eNextTemplateId = 3;

export type E2EAnalysisJobStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'canceling'
  | 'pending'
  | 'generating_strategy'
  | 'mapping'
  | 'reducing';

export interface E2EAnalysisJob {
  id: number;
  original_prompt: string;
  short_prompt: string;
  status: E2EAnalysisJobStatus;
  final_result: string | null;
  error_message: string | null;
  created_at: number;
  completed_at: number | null;
  model_name: string;
  context_size: number;
  strategy_json: string;
}

export let e2eAnalysisJobs: E2EAnalysisJob[] = [
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

// Mutators used by the handlers in handlers/ to keep `let` re-exports
// in scope. TypeScript treats re-exported `let` bindings as read-only
// from the importer's perspective, so the handler files call these
// setters rather than reassigning the bindings directly.
export const setE2eSessions = (next: E2ESession[]) => {
  e2eSessions = next;
};
export const setE2eSessionChats = (next: Record<number, E2EChatMeta[]>) => {
  e2eSessionChats = next;
};
export const setE2eStandaloneChats = (next: E2EStandaloneChat[]) => {
  e2eStandaloneChats = next;
};
export const setE2eTemplates = (next: E2ETemplate[]) => {
  e2eTemplates = next;
};
export const setE2eNextTemplateId = (next: number) => {
  e2eNextTemplateId = next;
};
export const setE2eAnalysisJobs = (next: E2EAnalysisJob[]) => {
  e2eAnalysisJobs = next;
};

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
export const E2E_READINESS_KEY = 'e2e:readiness';
export type ReadinessShape = {
  ready: boolean;
  services: {
    database: string;
    elasticsearch: string;
    llm: string;
    whisper: string;
  };
};
export const DEFAULT_READINESS: ReadinessShape = {
  ready: true,
  services: {
    database: 'connected',
    elasticsearch: 'connected',
    llm: 'connected',
    whisper: 'connected',
  },
};
export const readReadiness = (): ReadinessShape => {
  try {
    const raw = localStorage.getItem(E2E_READINESS_KEY);
    if (!raw) return DEFAULT_READINESS;
    return { ...DEFAULT_READINESS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READINESS;
  }
};
export const writeReadiness = (next: ReadinessShape) => {
  try {
    localStorage.setItem(E2E_READINESS_KEY, JSON.stringify(next));
  } catch {
    // Ignore — localStorage is unavailable in some test contexts.
  }
};

export const e2eMockSeed = () => {
  setMockLlmApiToken(null);
  // Reset the LLM "active model" + "loaded" flags + base URL too so
  // specs that open the Configure AI Model dialog
  // (e.g. remote-llm-api-token) start from a clean slate. Without
  // this, a spec that ran in the same worker and called
  // `setLlmModel` would leave the model flagged as loaded (and the
  // URL set to a remote), which disables the model picker (the
  // form is gated on `llmStatus.loaded === true`) and would skip
  // the local/remote toggle correctly.
  setMockActiveModel('');
  setMockModelLoaded(false);
  setMockActiveBaseUrl(null);
  setE2eSessions([{ ...MOCK_INTAKE_SESSION }, { ...MOCK_FOLLOWUP_SESSION }]);
  setE2eSessionChats({
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
  });
  setE2eStandaloneChats([
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
  ]);
  setE2eTemplates([
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
  ]);
  setE2eNextTemplateId(3);
  setE2eAnalysisJobs([
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
  ]);
  writeReadiness(DEFAULT_READINESS);
};

export let mockStandaloneChatMessages: MockChatMessage[] = [];

export const setMockStandaloneChatMessages = (next: MockChatMessage[]) => {
  mockStandaloneChatMessages = next;
};

// --- Usage mock data (UsageSection in SettingsPage) -------------------
// UsageSection.tsx:67-85 fires /api/usage/{history,stats,logs} on mount
// and on every filter change. Without MSW handlers, the requests fall
// through to the webpack-dev-server proxy, hit a stopped API on
// http://localhost:3001, and produce ECONNREFUSED noise in test output.
// Shapes mirror src/api/usage.ts interfaces and the Elysia response
// schemas in packages/api/src/routes/usageRoutes.ts:9-114.
export const USAGE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Deterministic but realistic-looking per-week cost seeds. Re-mixed
// across `weeks` so the chart always shows a non-trivial bar pattern
// (mix of LLM-only, whisper-only, both, and one empty week) regardless
// of the `?weeks=N` query param the UsageSection sends.
export const USAGE_LLM_WEEK_TOKENS = [
  142_000, 98_000, 165_000, 78_000, 0, 121_000, 88_000, 154_000, 67_000,
  110_000, 132_000, 95_000,
];
export const USAGE_WHISPER_WEEK_SECS = [
  312, 240, 0, 0, 195, 268, 0, 305, 412, 220, 0, 178,
];

export const buildUsageWeeks = (count: number) => {
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

export const MOCK_USAGE_HISTORY = {
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

export const MOCK_USAGE_STATS = (() => {
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

export const buildUsageLogs = () => {
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
