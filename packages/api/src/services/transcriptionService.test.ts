// packages/api/src/services/transcriptionService.test.ts
//
// Priority-2 coverage for the upload-path availability gate:
// `POST /api/sessions/upload` funnels through `startTranscriptionJob`
// (503 when Whisper is down) and `checkDiarizationReadiness`
// (Step-0 gate for numSpeakers >= 2 in sessionRoutes.ts).
//
// Reference: packages/api/src/services/transcriptionService.ts,
// packages/api/src/routes/sessionRoutes.ts (upload handler).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();

vi.mock('@therascript/config', () => ({
  default: { whisper: { apiUrl: 'http://whisper-test:8000' } },
}));

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    post: (...args: unknown[]) => mockAxiosPost(...args),
  },
}));

vi.mock('./jobQueueService.js', () => ({
  addTranscriptionJob: vi.fn(),
  getLlmQueueActivity: vi.fn(),
}));

vi.mock('./llamaCppService.js', () => ({
  unloadActiveModel: vi.fn(),
  unloadModelAtUrl: vi.fn(),
  listLoadedLlmInstances: vi.fn(),
}));

vi.mock('./activeModelService.js', () => ({
  getActiveBaseUrl: vi.fn(),
  getDefaultBaseUrl: vi.fn(),
  isRemoteLlmBaseUrl: vi.fn(),
}));

const {
  checkWhisperApiHealth,
  startTranscriptionJob,
  checkDiarizationReadiness,
  triggerDiarizationPrefetch,
} = await import('./transcriptionService.js');
const { addTranscriptionJob, getLlmQueueActivity } = await import(
  './jobQueueService.js'
);
const { unloadActiveModel, unloadModelAtUrl, listLoadedLlmInstances } =
  await import('./llamaCppService.js');
const { getActiveBaseUrl, getDefaultBaseUrl, isRemoteLlmBaseUrl } =
  await import('./activeModelService.js');
const { ApiError, ConflictError } = await import('../errors.js');

const LOCAL_URL = 'http://localhost:1234';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkWhisperApiHealth', () => {
  it('returns true when /health responds', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    await expect(checkWhisperApiHealth()).resolves.toBe(true);
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'http://whisper-test:8000/health',
      expect.objectContaining({ timeout: 3000 })
    );
  });

  it('returns false when /health is unreachable', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(checkWhisperApiHealth()).resolves.toBe(false);
  });
});

