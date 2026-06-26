// packages/worker/src/jobs/analysisProcessor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@therascript/services', () => ({
  streamLlmChatDetailed: vi.fn(),
  calculateTokenCount: vi.fn(),
}));

vi.mock('../services/streamPublisher.js', () => ({
  publishStreamEvent: vi.fn(),
}));

// Stub out `bullmq`'s `Job` type import (only used in type position).
// The helpers under test don't depend on the Job constructor.

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { unloadModelAtUrlForWorker, loadLlmModelForWorker } = await import(
  './analysisProcessor.js'
);
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

      // Pre-switch GET on previous (= LOCAL_URL, the config default) — empty
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ models: [] }));
      // No pre-switch unload POST since previous is empty.
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
      // Note: REMOTE_A is not the config default, so the pre-switch only
      // touches LOCAL_URL. Then the main flow handles REMOTE_B.
      expect(calls[0].url).toBe(`${LOCAL_URL}/api/v1/models`);
      expect(calls[1].url).toBe(`${REMOTE_B}/api/v1/models`);
      expect(calls[2].url).toBe(`${REMOTE_B}/api/v1/models/unload`);
      expect(calls[3].url).toBe(`${REMOTE_B}/api/v1/models/load`);
    });
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
