// packages/worker/src/jobs/analysisProcessor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AnalysisStrategy,
  BackendSession,
  IntermediateSummary,
} from '@therascript/domain';

vi.mock('@therascript/config', () => ({
  default: {
    llm: {
      baseURL: 'http://localhost:1234',
      modelPath: 'default',
    },
  },
}));

vi.mock('@therascript/domain', () => ({
  safeValidateAnalysisJob: vi.fn(),
}));

vi.mock('@therascript/data', () => ({
  analysisRepository: {
    createJob: vi.fn(),
    getJobById: vi.fn(),
    updateJobStatus: vi.fn(),
  },
  transcriptRepository: {},
  sessionRepository: {},
  usageRepository: {},
  appSettingsRepository: {
    getSettings: vi.fn().mockReturnValue({
      llm_api_token: null,
    }),
  },
}));

vi.mock('@therascript/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@therascript/services')>();
  return {
    streamLlmChatDetailed: vi.fn(),
    calculateTokenCount: vi.fn(),
    truncateTranscriptToTokenBudget: vi.fn((text: string) => ({
      text,
      truncated: false,
      droppedParagraphs: 0,
      originalTokens: 0,
      finalTokens: 0,
    })),
    parseJsonObjectFromLlm: vi.fn(),
    streamWithRetry: vi.fn(async function* (
      factory: () => AsyncGenerator<unknown, unknown>
    ) {
      const inner = factory();
      let step = await inner.next();
      while (!step.done) {
        yield step.value;
        step = await inner.next();
      }
      return step.value;
    }),
    // Use the real answer-extraction helper: the reduce-prompt tests below
    // verify its integration with legacy/imported summaries.
    extractVisibleAnswer: actual.extractVisibleAnswer,
  };
});

vi.mock('../services/streamPublisher.js', () => ({
  publishStreamEvent: vi.fn(),
}));

// Stub out `bullmq`'s `Job` type import (only used in type position).
// The helpers under test don't depend on the Job constructor.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const {
  unloadModelAtUrlForWorker,
  loadLlmModelForWorker,
  __resetLastWorkerBaseUrlForTests,
  assembleReducePrompt,
  computeMapCompletionCap,
  resolveEffectiveThinkingBudget,
} = await import('./analysisProcessor.js');
const { appSettingsRepository } = await import('@therascript/data');

const LOCAL_URL = 'http://localhost:1234';
const REMOTE_URL = 'http://10.0.0.1:1234';

interface FetchCall {
  url: string;
  init?: RequestInit;
}

const recordCalls = (): FetchCall[] =>
  mockFetch.mock.calls.map(([url, init]: any) => ({ url, init }));

const makeJsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as any;