describe('startTranscriptionJob (upload 503 gate)', () => {
  const run = (sessionId = 1, numSpeakers = 0) => {
    const p = startTranscriptionJob(sessionId, numSpeakers);
    // Skip the 1s VRAM-reclaim pause.
    const advanced = vi.advanceTimersByTimeAsync(1000);
    return { p, advanced };
  };

  it('throws a 503 ApiError without side effects when Whisper is down', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { p } = run();
    await expect(p).rejects.toMatchObject({ status: 503 });
    await expect(p).rejects.toBeInstanceOf(ApiError);
    expect(unloadActiveModel).not.toHaveBeenCalled();
    expect(addTranscriptionJob).not.toHaveBeenCalled();
  });

  it('unloads the LLM, verifies VRAM is free, and enqueues when Whisper is healthy', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 0,
    });
    vi.mocked(unloadActiveModel).mockResolvedValueOnce(undefined as any);
    vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(getDefaultBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
    vi.mocked(listLoadedLlmInstances).mockResolvedValueOnce([]);
    const { p, advanced } = run(7, 2);
    await advanced;
    await p;
    expect(unloadActiveModel).toHaveBeenCalledTimes(1);
    expect(unloadModelAtUrl).not.toHaveBeenCalled();
    expect(listLoadedLlmInstances).toHaveBeenCalledWith(LOCAL_URL);
    expect(addTranscriptionJob).toHaveBeenCalledWith({
      sessionId: 7,
      numSpeakers: 2,
    });
  });

  it('still enqueues when the LLM unload fails (non-fatal VRAM warning)', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 0,
    });
    vi.mocked(unloadActiveModel).mockRejectedValueOnce(
      new Error('LM Studio down')
    );
    vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(getDefaultBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
    vi.mocked(listLoadedLlmInstances).mockResolvedValueOnce([]);
    const { p, advanced } = run(3);
    await advanced;
    await p;
    expect(addTranscriptionJob).toHaveBeenCalledWith({
      sessionId: 3,
      numSpeakers: 0,
    });
  });

  it('throws a 409 without unloading when analysis/verification jobs are active', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 2,
    });
    const { p } = run(5);
    // Attach the rejection handler before any await so the rejection is
    // never momentarily unhandled.
    const assertion = expect(p).rejects.toMatchObject({ status: 409 });
    await assertion;
    await expect(p).rejects.toBeInstanceOf(ConflictError);
    await expect(p).rejects.toThrow(/2 verification/);
    expect(unloadActiveModel).not.toHaveBeenCalled();
    expect(addTranscriptionJob).not.toHaveBeenCalled();
  });

  it('throws a 409 when local LLM instances are still loaded after unload', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 0,
    });
    vi.mocked(unloadActiveModel).mockResolvedValueOnce(undefined as any);
    vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(getDefaultBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
    vi.mocked(listLoadedLlmInstances).mockResolvedValueOnce([
      { id: 'inst-1', modelKey: 'meta/llama-3-8b' },
    ]);
    const { p, advanced } = run(5);
    // Attach the rejection handler before advancing timers so the rejection
    // is never momentarily unhandled.
    const assertion = expect(p).rejects.toMatchObject({ status: 409 });
    await advanced;
    await assertion;
    await expect(p).rejects.toBeInstanceOf(ConflictError);
    await expect(p).rejects.toThrow(/still loaded/);
    expect(addTranscriptionJob).not.toHaveBeenCalled();
  });

  it('evicts the stale local model when the active URL is remote', async () => {
    const REMOTE_URL = 'http://10.0.0.1:1234';
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 0,
    });
    vi.mocked(unloadActiveModel).mockResolvedValueOnce(undefined as any);
    vi.mocked(unloadModelAtUrl).mockResolvedValueOnce(1);
    vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_URL);
    vi.mocked(getDefaultBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
    vi.mocked(listLoadedLlmInstances).mockResolvedValueOnce([]);
    const { p, advanced } = run(9);
    await advanced;
    await p;
    expect(unloadModelAtUrl).toHaveBeenCalledWith(LOCAL_URL);
    expect(addTranscriptionJob).toHaveBeenCalledWith({
      sessionId: 9,
      numSpeakers: 0,
    });
  });

  it('still enqueues when the verify enumeration fails (server down holds no VRAM)', async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { status: 'ok' } });
    vi.mocked(getLlmQueueActivity).mockResolvedValueOnce({
      analysis: 0,
      verification: 0,
    });
    vi.mocked(unloadActiveModel).mockResolvedValueOnce(undefined as any);
    vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(getDefaultBaseUrl).mockReturnValue(LOCAL_URL);
    vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
    vi.mocked(listLoadedLlmInstances).mockRejectedValueOnce(
      new Error('ECONNREFUSED')
    );
    const { p, advanced } = run(11);
    await advanced;
    await p;
    expect(addTranscriptionJob).toHaveBeenCalledWith({
      sessionId: 11,
      numSpeakers: 0,
    });
  });
});

describe('checkDiarizationReadiness', () => {
  it('maps the snake_case Whisper payload to camelCase', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        ready: true,
        hf_token_set: true,
        model_cached: true,
        error: null,
      },
    });
    await expect(checkDiarizationReadiness()).resolves.toEqual({
      ready: true,
      hfTokenSet: true,
      modelCached: true,
      error: undefined,
    });
  });

  it('surfaces the not-ready error detail', async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        ready: false,
        hf_token_set: false,
        model_cached: false,
        error: 'missing pyannote weights',
      },
    });
    const result = await checkDiarizationReadiness();
    expect(result.ready).toBe(false);
    expect(result.error).toBe('missing pyannote weights');
  });

  it('throws a rebuild hint when the Whisper container lacks /diarization/check (404)', async () => {
    const err: any = new Error('Not Found');
    err.response = { status: 404 };
    mockAxiosGet.mockRejectedValueOnce(err);
    await expect(checkDiarizationReadiness()).rejects.toThrow(
      /does not expose GET \/diarization\/check/
    );
  });

  it('rethrows non-404 network errors untouched', async () => {
    mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(checkDiarizationReadiness()).rejects.toThrow('ECONNREFUSED');
  });
});

describe('triggerDiarizationPrefetch', () => {
  it('maps the prefetch response', async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: {
        started: true,
        already_cached: false,
        message: 'download started',
      },
    });
    await expect(triggerDiarizationPrefetch()).resolves.toEqual({
      started: true,
      alreadyCached: false,
      message: 'download started',
    });
  });
});
