// packages/ui/src/mocks/handlers/llm.ts
//
// /api/llm/* — status, available-models (branches on baseUrl),
// set-model (mutates the in-memory active model + base URL), api-token
// (mutates the in-memory remote API token presence), unload (clears
// the loaded flag), and models/:name/estimate-vram (regex, always
// returns the canned payload regardless of model name).
//
// Owned spec files: session-chat.spec.ts, standalone-chat.spec.ts,
// analysis.spec.ts (the model picker flow), remote-llm-api-token.spec.ts
// (remote URL + token end-to-end).
import { http, HttpResponse } from 'msw';
import {
  MOCK_LOCAL_DEFAULT_BASE_URL,
  REMOTE_MODELS,
  e2eLocalModels,
  localModelDetails,
  mockActiveBaseUrl,
  mockActiveModel,
  mockLlmApiToken,
  mockModelLoaded,
  setE2eLocalModels,
  setMockActiveBaseUrl,
  setMockActiveModel,
  setMockLlmApiToken,
  setMockModelLoaded,
} from '../state';

// --- Model-pull job state machine (llm-pull-delete.spec.ts) -------------
// POST /api/llm/pull-model creates a job; GET
// /api/llm/pull-status/:jobId returns `downloading` for the first two
// polls (progress 42) then `completed`, unless POST
// /api/llm/cancel-pull/:jobId flips it to `canceled`. Reset via
// POST /api/__e2e/reset (see e2e.ts).
interface E2EPullJob {
  jobId: string;
  modelName: string;
  polls: number;
  canceled: boolean;
}

let e2ePullJobs: Record<string, E2EPullJob> = {};
let e2ePullCounter = 0;

export const resetE2ePullJobs = () => {
  e2ePullJobs = {};
  e2ePullCounter = 0;
};