describe('analysis worker — loadLlmModelForWorker URL switching', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // The worker tracks its last active base URL in module state that
    // persists across calls in the long-lived process (and across tests in
    // this file, which shares one module import). Reset it so every
    // URL-switch assertion starts from the config default.
    __resetLastWorkerBaseUrlForTests();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('unloadModelAtUrlForWorker', () => {
    it('unloads all loaded instances on the given URL and returns the count', async () => {
      // GET /api/v1/models returns 2 instances
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'inst-1' }, { id: 'inst-2' }],
            },
          ],
        })
      );
      // Two POST /api/v1/models/unload calls
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      const count = await unloadModelAtUrlForWorker(LOCAL_URL);

      expect(count).toBe(2);
      const calls = recordCalls();
      expect(calls[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${LOCAL_URL}/api/v1/models/unload`);
      expect(calls[1].init?.method).toBe('POST');
      expect(JSON.parse(calls[1].init?.body as string)).toEqual({
        instance_id: 'inst-1',
      });
      expect(calls[2].url).toBe(`${LOCAL_URL}/api/v1/models/unload`);
      expect(calls[2].init?.method).toBe('POST');
      expect(JSON.parse(calls[2].init?.body as string)).toEqual({
        instance_id: 'inst-2',
      });
    });

    it('returns 0 when nothing is loaded and does not POST unload', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));

      const count = await unloadModelAtUrlForWorker(LOCAL_URL);

      expect(count).toBe(0);
      // Only the GET, no POST
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(recordCalls()[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
    });

    it('tolerates per-instance unload failures', async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'inst-1' }, { id: 'inst-2' }],
            },
          ],
        })
      );
      // First POST fails, second succeeds
      mockFetch.mockRejectedValueOnce(new Error('first unload failed'));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

      const count = await unloadModelAtUrlForWorker(LOCAL_URL);

      expect(count).toBe(1);
      expect(mockFetch).toHaveBeenCalledTimes(3); // GET + 2 POSTs
    });

    it('tolerates GET failure and returns 0', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      const count = await unloadModelAtUrlForWorker(REMOTE_URL);

      expect(count).toBe(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('loadLlmModelForWorker — URL switch pre-unload', () => {
    it('unloads on the previous (config default) URL when target URL differs, then loads on target', async () => {
      // Step 1: pre-switch GET on previous (LOCAL_URL) — returns 1 instance
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'local-inst-1' }],
            },
          ],
        })
      );
      // Step 1: pre-switch POST unload on LOCAL_URL
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}));
      // Step 2: main GET on REMOTE_URL — returns 0 instances
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      // Step 2: main POST load on REMOTE_URL
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst-1' })
      );

      await loadLlmModelForWorker('meta/remote-model', 4096, REMOTE_URL);

      const calls = recordCalls();
      // Pre-switch: GET on LOCAL_URL
      expect(calls[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
      // Pre-switch: POST unload on LOCAL_URL
      expect(calls[1].url).toBe(`${LOCAL_URL}/api/v1/models/unload`);
      expect(calls[1].init?.method).toBe('POST');
      expect(JSON.parse(calls[1].init?.body as string)).toEqual({
        instance_id: 'local-inst-1',
      });
      // Main: GET on REMOTE_URL
      expect(calls[2].url).toBe(`${REMOTE_URL}/api/v1/models`);
      // Main: POST load on REMOTE_URL
      expect(calls[3].url).toBe(`${REMOTE_URL}/api/v1/models/load`);
      expect(calls[3].init?.method).toBe('POST');
      expect(JSON.parse(calls[3].init?.body as string)).toEqual({
        model: 'meta/remote-model',
        context_length: 4096,
        echo_load_config: true,
        flash_attention: true,
      });
    });

    it('does not pre-unload when target URL equals the config default', async () => {
      // No pre-switch unload: only the main flow runs
      // Main GET on LOCAL_URL
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      // Main POST load on LOCAL_URL
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'inst-1' })
      );

      await loadLlmModelForWorker('meta/local-model', 4096, LOCAL_URL);

      const calls = recordCalls();
      // Only the main flow: GET then POST load
      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${LOCAL_URL}/api/v1/models/load`);
    });

    it('tolerates pre-switch unload failure and still loads on the new URL', async () => {
      // Pre-switch GET fails
      mockFetch.mockRejectedValueOnce(new Error('previous URL down'));
      // Main GET on REMOTE_URL
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      // Main POST load on REMOTE_URL
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst-1' })
      );

      // Should not throw — pre-switch unload failure is non-fatal.
      await expect(
        loadLlmModelForWorker('meta/remote-model', 4096, REMOTE_URL)
      ).resolves.toBeUndefined();

      const calls = recordCalls();
      // Pre-switch GET (failed) + main GET + main POST load
      expect(calls).toHaveLength(3);
      expect(calls[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${REMOTE_URL}/api/v1/models`);
      expect(calls[2].url).toBe(`${REMOTE_URL}/api/v1/models/load`);
    });

    it('remote A to remote B switch unloads A and loads B', async () => {
      const REMOTE_A = 'http://10.0.0.1:1234';
      const REMOTE_B = 'http://10.0.0.2:1234';

      // First job targets REMOTE_A: pre-switch probes the config default
      // (empty), then the main flow loads on REMOTE_A. The worker now
      // tracks REMOTE_A as its last active base URL.
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'a-inst-new' })
      );
      await loadLlmModelForWorker('meta/old', 4096, REMOTE_A);
      mockFetch.mockClear();

      // Second job targets REMOTE_B: the pre-switch must evict the stale
      // model on REMOTE_A (the tracked previous URL), not the default.
      // Pre-switch GET on REMOTE_A — returns 1 stale instance
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'a-inst-1' }],
            },
          ],
        })
      );
      // Pre-switch POST unload on REMOTE_A
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}));
      // Main GET on REMOTE_B — returns 1 instance from a prior job
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'b-inst-1' }],
            },
          ],
        })
      );
      // Main unload of b-inst-1 on REMOTE_B
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}));
      // Main load on REMOTE_B
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'b-inst-new' })
      );

      await loadLlmModelForWorker('meta/new', 4096, REMOTE_B);

      const calls = recordCalls();
      expect(calls).toHaveLength(5);
      // Pre-switch: GET + unload POST on REMOTE_A
      expect(calls[0].url).toBe(`${REMOTE_A}/api/v1/models`);
      expect(calls[1].url).toBe(`${REMOTE_A}/api/v1/models/unload`);
      expect(calls[1].init?.method).toBe('POST');
      expect(JSON.parse(calls[1].init?.body as string)).toEqual({
        instance_id: 'a-inst-1',
      });
      // Main: GET + unload + load on REMOTE_B
      expect(calls[2].url).toBe(`${REMOTE_B}/api/v1/models`);
      expect(calls[3].url).toBe(`${REMOTE_B}/api/v1/models/unload`);
      expect(JSON.parse(calls[3].init?.body as string)).toEqual({
        instance_id: 'b-inst-1',
      });
      expect(calls[4].url).toBe(`${REMOTE_B}/api/v1/models/load`);
    });

    it('remote back to local switch unloads the remote URL', async () => {
      // First job targets the remote URL: pre-switch probes the config
      // default (empty), then the main flow loads remotely.
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst-1' })
      );
      await loadLlmModelForWorker('meta/remote', 4096, REMOTE_URL);
      mockFetch.mockClear();

      // Second job targets local: the pre-switch must evict the stale
      // model on the tracked remote URL.
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'remote-stale-1' }],
            },
          ],
        })
      );
      mockFetch.mockResolvedValueOnce(makeJsonResponse({}));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'local-inst-new' })
      );

      await loadLlmModelForWorker('meta/local', 4096, LOCAL_URL);

      const calls = recordCalls();
      expect(calls).toHaveLength(4);
      expect(calls[0].url).toBe(`${REMOTE_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${REMOTE_URL}/api/v1/models/unload`);
      expect(JSON.parse(calls[1].init?.body as string)).toEqual({
        instance_id: 'remote-stale-1',
      });
      expect(calls[2].url).toBe(`${LOCAL_URL}/api/v1/models`);
      expect(calls[3].url).toBe(`${LOCAL_URL}/api/v1/models/load`);
    });

    it('repeat call on the same URL does not pre-unload', async () => {
      // First call establishes REMOTE_URL as the tracked URL.
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst-1' })
      );
      await loadLlmModelForWorker('meta/remote', 4096, REMOTE_URL);
      mockFetch.mockClear();

      // Second call on the same URL: no pre-switch, only the main flow.
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst-2' })
      );
      await loadLlmModelForWorker('meta/other', 4096, REMOTE_URL);

      const calls = recordCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0].url).toBe(`${REMOTE_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${REMOTE_URL}/api/v1/models/load`);
    });
  });

  describe('loadLlmModelForWorker — numGpuLayers forwarding', () => {
    const loadPayloadOf = (): Record<string, unknown> => {
      const loadCall = recordCalls().find((c) =>
        c.url.endsWith('/api/v1/models/load')
      );
      expect(loadCall).toBeDefined();
      return JSON.parse(loadCall!.init?.body as string);
    };

    it('sends offload_kv_cache_to_gpu=false when numGpuLayers is 0 (CPU-only)', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'inst-1' })
      );

      await loadLlmModelForWorker('meta/local', 4096, LOCAL_URL, 0);

      expect(loadPayloadOf()).toEqual({
        model: 'meta/local',
        context_length: 4096,
        echo_load_config: true,
        flash_attention: true,
        offload_kv_cache_to_gpu: false,
      });
    });

    it('sends offload_kv_cache_to_gpu=true when numGpuLayers is positive', async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'inst-1' })
      );

      await loadLlmModelForWorker('meta/local', 4096, LOCAL_URL, 99);

      expect(loadPayloadOf()).toEqual({
        model: 'meta/local',
        context_length: 4096,
        echo_load_config: true,
        flash_attention: true,
        offload_kv_cache_to_gpu: true,
      });
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
    ] as const)(
      'omits offload_kv_cache_to_gpu when numGpuLayers is %s',
      async (_label, numGpuLayers) => {
        mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
        mockFetch.mockResolvedValueOnce(
          makeJsonResponse({ instance_id: 'inst-1' })
        );

        await loadLlmModelForWorker(
          'meta/local',
          4096,
          LOCAL_URL,
          numGpuLayers
        );

        const payload = loadPayloadOf();
        expect(payload).toEqual({
          model: 'meta/local',
          context_length: 4096,
          echo_load_config: true,
          flash_attention: true,
        });
        expect('offload_kv_cache_to_gpu' in payload).toBe(false);
      }
    );
  });

  describe('Authorization header — remote-only credential forwarding', () => {
    const TEST_TOKEN = 'sk-worker-token-abc';

    const findCall = (urlSuffix: string) =>
      mockFetch.mock.calls.find(
        ([url]: any) => typeof url === 'string' && url.endsWith(urlSuffix)
      );
    const headerFor = (urlSuffix: string): Record<string, string> => {
      const call = findCall(urlSuffix);
      if (!call) return {};
      const init = call[1] as RequestInit | undefined;
      return (init?.headers ?? {}) as Record<string, string>;
    };
    // POST /api/v1/models/load and the unload POSTs always include
    // `Content-Type: application/json` from the worker's own fetch call,
    // so a "no auth" assertion can't expect an empty object — it must
    // assert the absence of `Authorization` specifically.
    const expectNoAuth = (urlSuffix: string) => {
      const headers = headerFor(urlSuffix);
      expect(headers.Authorization).toBeUndefined();
    };
    const expectAuth = (urlSuffix: string, token: string) => {
      expect(headerFor(urlSuffix).Authorization).toBe(`Bearer ${token}`);
    };

    it('omits Authorization when the URL is local, even if a token is configured', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: TEST_TOKEN,
      } as any);
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'local-inst' })
      );

      await loadLlmModelForWorker('meta/local', 4096, LOCAL_URL);

      expectNoAuth(`${LOCAL_URL}/api/v1/models`);
      expectNoAuth(`${LOCAL_URL}/api/v1/models/load`);
    });

    it('attaches Bearer <token> to enumerate + load on a remote URL when a token is configured', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: TEST_TOKEN,
      } as any);
      // Pre-switch GET on the local default URL (returns 0 instances so
      // no unload POST is needed). Then the main flow: GET enumerate on
      // the target URL + POST load.
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst' })
      );

      await loadLlmModelForWorker('meta/remote', 4096, REMOTE_URL);

      expectAuth(`${REMOTE_URL}/api/v1/models`, TEST_TOKEN);
      expectAuth(`${REMOTE_URL}/api/v1/models/load`, TEST_TOKEN);
    });

    it('omits Authorization on a remote URL when no token is configured', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: null,
      } as any);
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ instance_id: 'remote-inst' })
      );

      await loadLlmModelForWorker('meta/remote', 4096, REMOTE_URL);

      expectNoAuth(`${REMOTE_URL}/api/v1/models`);
      expectNoAuth(`${REMOTE_URL}/api/v1/models/load`);
    });

    it('attaches Bearer header to unload POSTs at a remote URL when a token is configured', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: TEST_TOKEN,
      } as any);
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [
            {
              type: 'llm',
              loaded_instances: [{ id: 'r-inst-1' }, { id: 'r-inst-2' }],
            },
          ],
        })
      );
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await unloadModelAtUrlForWorker(REMOTE_URL);

      // GET enumerate
      expectAuth(`${REMOTE_URL}/api/v1/models`, TEST_TOKEN);
      // Every call to the remote URL carries the header.
      for (const call of mockFetch.mock.calls) {
        const [url, init] = call as [string, RequestInit | undefined];
        if (typeof url === 'string' && url.includes(REMOTE_URL)) {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
        }
      }
    });

    it('omits Authorization from unload POSTs at a remote URL when no token is configured', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: null,
      } as any);
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({
          models: [{ type: 'llm', loaded_instances: [{ id: 'r-inst-1' }] }],
        })
      );
      mockFetch.mockResolvedValue(makeJsonResponse({}));

      await unloadModelAtUrlForWorker(REMOTE_URL);

      for (const call of mockFetch.mock.calls) {
        const [url, init] = call as [string, RequestInit | undefined];
        if (typeof url === 'string' && url.includes(REMOTE_URL)) {
          const headers = (init?.headers ?? {}) as Record<string, string>;
          expect(headers.Authorization).toBeUndefined();
        }
      }
    });

    it('re-reads the token from app_settings on every call (rotation works without restart)', async () => {
      // First call: token = 'old'
      vi.mocked(appSettingsRepository.getSettings).mockReturnValueOnce({
        llm_api_token: 'old',
      } as any);
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ instance_id: 'r-1' }));
      await loadLlmModelForWorker('meta/r1', 4096, REMOTE_URL);
      expectAuth(`${REMOTE_URL}/api/v1/models`, 'old');

      // Second call: token = 'new' (rotation)
      vi.mocked(appSettingsRepository.getSettings).mockReturnValueOnce({
        llm_api_token: 'new',
      } as any);
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ instance_id: 'r-2' }));
      await loadLlmModelForWorker('meta/r2', 4096, REMOTE_URL);
      const secondCall = mockFetch.mock.calls
        .slice(-2)
        .find(
          ([url]: any) =>
            typeof url === 'string' &&
            url.endsWith(`${REMOTE_URL}/api/v1/models`)
        );
      const headers = (secondCall![1] as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined;
      expect(headers?.Authorization).toBe('Bearer new');
    });

    it('treats whitespace token as cleared (no Authorization header)', async () => {
      vi.mocked(appSettingsRepository.getSettings).mockReturnValue({
        llm_api_token: '   ',
      } as any);
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ instance_id: 'r-1' }));

      await loadLlmModelForWorker('meta/r', 4096, REMOTE_URL);

      expectNoAuth(`${REMOTE_URL}/api/v1/models`);
      expectNoAuth(`${REMOTE_URL}/api/v1/models/load`);
    });
  });
});

/**
 * The reduce phase of the analysis MapReduce job is contracted to feed
 * the LLM intermediate summaries in chronological order
 * (oldest → newest) so the model can describe "change over time."
 * That contract is enforced by:
 *   1. `analysisRepository` SQL `ORDER BY s.date ASC, id ASC` (DB layer)
 *   2. `assembleReducePrompt` re-sorting in JS (defense-in-depth)
 *
 * These tests guard #2 directly. If anyone removes the helper sort
 * thinking "the DB already sorts," these tests will fail.
 */
describe('analysis worker — assembleReducePrompt (chronological ordering)', () => {
  const makeSession = (
    id: number,
    date: string,
    sessionName = `Session ${id}`
  ): BackendSession => ({
    id,
    fileName: `file-${id}.wav`,
    clientName: 'Test Client',
    sessionName,
    date,
    sessionType: 'individual',
    therapy: 'cbt',
    audioPath: null,
    status: 'completed',
    whisperJobId: null,
    transcriptTokenCount: 1000,
    duration: 3000,
    errorMessage: null,
    showSpeakers: 1,
  });

  const makeSummary = (
    id: number,
    sessionId: number,
    text: string
  ): IntermediateSummary => ({
    id,
    analysis_job_id: 1,
    session_id: sessionId,
    summary_text: text,
    status: 'completed',
    error_message: null,
  });

  const sessionsByIdFromList = (sessions: BackendSession[]) =>
    new Map(sessions.map((s) => [s.id, s]));

  const userTextOf = (messages: { text: string }[]) =>
    messages.find((m) => m.text.includes('INTERMEDIATE'))?.text ?? '';

  it('renders summaries in oldest-to-newest order even when input is shuffled', () => {
    const sessions = [
      makeSession(1, '2024-03-15', 'March Session'),
      makeSession(2, '2024-01-10', 'January Session'),
      makeSession(3, '2024-05-20', 'May Session'),
      makeSession(4, '2024-02-08', 'February Session'),
    ];
    const summaries = sessions.map((s, idx) =>
      makeSummary(idx + 1, s.id, `summary-for-${s.sessionName}`)
    );
    // Shuffle the input order to prove the helper sorts.
    const shuffled = [summaries[2], summaries[0], summaries[3], summaries[1]];

    const messages = assembleReducePrompt(
      shuffled,
      sessionsByIdFromList(sessions),
      'How is the patient progressing?',
      null
    );

    const text = userTextOf(messages);
    const janIdx = text.indexOf('January Session');
    const febIdx = text.indexOf('February Session');
    const marIdx = text.indexOf('March Session');
    const mayIdx = text.indexOf('May Session');

    expect(janIdx).toBeGreaterThan(-1);
    expect(febIdx).toBeGreaterThan(janIdx);
    expect(marIdx).toBeGreaterThan(febIdx);
    expect(mayIdx).toBeGreaterThan(marIdx);
  });

  it('breaks ties on identical dates by summary id ascending (stable, deterministic)', () => {
    // Three sessions share the same date. The helper must still emit a
    // deterministic order via the summary.id tiebreaker, not arbitrary
    // order. Contract: ascending summary id wins on date ties, so the
    // rendered order is B (id=10) → C (id=20) → A (id=30).
    const sessions = [
      makeSession(1, '2024-04-01', 'Tied A'),
      makeSession(2, '2024-04-01', 'Tied B'),
      makeSession(3, '2024-04-01', 'Tied C'),
    ];
    const summaries = [
      makeSummary(30, 1, 'summary-tied-A'),
      makeSummary(10, 2, 'summary-tied-B'),
      makeSummary(20, 3, 'summary-tied-C'),
    ];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    const text = userTextOf(messages);
    const bIdx = text.indexOf('Tied B');
    const cIdx = text.indexOf('Tied C');
    const aIdx = text.indexOf('Tied A');
    expect(bIdx).toBeGreaterThan(-1);
    expect(cIdx).toBeGreaterThan(bIdx);
    expect(aIdx).toBeGreaterThan(cIdx);
  });

  it('drops summaries whose session is missing from the lookup map', () => {
    const sessions = [makeSession(1, '2024-01-10', 'Jan')];
    const summaries = [
      makeSummary(1, 1, 'kept'),
      // session_id 99 has no entry in sessionsById → must be dropped
      makeSummary(2, 99, 'orphan'),
    ];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('kept');
    expect(text).not.toContain('orphan');
  });

  it('uses INTERMEDIATE SUMMARIES phrasing and a single user message when no strategy is provided', () => {
    const sessions = [makeSession(1, '2024-01-10', 'Jan')];
    const summaries = [makeSummary(1, 1, 'only-summary')];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('user');
    expect(messages[0].text).toContain('INTERMEDIATE SUMMARIES');
    expect(messages[0].text).toContain(
      "Create a single, cohesive answer to the user's question"
    );
  });

  it('uses INTERMEDIATE ANSWERS phrasing and a system+user pair when a strategy is provided', () => {
    const sessions = [makeSession(1, '2024-01-10', 'Jan')];
    const summaries = [makeSummary(1, 1, 'only-summary')];
    const strategy: AnalysisStrategy = {
      intermediate_question: 'extract X',
      final_synthesis_instructions: 'synthesize according to Y',
    };

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      strategy
    );

    expect(messages).toHaveLength(2);
    expect(messages[0].sender).toBe('system');
    expect(messages[0].text).toBe('synthesize according to Y');
    expect(messages[1].sender).toBe('user');
    expect(messages[1].text).toContain('INTERMEDIATE ANSWERS');
    expect(messages[1].text).not.toContain('INTERMEDIATE SUMMARIES');
  });

  it('formats each session block with the `--- Analysis from Session "<name>" ---` separator', () => {
    const sessions = [
      makeSession(1, '2024-01-10', 'First'),
      makeSession(2, '2024-02-10', 'Second'),
    ];
    const summaries = [
      makeSummary(1, 1, 'first-summary-text'),
      makeSummary(2, 2, 'second-summary-text'),
    ];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('--- Analysis from Session "First" ---');
    expect(text).toContain('first-summary-text');
    expect(text).toContain('--- Analysis from Session "Second" ---');
    expect(text).toContain('second-summary-text');
    // First block must precede Second block in the rendered prompt.
    expect(text.indexOf('First')).toBeLessThan(text.indexOf('Second'));
  });

  it('falls back to fileName when sessionName is empty', () => {
    const session = makeSession(1, '2024-01-10', '');
    session.fileName = 'recording.wav';
    const summaries = [makeSummary(1, 1, 'text')];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList([session]),
      'q',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('--- Analysis from Session "recording.wav" ---');
  });

  it('returns no messages with content if every summary is missing its session', () => {
    const summaries = [makeSummary(1, 999, 'orphan')];

    const messages = assembleReducePrompt(summaries, new Map(), 'q', null);

    // The no-strategy branch always produces exactly one user message
    // (with an empty INTERMEDIATE SUMMARIES body). Verify it exists but
    // contains no session block — i.e. nothing leaked through.
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('user');
    expect(messages[0].text).not.toContain('orphan');
    expect(messages[0].text).not.toContain('--- Analysis from Session');
  });
});

/**
 * Guard the bug fix: map-phase thinking tokens MUST NOT appear in the
 * reduce prompt.
 *
 * Root cause (now fixed): `summaryText` was accumulated with raw
 * `<think>…</think>` tags and that full string was stored in the DB.
 * `assembleReducePrompt` consumed `summary.summary_text` verbatim, so
 * every reduce call forwarded the model's entire reasoning chain as input
 * context — observed as ~129 k-token prompts for a 20-session reduce.
 *
 * Defense in depth: thinking is stripped before DB persistence (map phase)
 * AND `assembleReducePrompt` extracts the visible answer from every stored
 * summary before embedding it. The second layer handles legacy/imported
 * rows that were written before the persistence fix, without a migration.
 * These tests verify the `assembleReducePrompt` side of that contract.
 */
describe('analysis worker — assembleReducePrompt (thinking-token isolation)', () => {
  const makeSession = (
    id: number,
    date: string,
    name = `Session ${id}`
  ): BackendSession => ({
    id,
    fileName: `file-${id}.wav`,
    clientName: 'Client',
    sessionName: name,
    date,
    sessionType: 'individual',
    therapy: 'cbt',
    audioPath: null,
    status: 'completed',
    whisperJobId: null,
    transcriptTokenCount: 1000,
    duration: 3000,
    errorMessage: null,
    showSpeakers: 1,
  });

  const makeSummary = (
    id: number,
    sessionId: number,
    text: string
  ): IntermediateSummary => ({
    id,
    analysis_job_id: 1,
    session_id: sessionId,
    summary_text: text,
    status: 'completed',
    error_message: null,
  });

  const sessionsByIdFromList = (sessions: BackendSession[]) =>
    new Map(sessions.map((s) => [s.id, s]));

  const userTextOf = (messages: { text: string }[]) =>
    messages.find((m) => m.text.includes('INTERMEDIATE'))?.text ?? '';

  it('does not include <think> content when summary_text has already been stripped', () => {
    // This is the happy-path post-fix: the DB row only contains the answer.
    const sessions = [makeSession(1, '2024-01-01')];
    const summaries = [makeSummary(1, 1, 'The patient showed improvement.')];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'How is the patient?',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('The patient showed improvement.');
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
  });

  it('removes <think> content from legacy/imported summaries stored un-stripped', () => {
    // Legacy/imported rows may still contain raw thinking. assembleReducePrompt
    // must extract the visible answer itself so no migration is required.
    const thinkingContent = 'long internal reasoning chain...';
    const answerContent = 'Concise clinical answer.';
    const rawText = `<think>${thinkingContent}</think>${answerContent}`;

    const sessions = [makeSession(1, '2024-01-01')];
    const summaries = [makeSummary(1, 1, rawText)];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    const text = userTextOf(messages);
    expect(text).not.toContain(thinkingContent);
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    expect(text).toContain(answerContent);
  });

  it('excludes reasoning-only summaries so their sessions are not claimed', () => {
    // A summary with no visible answer is unusable input: it must not throw,
    // must not leak reasoning, and must not render a session block that
    // would imply coverage of that session.
    const sessions = [makeSession(1, '2024-01-01')];
    const summaries = [makeSummary(1, 1, '<think>only reasoning</think>')];

    let messages;
    expect(
      () =>
        (messages = assembleReducePrompt(
          summaries,
          sessionsByIdFromList(sessions),
          'q',
          null
        ))
    ).not.toThrow();

    const text = userTextOf(messages!);
    expect(text).not.toContain('only reasoning');
    expect(text).not.toContain('--- Analysis from Session');
  });

  it('handles unclosed thinking blocks in imported summaries', () => {
    const sessions = [makeSession(1, '2024-01-01')];
    const summaries = [
      makeSummary(1, 1, 'Visible answer.<think>interrupted reasoning'),
    ];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('Visible answer.');
    expect(text).not.toContain('interrupted reasoning');
    expect(text).not.toContain('<think>');
  });

  it('strips thinking from multiple sessions so none pollutes the reduce prompt', () => {
    // Legacy rows with embedded thinking across N sessions.
    const sessions = [
      makeSession(1, '2024-01-01', 'January'),
      makeSession(2, '2024-02-01', 'February'),
      makeSession(3, '2024-03-01', 'March'),
    ];
    const summaries = [
      makeSummary(1, 1, '<think>jan reasoning</think>Jan answer.'),
      makeSummary(2, 2, '<THINK>feb reasoning</THINK>Feb answer.'),
      makeSummary(3, 3, 'Mar answer.<think>mar reasoning'),
    ];

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'Trend?',
      null
    );

    const text = userTextOf(messages);
    expect(text).toContain('Jan answer.');
    expect(text).toContain('Feb answer.');
    expect(text).toContain('Mar answer.');
    expect(text).not.toContain('jan reasoning');
    expect(text).not.toContain('feb reasoning');
    expect(text).not.toContain('mar reasoning');
    expect(text).not.toContain('<think>');
    expect(text).not.toContain('</think>');
    // Sanity: all three session headers are present.
    expect(text).toContain('--- Analysis from Session "January" ---');
    expect(text).toContain('--- Analysis from Session "February" ---');
    expect(text).toContain('--- Analysis from Session "March" ---');
  });

  it('thinking-stripped summaries with a strategy use INTERMEDIATE ANSWERS and no <think> content', () => {
    const sessions = [makeSession(1, '2024-01-01')];
    const summaries = [makeSummary(1, 1, 'Clean answer.')];
    const strategy: AnalysisStrategy = {
      intermediate_question: 'extract X',
      final_synthesis_instructions: 'synthesize Y',
    };

    const messages = assembleReducePrompt(
      summaries,
      sessionsByIdFromList(sessions),
      'q',
      strategy
    );

    expect(messages).toHaveLength(2);
    const userMsg = messages[1].text;
    expect(userMsg).toContain('INTERMEDIATE ANSWERS');
    expect(userMsg).toContain('Clean answer.');
    expect(userMsg).not.toContain('<think>');
  });
});

/**
 * computeMapCompletionCap — completion token budget for map-phase LLM calls.
 *
 * Contract:
 *   - Returns 30% of the given context size, rounded to the nearest integer.
 *   - Returns at least 4096 (2 × 2048), regardless of how small contextSize is.
 *   - The floor avoids starving thinking models that need room for both
 *     reasoning and answer tokens within a single max_tokens envelope.
 */
describe('analysis worker — computeMapCompletionCap', () => {
  it('returns 30% of context when 30% exceeds the minimum floor', () => {
    // 80_000 × 0.3 = 24_000 > 4096
    expect(computeMapCompletionCap(80_000)).toBe(24_000);
  });

  it('returns the floor (4096) when 30% of context is below it', () => {
    // 10_000 × 0.3 = 3_000 < 4096 → floor wins
    expect(computeMapCompletionCap(10_000)).toBe(4096);
  });

  it('returns the floor for the legacy default context of 8192', () => {
    // 8_192 × 0.3 = 2_457.6 ≈ 2458 < 4096 → floor wins
    expect(computeMapCompletionCap(8_192)).toBe(4096);
  });

  it('returns the floor for tiny context sizes', () => {
    expect(computeMapCompletionCap(1)).toBe(4096);
    expect(computeMapCompletionCap(0)).toBe(4096);
  });

  it('is at or above the floor at the crossover threshold (~13654)', () => {
    // 13_654 × 0.3 = 4_096.2 → Math.round → 4096, still at floor
    // 13_680 × 0.3 = 4_104 → clearly above the floor
    const atBoundary = computeMapCompletionCap(13_654);
    const aboveFloor = computeMapCompletionCap(13_680);
    expect(atBoundary).toBeGreaterThanOrEqual(4096);
    expect(aboveFloor).toBeGreaterThan(4096);
  });

  it('scales correctly with a 128k context', () => {
    // 131_072 × 0.3 = 39_321.6 → Math.round → 39322
    expect(computeMapCompletionCap(131_072)).toBe(39_322);
  });

  it('always returns an integer', () => {
    const cases = [8_192, 16_384, 32_768, 65_536, 80_000, 131_072];
    for (const ctx of cases) {
      expect(Number.isInteger(computeMapCompletionCap(ctx))).toBe(true);
    }
  });
});

/**
 * resolveEffectiveThinkingBudget — clamp the configured thinking budget so
 * reasoning can never starve the visible completion budget in Map/Reduce.
 *
 * Contract:
 *   - `0` disables thinking (returns 0).
 *   - `null` / `undefined` / negative (`-1` "Unrestricted") → the phase cap.
 *   - positive values are capped at `maxThinkingCap`.
 */
describe('analysis worker — resolveEffectiveThinkingBudget', () => {
  // Representative 40% cap: 4096 completion tokens × 0.4 ≈ 1638.
  const mapMaxThinkingTokens = Math.round(computeMapCompletionCap(8192) * 0.4);

  it('maps -1 ("Unrestricted") to the phase cap', () => {
    expect(resolveEffectiveThinkingBudget(-1, mapMaxThinkingTokens)).toBe(
      mapMaxThinkingTokens
    );
  });

  it('maps null and undefined (unset) to the phase cap', () => {
    expect(resolveEffectiveThinkingBudget(null, mapMaxThinkingTokens)).toBe(
      mapMaxThinkingTokens
    );
    expect(
      resolveEffectiveThinkingBudget(undefined, mapMaxThinkingTokens)
    ).toBe(mapMaxThinkingTokens);
  });

  it('maps any negative value to the phase cap', () => {
    expect(resolveEffectiveThinkingBudget(-100, mapMaxThinkingTokens)).toBe(
      mapMaxThinkingTokens
    );
  });

  it('returns 0 when thinking is disabled', () => {
    expect(resolveEffectiveThinkingBudget(0, mapMaxThinkingTokens)).toBe(0);
  });

  it('passes through positive budgets below the cap unchanged', () => {
    expect(resolveEffectiveThinkingBudget(512, mapMaxThinkingTokens)).toBe(512);
  });

  it('clamps positive budgets above the cap', () => {
    expect(resolveEffectiveThinkingBudget(99999, mapMaxThinkingTokens)).toBe(
      mapMaxThinkingTokens
    );
  });

  it('returns the cap exactly when the budget equals the cap', () => {
    expect(
      resolveEffectiveThinkingBudget(mapMaxThinkingTokens, mapMaxThinkingTokens)
    ).toBe(mapMaxThinkingTokens);
  });
});
