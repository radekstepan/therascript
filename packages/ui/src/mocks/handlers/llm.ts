// packages/ui/src/mocks/handlers/llm.ts
//
// /api/llm/* — status, available-models (branches on baseUrl),
// set-model (mutates the in-memory active model), and
// models/:name/estimate-vram (regex, always returns the canned
// payload regardless of model name).
//
// Owned spec files: session-chat.spec.ts, standalone-chat.spec.ts,
// analysis.spec.ts (the model picker flow).
import { http, HttpResponse } from 'msw';
import {
  LOCAL_MODELS,
  MOCK_LOCAL_DEFAULT_BASE_URL,
  REMOTE_MODELS,
  localModelDetails,
  mockActiveModel,
  mockModelLoaded,
  setMockActiveModel,
  setMockModelLoaded,
} from '../state';

export const llmHandlers = [
  // /api/llm/available-models branches on the baseUrl query param
  // so the LlmEndpointModelPicker can render disjoint local and
  // remote lists. The chat e2e spec asserts that the two lists
  // differ.
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
  // /api/llm/status poll returns `loaded: true` and `activeModel`
  // set.
  http.post('/api/llm/set-model', async ({ request }) => {
    const body = (await request.json()) as {
      modelName?: string;
      baseUrl?: string | null;
    };
    if (body.modelName) {
      setMockActiveModel(body.modelName);
      setMockModelLoaded(true);
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
