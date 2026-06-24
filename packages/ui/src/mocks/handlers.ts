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

  // Structured transcript paragraphs for the intake session. Small but
  // non-empty so the Transcription panel renders content and the
  // transcript token count is plausibly non-zero.
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

  http.get('/api/chats', () => HttpResponse.json([MOCK_STANDALONE_CHAT])),

  http.get('/api/jobs/active-count', () =>
    HttpResponse.json({ total: 0, transcription: 0, analysis: 0 })
  ),

  http.get('/api/system/gpu-stats', () => HttpResponse.json(MOCK_GPU_STATS)),

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
];