export const llmHandlers = [
  // /api/llm/available-models branches on the baseUrl query param
  // so the LlmEndpointModelPicker can render disjoint local and
  // remote lists. The chat e2e spec asserts that the two lists
  // differ. The local list is served from the mutable
  // `e2eLocalModels` so POST /api/llm/delete-model removals are
  // observable (llm-pull-delete.spec.ts).
  http.get('/api/llm/available-models', ({ request }) => {
    const url = new URL(request.url);
    const baseUrl = url.searchParams.get('baseUrl');
    const isLocal = !baseUrl || baseUrl === MOCK_LOCAL_DEFAULT_BASE_URL;
    return HttpResponse.json({
      models: isLocal ? e2eLocalModels : REMOTE_MODELS,
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
  // /api/llm/status poll returns `loaded: true`, `activeModel` set,
  // AND (if provided) `activeBaseUrl` set to the requested remote URL
  // so a subsequent re-open of the Configure AI Model dialog sees
  // `isRemoteBaseUrl: true` and renders the remote URL/token fields.
  http.post('/api/llm/set-model', async ({ request }) => {
    const body = (await request.json()) as {
      modelName?: string;
      baseUrl?: string | null;
    };
    if (body.modelName) {
      setMockActiveModel(body.modelName);
      setMockModelLoaded(true);
    }
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim().length > 0) {
      setMockActiveBaseUrl(body.baseUrl.trim());
    } else if (body.baseUrl === null) {
      setMockActiveBaseUrl(null);
    }
    return HttpResponse.json({
      message: `Active model set to ${body.modelName}`,
    });
  }),

  // /api/llm/api-token sets or clears the global remote LLM API token.
  // Mirrors the real backend: only the presence boolean is returned,
  // never the token value itself.
  http.post('/api/llm/api-token', async ({ request }) => {
    const body = (await request.json()) as { token?: string | null };
    const next = typeof body.token === 'string' ? body.token : null;
    setMockLlmApiToken(next);
    return HttpResponse.json({
      message: next
        ? 'Remote LLM API token saved.'
        : 'Remote LLM API token cleared.',
      hasRemoteApiToken: !!mockLlmApiToken,
    });
  }),

  // /api/llm/unload — the "Unload" button in the chat panel header
  // fires this when the user wants to change a loaded model. The real
  // backend's llamaCppService.unloadActiveModel() iterates loaded
  // LM Studio instances and unloads each; for the mock we just flip
  // the loaded flag so the next /api/llm/status poll reports
  // `loaded: false`. We also clear the active model so a subsequent
  // status check returns a clean "no model loaded" state.
  http.post('/api/llm/unload', () => {
    setMockModelLoaded(false);
    setMockActiveModel('');
    return HttpResponse.json({ message: 'Model unloaded.' });
  }),

  // /api/llm/status — reflects the mutable state set by /set-model,
  // /api-token, and /unload. The "is the active URL different from
  // the local default?" derivation mirrors
  // packages/api/src/services/activeModelService.ts:isRemoteLlmBaseUrl.
  http.get('/api/llm/status', () => {
    const details = mockActiveModel ? localModelDetails(mockActiveModel) : null;
    const effectiveBaseUrl = mockActiveBaseUrl ?? MOCK_LOCAL_DEFAULT_BASE_URL;
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
      activeBaseUrl: effectiveBaseUrl,
      defaultBaseUrl: MOCK_LOCAL_DEFAULT_BASE_URL,
      isRemoteBaseUrl: effectiveBaseUrl !== MOCK_LOCAL_DEFAULT_BASE_URL,
      hasRemoteApiToken: !!mockLlmApiToken,
    });
  }),

  // POST /api/llm/pull-model — start a mock download job. Returns
  // 202 + jobId (the client throws unless status is 202 with a
  // jobId). Owned by llm-pull-delete.spec.ts.
  http.post('/api/llm/pull-model', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      modelUrl?: string;
    };
    e2ePullCounter += 1;
    const jobId = `e2e-pull-${e2ePullCounter}`;
    const rawUrl = typeof body.modelUrl === 'string' ? body.modelUrl : '';
    const modelName =
      rawUrl.split('/').filter(Boolean).pop() || 'mock-model.gguf';
    e2ePullJobs[jobId] = { jobId, modelName, polls: 0, canceled: false };
    return HttpResponse.json(
      { jobId, message: `Download job started for ${modelName}.` },
      { status: 202 }
    );
  }),

  // GET /api/llm/pull-status/:jobId — `downloading` (progress 42) for
  // the first two polls, then `completed`; `canceled` once
  // POST /api/llm/cancel-pull/:jobId flips the job. The shape mirrors
  // UIDownloadJobStatus (see src/api/llm.ts + types.ts).
  http.get('/api/llm/pull-status/:jobId', ({ params }) => {
    const job = e2ePullJobs[params.jobId as string];
    if (!job) {
      return HttpResponse.json(
        { message: `Download job ${params.jobId} not found.` },
        { status: 404 }
      );
    }
    if (job.canceled) {
      return HttpResponse.json({
        jobId: job.jobId,
        modelName: job.modelName,
        status: 'canceled',
        progress: 0,
        message: 'Download canceled.',
        error: null,
      });
    }
    job.polls += 1;
    if (job.polls <= 2) {
      return HttpResponse.json({
        jobId: job.jobId,
        modelName: job.modelName,
        status: 'downloading',
        progress: 42,
        message: `Downloading ${job.modelName}... 42%`,
        error: null,
      });
    }
    return HttpResponse.json({
      jobId: job.jobId,
      modelName: job.modelName,
      status: 'completed',
      progress: 100,
      message: `Download complete for ${job.modelName}.`,
      error: null,
    });
  }),

  // POST /api/llm/cancel-pull/:jobId — flip the job to `canceled` so
  // the next status poll reports it and the modal toasts.
  http.post('/api/llm/cancel-pull/:jobId', ({ params }) => {
    const job = e2ePullJobs[params.jobId as string];
    if (!job) {
      return HttpResponse.json(
        { message: `Download job ${params.jobId} not found.` },
        { status: 404 }
      );
    }
    job.canceled = true;
    return HttpResponse.json({ message: 'Pull job canceled.' });
  }),

  // POST /api/llm/delete-model — remove the model from the mutable
  // local catalog so the next available-models fetch no longer lists
  // it. The modal also optimistically patches its query cache.
  http.post('/api/llm/delete-model', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      modelName?: string;
    };
    if (typeof body.modelName === 'string') {
      setE2eLocalModels(
        e2eLocalModels.filter((m) => m.name !== body.modelName)
      );
    }
    return HttpResponse.json({
      message: `Model ${body.modelName} deleted.`,
    });
  }),
];
