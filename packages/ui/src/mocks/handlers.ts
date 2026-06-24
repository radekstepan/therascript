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

const MOCK_FOLLOWUP_SESSION = {
  id: 2,
  fileName: 'followup-2026-06-30.mp3',
  clientName: 'Jane Doe',
  sessionName: 'Follow-up Session',
  date: '2026-06-30T12:00:00.000Z',
  sessionType: 'followup',
  therapy: 'cbt',
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

  http.get('/api/sessions/', () =>
    HttpResponse.json([MOCK_INTAKE_SESSION, MOCK_FOLLOWUP_SESSION])
  ),

  // Single-session fetch (used by SessionView). Adds the mocked chat id
  // so the SessionContent renders ChatInterface instead of StartChatPrompt.
  http.get('/api/sessions/1', () =>
    HttpResponse.json({
      ...MOCK_INTAKE_SESSION,
      chats: [
        {
          id: MOCK_CHAT_ID,
          sessionId: 1,
          timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
          name: null,
        },
      ],
    })
  ),

  // Second session for the deep-analysis e2e spec. The spec selects two
  // sessions on the Landing page and submits them to
  // CreateAnalysisJobModal. The analysis handlers below echo this
  // session back as a completed intermediate summary so the
  // "Intermediate Analysis" grid renders two cards.
  http.get('/api/sessions/2', () =>
    HttpResponse.json({
      ...MOCK_FOLLOWUP_SESSION,
      chats: [],
    })
  ),

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

  // Chat details for the mocked chat id. Starts with an empty messages
  // list so the chat input is enabled once a model is loaded, then
  // accumulates messages as POST /messages streams complete so the
  // post-stream invalidateQueries in ChatInterface does not clobber the
  // optimistic insert.
  http.get('/api/sessions/1/chats/10', () =>
    HttpResponse.json({
      id: MOCK_CHAT_ID,
      sessionId: 1,
      timestamp: Date.parse('2026-06-23T12:30:00.000Z'),
      name: null,
      messages: mockChatMessages,
    })
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

  http.get('/api/chats', () =>
    HttpResponse.json([
      MOCK_STANDALONE_CHAT,
      {
        id: 43,
        sessionId: null,
        timestamp: Date.now(),
        name: null,
        tags: null,
      },
    ])
  ),

  http.post('/api/chats', () => {
    return HttpResponse.json(
      {
        id: 43,
        sessionId: null,
        timestamp: Date.now(),
        name: null,
        tags: null,
      },
      { status: 201 }
    );
  }),

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

  // GET /api/analysis-jobs — list view. The analysis e2e spec lands on
  // /analysis-jobs (the list) after submitting the modal, so the row
  // must be present for the test to click through to the detail view.
  http.get('/api/analysis-jobs', () => {
    if (!mockAnalysisJob) return HttpResponse.json([]);
    const created = Date.now() - 5_000;
    return HttpResponse.json([
      {
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
      },
    ]);
  }),

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
];
