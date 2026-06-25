import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  LlmModelInfo,
  VramEstimate,
  BackendChatMessage,
} from '@therascript/domain';

// Mock dependencies before importing the module
vi.mock('@therascript/config', () => ({
  default: {
    llm: {
      baseURL: 'http://localhost:1234',
    },
  },
}));

vi.mock('./activeModelService.js', () => ({
  setActiveModelAndContextAndParams: vi.fn(),
  getActiveModel: vi.fn().mockReturnValue('default'),
  setActiveModelName: vi.fn(),
  setConfiguredContextSize: vi.fn(),
  getConfiguredContextSize: vi.fn().mockReturnValue(null),
  getConfiguredTemperature: vi.fn().mockReturnValue(0.7),
  getConfiguredTopP: vi.fn().mockReturnValue(0.9),
  getConfiguredRepeatPenalty: vi.fn().mockReturnValue(1.1),
  getConfiguredNumGpuLayers: vi.fn().mockReturnValue(null),
  getConfiguredThinkingBudget: vi.fn().mockReturnValue(null),
  getActiveModelVramEstimateBytes: vi.fn().mockReturnValue(null),
  setActiveModelVramEstimateBytes: vi.fn(),
  clearActiveLlmSettings: vi.fn(),
  getActiveBaseUrl: vi.fn().mockReturnValue('http://localhost:1234'),
  getDefaultBaseUrl: vi.fn().mockReturnValue('http://localhost:1234'),
  setActiveBaseUrl: vi.fn(),
  isRemoteLlmBaseUrl: vi.fn().mockReturnValue(false),
  normalizeLlmBaseUrl: vi.fn((value?: string | null) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim().replace(/\/+$/, '');
    return trimmed || null;
  }),
  getConfiguredBaseUrlOverride: vi.fn().mockReturnValue(null),
}));

// Hoist the shared mock runtime so tests can assert against the same object
// the service module captures at import time.
const { mockRuntime } = vi.hoisted(() => ({
  mockRuntime: {
    type: 'native' as const,
    ensureReady: vi.fn().mockResolvedValue(undefined),
    restartWithModel: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue('deleted'),
    getBinaryPath: vi.fn().mockResolvedValue('/mock/lms'),
  },
}));

vi.mock('./llamaCppRuntime.js', () => ({
  getLlmRuntime: vi.fn(() => mockRuntime),
}));

vi.mock('@therascript/data', () => ({
  templateRepository: {
    findByTitle: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('@therascript/db/dist/sqliteService.js', () => ({
  SYSTEM_PROMPT_TEMPLATES: {
    SESSION_CHAT: { text: 'session prompt' },
    STANDALONE_CHAT: { text: 'standalone prompt' },
  },
}));

vi.mock('@therascript/services', () => ({
  streamLlmChatDetailed: vi.fn(),
  LlmChatChunk: {},
  LlmConnectionError: class LlmConnectionError extends Error {},
  LlmModelNotFoundError: class LlmModelNotFoundError extends Error {},
  LlmTimeoutError: class LlmTimeoutError extends Error {},
}));

// Mock axios
const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: any[]) => mockAxiosGet(...args),
    post: (...args: any[]) => mockAxiosPost(...args),
  },
}));

// Mock child_process
const mockExecFile = vi.fn();
const mockExec = vi.fn();
vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Mock crypto
const mockRandomUUID = vi.fn().mockReturnValue('test-uuid-123');
vi.mock('node:crypto', () => ({
  default: {
    randomUUID: () => mockRandomUUID(),
  },
}));

// Import the service after mocks are set up
const {
  getBitsPerWeight,
  parseParamCount,
  estimateVramUsage,
  getVramPerToken,
  listModels,
  startDownloadModelJob,
  getDownloadModelJobStatus,
  cancelDownloadModelJob,
  checkModelStatus,
  fetchVramUsage,
  loadLlmModel,
  ensureModelLoaded,
  unloadActiveModel,
  unloadModelAtUrl,
  ensureLlmReady,
  checkLlmApiHealth,
  streamChatResponse,
} = await import('./llamaCppService.js');

// Pull the mocked activeModelService helpers we need to drive local/remote branching
const {
  getActiveBaseUrl,
  isRemoteLlmBaseUrl,
  setActiveBaseUrl,
  setActiveModelVramEstimateBytes,
  getActiveModelVramEstimateBytes,
  getConfiguredNumGpuLayers,
  getConfiguredContextSize,
  getConfiguredTemperature,
  getConfiguredTopP,
  getConfiguredRepeatPenalty,
  getConfiguredThinkingBudget,
  clearActiveLlmSettings,
  getActiveModel,
  setActiveModelName,
} = await import('./activeModelService.js');

const { streamLlmChatDetailed } = await import('@therascript/services');

describe('llamaCppService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getBitsPerWeight', () => {
    it('returns correct bits for F32', () => {
      expect(getBitsPerWeight('F32')).toBe(32);
    });

    it('returns correct bits for F16 and BF16', () => {
      expect(getBitsPerWeight('F16')).toBe(16);
      expect(getBitsPerWeight('BF16')).toBe(16);
    });

    it('returns correct bits for Q8 variants', () => {
      expect(getBitsPerWeight('Q8_0')).toBe(8.5);
      expect(getBitsPerWeight('Q8_1')).toBe(8.5);
    });

    it('returns correct bits for Q6_K', () => {
      expect(getBitsPerWeight('Q6_K')).toBe(6.56);
    });

    it('returns correct bits for Q5 variants', () => {
      expect(getBitsPerWeight('Q5_0')).toBe(5.0);
      expect(getBitsPerWeight('Q5_1')).toBe(5.0);
      expect(getBitsPerWeight('Q5_K_S')).toBe(5.5);
      expect(getBitsPerWeight('Q5_K_M')).toBe(5.5);
      expect(getBitsPerWeight('Q5_K')).toBe(5.5);
    });

    it('returns correct bits for Q4 variants', () => {
      expect(getBitsPerWeight('Q4_0')).toBe(4.0);
      expect(getBitsPerWeight('Q4_1')).toBe(4.0);
      expect(getBitsPerWeight('Q4_K_S')).toBe(4.37);
      expect(getBitsPerWeight('Q4_K_M')).toBe(4.5);
      expect(getBitsPerWeight('Q4_K')).toBe(4.5);
    });

    it('returns correct bits for Q3 variants', () => {
      expect(getBitsPerWeight('Q3_K_S')).toBe(3.5);
      expect(getBitsPerWeight('Q3_K_M')).toBe(3.91);
      expect(getBitsPerWeight('Q3_K_L')).toBe(4.27);
      expect(getBitsPerWeight('Q3_K')).toBe(4.27);
    });

    it('returns correct bits for Q2 variants', () => {
      expect(getBitsPerWeight('Q2_K')).toBe(2.63);
      expect(getBitsPerWeight('Q2_K_S')).toBe(2.63);
    });

    it('returns correct bits for IQ variants', () => {
      expect(getBitsPerWeight('IQ1_S')).toBe(1.56);
      expect(getBitsPerWeight('IQ1_M')).toBe(1.56);
      expect(getBitsPerWeight('IQ2_XXS')).toBe(2.06);
      expect(getBitsPerWeight('IQ2_XS')).toBe(2.31);
      expect(getBitsPerWeight('IQ2_S')).toBe(2.5);
      expect(getBitsPerWeight('IQ2_M')).toBe(2.5);
      expect(getBitsPerWeight('IQ3_XXS')).toBe(3.06);
      expect(getBitsPerWeight('IQ3_XS')).toBe(3.3);
      expect(getBitsPerWeight('IQ3_S')).toBe(3.5);
      expect(getBitsPerWeight('IQ3_M')).toBe(3.5);
      expect(getBitsPerWeight('IQ4_XS')).toBe(4.25);
      expect(getBitsPerWeight('IQ4_NL')).toBe(4.5);
    });

    it('handles hyphenated quantization names', () => {
      expect(getBitsPerWeight('Q4-K-M')).toBe(4.5);
      expect(getBitsPerWeight('Q5-K-S')).toBe(5.5);
    });

    it('returns 0 for unknown quantization levels', () => {
      expect(getBitsPerWeight('UNKNOWN')).toBe(0);
      expect(getBitsPerWeight('')).toBe(0);
    });

    it('is case insensitive', () => {
      expect(getBitsPerWeight('f16')).toBe(16);
      expect(getBitsPerWeight('q4_k_m')).toBe(4.5);
      expect(getBitsPerWeight('Q4_k_M')).toBe(4.5);
    });
  });

  describe('parseParamCount', () => {
    it('parses billions (B) correctly', () => {
      expect(parseParamCount('7B')).toBe(7_000_000_000);
      expect(parseParamCount('13B')).toBe(13_000_000_000);
      expect(parseParamCount('70B')).toBe(70_000_000_000);
    });

    it('parses decimal billions correctly', () => {
      expect(parseParamCount('3.5B')).toBe(3_500_000_000);
      expect(parseParamCount('8.22B')).toBe(8_220_000_000);
    });

    it('parses millions (M) correctly', () => {
      expect(parseParamCount('350M')).toBe(350_000_000);
      expect(parseParamCount('7M')).toBe(7_000_000);
    });

    it('parses thousands (K) correctly', () => {
      expect(parseParamCount('13K')).toBe(13_000);
    });

    it('parses trillions (T) correctly', () => {
      expect(parseParamCount('1T')).toBe(1_000_000_000_000);
    });

    it('handles plain numbers without suffix', () => {
      expect(parseParamCount('7')).toBe(7_000_000_000);
    });

    it('handles whitespace', () => {
      expect(parseParamCount('  7B  ')).toBe(7_000_000_000);
      expect(parseParamCount('8.5 B')).toBe(8_500_000_000);
    });

    it('is case insensitive', () => {
      expect(parseParamCount('7b')).toBe(7_000_000_000);
      expect(parseParamCount('13m')).toBe(13_000_000);
    });

    it('returns null for empty or invalid input', () => {
      expect(parseParamCount('')).toBeNull();
      expect(parseParamCount('invalid')).toBeNull();
      expect(parseParamCount('B')).toBeNull();
      expect(parseParamCount('abc')).toBeNull();
    });

    it('returns null for NaN values', () => {
      expect(parseParamCount('NaN B')).toBeNull();
    });
  });

  describe('estimateVramUsage', () => {
    const createMockModel = (
      size: number,
      paramSize: string,
      quantization: string,
      architecture?: LlmModelInfo['architecture']
    ): LlmModelInfo => ({
      name: 'test-model',
      modified_at: new Date(),
      size,
      digest: 'abc123',
      details: {
        format: 'gguf',
        family: 'llama',
        families: null,
        parameter_size: paramSize,
        quantization_level: quantization,
      },
      defaultContextSize: 4096,
      architecture: architecture || null,
    });

    it('returns null when architecture is missing', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M');
      expect(estimateVramUsage(model, 4096)).toBeNull();
    });

    it('returns null when size is missing', () => {
      const model = createMockModel(0, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });
      expect(estimateVramUsage(model, 4096)).toBeNull();
    });

    it('calculates VRAM correctly with full GPU offload', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });

      const result = estimateVramUsage(model, 4096, null);
      expect(result).not.toBeNull();
      expect(result!.vram_bytes).toBeGreaterThan(0);
      expect(result!.ram_bytes).toBe(0); // All on GPU
      expect(result!.weights_bytes).toBeGreaterThan(0);
      expect(result!.kv_cache_bytes).toBeGreaterThan(0);
      expect(result!.overhead_bytes).toBe(512 * 1024 * 1024); // CUDA overhead
    });

    it('calculates VRAM correctly with CPU-only (0 GPU layers)', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });

      const result = estimateVramUsage(model, 4096, 0);
      expect(result).not.toBeNull();
      // Note: Current implementation always puts KV cache in VRAM
      // Only weights and overhead are moved to CPU
      expect(result!.vram_bytes).toBeGreaterThan(0); // KV cache still in VRAM
      expect(result!.ram_bytes).toBeGreaterThan(0); // Weights on CPU
      expect(result!.overhead_bytes).toBe(0); // No CUDA overhead for CPU-only
    });

    it('calculates VRAM correctly with partial GPU offload', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });

      const result = estimateVramUsage(model, 4096, 16);
      expect(result).not.toBeNull();
      expect(result!.ram_bytes).toBeGreaterThan(0);
      expect(result!.vram_bytes).toBeGreaterThan(0);
    });

    it('uses head_dim when provided explicitly', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        head_dim: 128,
        precision: 16,
      });

      const result = estimateVramUsage(model, 4096);
      expect(result).not.toBeNull();
    });

    it('uses num_key_value_heads when provided', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        precision: 16,
      });

      const result = estimateVramUsage(model, 4096);
      expect(result).not.toBeNull();
    });

    it('handles different context sizes', () => {
      const model = createMockModel(4_000_000_000, '7B', 'Q4_K_M', {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });

      const smallContext = estimateVramUsage(model, 2048);
      const largeContext = estimateVramUsage(model, 8192);

      expect(smallContext!.kv_cache_bytes).toBeLessThan(
        largeContext!.kv_cache_bytes
      );
    });
  });

  describe('getVramPerToken', () => {
    const createMockModel = (
      architecture?: LlmModelInfo['architecture']
    ): LlmModelInfo => ({
      name: 'test-model',
      modified_at: new Date(),
      size: 4_000_000_000,
      digest: 'abc123',
      details: {
        format: 'gguf',
        family: 'llama',
        families: null,
        parameter_size: '7B',
        quantization_level: 'Q4_K_M',
      },
      defaultContextSize: 4096,
      architecture: architecture || null,
    });

    it('returns null when architecture is missing', () => {
      const model = createMockModel();
      expect(getVramPerToken(model)).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      const model = createMockModel({
        num_layers: 32,
        // missing other fields
      });
      expect(getVramPerToken(model)).toBeNull();
    });

    it('calculates VRAM per token correctly', () => {
      const model = createMockModel({
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 16,
      });

      const result = getVramPerToken(model);
      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
      // Expected: 2 * 32 * 32 * (4096/32) * 16 = 2 * 32 * 32 * 128 * 16
      expect(result).toBe(2 * 32 * 32 * 128 * 16);
    });

    it('uses num_key_value_heads when provided', () => {
      const model = createMockModel({
        num_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        precision: 16,
      });

      const result = getVramPerToken(model);
      expect(result).not.toBeNull();
      // Expected: 2 * 32 * 8 * 128 * 16 (fewer KV heads = less memory)
      expect(result).toBe(2 * 32 * 8 * 128 * 16);
    });
  });

  describe('LM Studio output parsing (via fetchVramUsage)', () => {
    it('parses GiB format correctly', async () => {
      // Mock the execFile to return valid LMS output
      mockExecFile.mockImplementation((...args: any[]) => {
        const lmsOutput =
          'Estimated GPU Memory: 4.52 GiB\nEstimated Total Memory: 5.20 GiB';
        const callback = args[args.length - 1];
        callback(null, { stdout: lmsOutput, stderr: '' });
      });

      const model: LlmModelInfo = {
        name: 'test-model',
        modified_at: new Date(),
        size: 4_000_000_000,
        digest: 'abc123',
        details: {
          format: 'gguf',
          family: 'llama',
          families: null,
          parameter_size: '7B',
          quantization_level: 'Q4_K_M',
        },
        defaultContextSize: 4096,
        architecture: null,
      };

      const result = await fetchVramUsage(model, 4096);
      expect(result).not.toBeNull();
      expect(result!.vram_bytes).toBeGreaterThan(0);
      expect(result!.ram_bytes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('listModels', () => {
    it('propagates the error when the API is unreachable', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Connection refused'));

      await expect(listModels()).rejects.toThrow();
    });

    it('propagates the error when the request times out', async () => {
      mockAxiosGet.mockRejectedValue(new Error('timeout'));

      await expect(listModels()).rejects.toThrow();
    });

    it('filters out non-LLM models', async () => {
      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              display_name: 'Llama 3 8B',
              architecture: 'llama',
              quantization: { name: 'Q4_K_M', bits_per_weight: 4.5 },
              size_bytes: 4_500_000_000,
              params_string: '8B',
              loaded_instances: [],
              max_context_length: 8192,
              format: 'gguf',
            },
            {
              type: 'embedding',
              publisher: 'openai',
              key: 'openai/text-embedding-3',
              display_name: 'Text Embedding 3',
              architecture: 'transformer',
              quantization: null,
              size_bytes: 1_000_000_000,
              params_string: null,
              loaded_instances: [],
              max_context_length: 512,
              format: 'gguf',
            },
          ],
        },
      });

      const result = await listModels();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('meta/llama-3-8b');
    });

    it('maps model properties correctly', async () => {
      const mockModel = {
        type: 'llm',
        publisher: 'meta',
        key: 'meta/llama-3-8b',
        display_name: 'Llama 3 8B',
        architecture: 'llama',
        quantization: { name: 'Q4_K_M', bits_per_weight: 4.5 },
        size_bytes: 4_500_000_000,
        params_string: '8B',
        loaded_instances: [
          {
            id: 'instance-1',
            config: { context_length: 4096, flash_attention: true },
          },
        ],
        max_context_length: 8192,
        format: 'gguf',
      };

      mockAxiosGet.mockResolvedValue({
        status: 200,
        data: { models: [mockModel] },
      });

      const result = await listModels();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'meta/llama-3-8b',
        size: 4_500_000_000,
        digest: 'meta/llama-3-8b',
        details: {
          format: 'gguf',
          family: 'llama',
          parameter_size: '8B',
          quantization_level: 'Q4_K_M',
        },
        defaultContextSize: 8192,
      });
    });
  });

  describe('startDownloadModelJob', () => {
    it('throws error for empty model reference', () => {
      expect(() => startDownloadModelJob('')).toThrow(
        'Model reference is required'
      );
      expect(() => startDownloadModelJob('   ')).toThrow(
        'Model reference is required'
      );
    });

    it('returns job ID for valid model reference', () => {
      mockAxiosPost.mockResolvedValue({
        data: {
          status: 'already_downloaded',
        },
      });

      const jobId = startDownloadModelJob('meta/llama-3-8b');
      expect(jobId).toBe('test-uuid-123');
    });

    it('creates job with downloading status (async transition)', async () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'downloading', job_id: 'lms-job-1' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      // Wait for async transition
      await vi.advanceTimersByTimeAsync(10);

      const status = getDownloadModelJobStatus('test-uuid-123');
      expect(status).not.toBeNull();
      expect(status!.status).toBe('downloading');
      expect(status!.modelName).toBe('meta/llama-3-8b');
    });
  });

  describe('getDownloadModelJobStatus', () => {
    it('returns null for non-existent job', () => {
      const status = getDownloadModelJobStatus('non-existent-job');
      expect(status).toBeNull();
    });

    it('returns correct status for existing job', () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'downloading', job_id: 'lms-job-1' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      const status = getDownloadModelJobStatus('test-uuid-123');
      expect(status).not.toBeNull();
      expect(status!.jobId).toBe('test-uuid-123');
    });

    it('returns immutable copy of status', () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'downloading', job_id: 'lms-job-1' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      const status1 = getDownloadModelJobStatus('test-uuid-123');
      const status2 = getDownloadModelJobStatus('test-uuid-123');
      expect(status1).not.toBe(status2); // Different object references
      expect(status1).toEqual(status2); // Same content
    });
  });

  describe('cancelDownloadModelJob', () => {
    it('returns false for non-existent job', () => {
      const result = cancelDownloadModelJob('non-existent-job');
      expect(result).toBe(false);
    });

    it('returns false for already completed job', async () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'already_downloaded' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      // Wait for the job to complete
      await vi.advanceTimersByTimeAsync(100);

      const result = cancelDownloadModelJob('test-uuid-123');
      expect(result).toBe(false);
    });

    it('returns true and sets canceling status for active job', () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'downloading', job_id: 'lms-job-1' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      const result = cancelDownloadModelJob('test-uuid-123');
      expect(result).toBe(true);

      const status = getDownloadModelJobStatus('test-uuid-123');
      expect(status!.status).toBe('canceling');
    });

    it('allows re-canceling a canceling job (status is not final)', () => {
      mockAxiosPost.mockResolvedValue({
        data: { status: 'downloading', job_id: 'lms-job-1' },
      });

      startDownloadModelJob('meta/llama-3-8b');

      cancelDownloadModelJob('test-uuid-123');

      // Try to cancel again - currently allowed since 'canceling' is not in the final states list
      const result = cancelDownloadModelJob('test-uuid-123');
      expect(result).toBe(true);
    });
  });

  describe('checkModelStatus', () => {
    it('returns null and clears all settings when API is not responsive', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      mockAxiosGet.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).toBeNull();
      expect(clearActiveLlmSettings).toHaveBeenCalledTimes(1);
    });

    it('clears all settings when remote target is unreachable', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
      mockAxiosGet.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).toBeNull();
      expect(clearActiveLlmSettings).toHaveBeenCalledTimes(1);
    });

    it('clears all settings when a model exists but no instances are loaded', async () => {
      vi.mocked(getActiveModel).mockReturnValue('meta/llama-3-8b');
      // First call for isLlmApiResponsive, second for actual data
      mockAxiosGet
        .mockResolvedValueOnce({ status: 200, data: { models: [] } })
        .mockResolvedValueOnce({
          data: {
            models: [
              {
                type: 'llm',
                publisher: 'meta',
                key: 'meta/llama-3-8b',
                display_name: 'Llama 3 8B',
                architecture: 'llama',
                quantization: { name: 'Q4_K_M', bits_per_weight: 4.5 },
                size_bytes: 4_500_000_000,
                params_string: '8B',
                loaded_instances: [],
                max_context_length: 8192,
                format: 'gguf',
              },
            ],
          },
        });

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('meta/llama-3-8b');
      expect(result!.size_vram).toBeUndefined();
      expect(clearActiveLlmSettings).toHaveBeenCalledTimes(1);
    });

    it('does not clear settings when a model is loaded', async () => {
      vi.mocked(getActiveModelVramEstimateBytes).mockReturnValue(5_000_000_000);
      vi.mocked(getActiveModel).mockReturnValue('meta/llama-3-8b');

      // First call for isLlmApiResponsive, second for actual data
      mockAxiosGet
        .mockResolvedValueOnce({ status: 200, data: { models: [] } })
        .mockResolvedValueOnce({
          data: {
            models: [
              {
                type: 'llm',
                publisher: 'meta',
                key: 'meta/llama-3-8b',
                display_name: 'Llama 3 8B',
                architecture: 'llama',
                quantization: { name: 'Q4_K_M', bits_per_weight: 4.5 },
                size_bytes: 4_500_000_000,
                params_string: '8B',
                loaded_instances: [
                  {
                    id: 'instance-1',
                    config: { context_length: 4096 },
                  },
                ],
                max_context_length: 8192,
                format: 'gguf',
              },
            ],
          },
        });

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).not.toBeNull();
      expect(result!.size_vram).toBe(5_000_000_000);
      expect(clearActiveLlmSettings).not.toHaveBeenCalled();
      expect(setActiveModelName).not.toHaveBeenCalled();
    });

    it('returns model info when model is available but not loaded (legacy)', async () => {
      // First call for isLlmApiResponsive, second for actual data
      mockAxiosGet
        .mockResolvedValueOnce({ status: 200, data: { models: [] } })
        .mockResolvedValueOnce({
          data: {
            models: [
              {
                type: 'llm',
                publisher: 'meta',
                key: 'meta/llama-3-8b',
                display_name: 'Llama 3 8B',
                architecture: 'llama',
                quantization: { name: 'Q4_K_M', bits_per_weight: 4.5 },
                size_bytes: 4_500_000_000,
                params_string: '8B',
                loaded_instances: [],
                max_context_length: 8192,
                format: 'gguf',
              },
            ],
          },
        });

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('meta/llama-3-8b');
      expect(result!.size_vram).toBeUndefined();
    });
  });

  describe('loadLlmModel — local', () => {
    beforeEach(() => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
    });

    it('restarts the local runtime, unloads prior instances, and loads with correct payload', async () => {
      mockRuntime.restartWithModel.mockClear();

      // Enumerate prior loaded instances, then unload + load
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/old-model',
              loaded_instances: [
                { id: 'old-inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} }); // unload old
      mockAxiosPost.mockResolvedValueOnce({
        data: { instance_id: 'new-inst-1', load_time_seconds: 1.5 },
      }); // load

      await loadLlmModel('meta/llama-3-8b', 8192);

      expect(mockRuntime.restartWithModel).toHaveBeenCalledWith(
        'meta/llama-3-8b'
      );
      // VRAM estimate is cleared before load
      expect(setActiveModelVramEstimateBytes).toHaveBeenCalledWith(null);
      // Unload the old instance
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://localhost:1234/api/v1/models/unload',
        { instance_id: 'old-inst-1' },
        expect.objectContaining({ timeout: 30000 })
      );
      // Load the new model with the right payload
      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall).toBeDefined();
      expect(loadCall![1]).toMatchObject({
        model: 'meta/llama-3-8b',
        echo_load_config: true,
        flash_attention: true,
        context_length: 8192,
        offload_kv_cache_to_gpu: true, // numGpuLayers=null !== 0
      });
    });

    it('omits context_length when no context is configured', async () => {
      vi.mocked(getConfiguredContextSize).mockReturnValue(null);
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({
        data: { instance_id: 'new-inst-1' },
      });

      await loadLlmModel('meta/llama-3-8b');

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall![1]).not.toHaveProperty('context_length');
    });

    it('sends offload_kv_cache_to_gpu=false when numGpuLayers=0 (CPU-only)', async () => {
      vi.mocked(getConfiguredNumGpuLayers).mockReturnValue(0);
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst' } });

      await loadLlmModel('meta/llama-3-8b', 4096);

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall![1]).toMatchObject({ offload_kv_cache_to_gpu: false });
    });

    it('continues loading even if unloading a prior instance fails', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/stubborn',
              loaded_instances: [
                { id: 'stubborn-1', config: { context_length: 2048 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockRejectedValueOnce(new Error('unload failed'));
      mockAxiosPost.mockResolvedValueOnce({
        data: { instance_id: 'new-inst' },
      });

      await expect(
        loadLlmModel('meta/llama-3-8b', 4096)
      ).resolves.toBeUndefined();

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall).toBeDefined();
    });

    it('fires background VRAM estimate after load and stores the result', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst' } });
      mockExecFile.mockImplementation((...args: any[]) => {
        const callback = args[args.length - 1];
        callback(null, {
          stdout:
            'Estimated GPU Memory: 4.52 GiB\nEstimated Total Memory: 5.20 GiB',
          stderr: '',
        });
      });

      await loadLlmModel('meta/llama-3-8b', 4096);
      // Drain microtasks so the fire-and-forget .then() runs
      await vi.advanceTimersByTimeAsync(0);

      expect(mockExecFile).toHaveBeenCalled();
      const lastCall =
        mockExecFile.mock.calls[mockExecFile.mock.calls.length - 1];
      // Binary + model key + context flag are passed to lms
      expect(lastCall[0]).toMatch(/lms$/);
      expect(lastCall[1]).toContain('meta/llama-3-8b');
      expect(setActiveModelVramEstimateBytes).toHaveBeenCalledWith(
        expect.any(Number)
      );
    });

    it('throws InternalServerError when the load POST fails', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockRejectedValueOnce({
        response: { data: { error: 'no such model' } },
        message: 'Request failed',
      });

      await expect(loadLlmModel('meta/missing', 4096)).rejects.toThrow(
        /Failed to load model 'meta\/missing' via LM Studio API/
      );
    });
  });

  describe('loadLlmModel — remote', () => {
    const REMOTE_URL = 'http://10.0.0.1:1234';

    beforeEach(() => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
      vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_URL);
    });

    it('does NOT restart the local runtime', async () => {
      mockRuntime.restartWithModel.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst' } });

      await loadLlmModel('meta/llama-3-8b', 4096, REMOTE_URL);

      expect(mockRuntime.restartWithModel).not.toHaveBeenCalled();
    });

    it('targets the explicit remote base URL for enumerate/unload/load', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst' } });

      await loadLlmModel('meta/llama-3-8b', 4096, REMOTE_URL);

      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${REMOTE_URL}/api/v1/models`,
        expect.objectContaining({ timeout: 5000 })
      );
      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === `${REMOTE_URL}/api/v1/models/load`
      );
      expect(loadCall).toBeDefined();
    });

    it('does NOT fire the background VRAM estimator for remote URLs', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst' } });
      mockExecFile.mockClear();

      await loadLlmModel('meta/llama-3-8b', 4096, REMOTE_URL);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('ensureModelLoaded', () => {
    beforeEach(() => {
      // Reset the local/remote branching state set up by earlier describe blocks
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue('http://localhost:1234');
    });

    it('returns early without calling loadLlmModel when the same model is already loaded with sufficient context', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 8192 } },
              ],
            },
          ],
        },
      });
      // No mockAxiosPost expected for load

      await expect(
        ensureModelLoaded('meta/llama-3-8b', 4096)
      ).resolves.toBeUndefined();
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('reloads when the loaded context is smaller than required', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 2048 } },
              ],
            },
          ],
        },
      });
      // Enumerate again (inside loadLlmModel), unload (none), then load
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst-1' } });

      await ensureModelLoaded('meta/llama-3-8b', 8192);

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall).toBeDefined();
      expect(loadCall![1]).toMatchObject({ context_length: 8192 });
    });

    it('falls through to loadLlmModel when the model is not loaded', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } }); // status check
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } }); // enumerate inside load
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst-1' } });

      await ensureModelLoaded('meta/llama-3-8b', 4096);

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall).toBeDefined();
    });

    it('matches the loaded model via the publisher/key form', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });

      await expect(
        ensureModelLoaded('meta/llama-3-8b', 4096)
      ).resolves.toBeUndefined();
      expect(mockAxiosPost).not.toHaveBeenCalled();
    });

    it('falls through to load when the status check itself fails', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } }); // enumerate inside load
      mockAxiosPost.mockResolvedValueOnce({ data: { instance_id: 'inst-1' } });

      await ensureModelLoaded('meta/llama-3-8b', 4096);

      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === 'http://localhost:1234/api/v1/models/load'
      );
      expect(loadCall).toBeDefined();
    });
  });

  describe('unloadActiveModel — local', () => {
    const LOCAL_URL = 'http://localhost:1234';

    beforeEach(() => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
    });

    it('unloads all loaded instances in parallel and reports a count', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
                { id: 'inst-2', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValue({ data: {} });

      const message = await unloadActiveModel();

      expect(mockAxiosPost).toHaveBeenCalledTimes(2);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models/unload`,
        { instance_id: 'inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models/unload`,
        { instance_id: 'inst-2' },
        expect.objectContaining({ timeout: 15000 })
      );
      expect(message).toMatch(/2 model instance\(s\) unloaded successfully/);
      expect(setActiveBaseUrl).not.toHaveBeenCalled();
    });

    it('falls back to runtime.stop() when nothing was loaded locally', async () => {
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });

      const message = await unloadActiveModel();

      expect(mockRuntime.stop).toHaveBeenCalled();
      expect(message).toBe('LM Studio server stopped (no models were loaded).');
    });

    it('tolerates unload failures and still reports the successful count', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
                { id: 'inst-2', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockRejectedValueOnce(new Error('first unload failed'));
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      const message = await unloadActiveModel();

      expect(message).toMatch(/1 model instance\(s\) unloaded successfully/);
    });
  });

  describe('unloadActiveModel — remote', () => {
    const REMOTE_URL = 'http://10.0.0.1:1234';

    beforeEach(() => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
      vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_URL);
    });

    it('unloads remote instances and resets the active base URL to local when resetBaseUrl=true', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      const message = await unloadActiveModel(REMOTE_URL, true);

      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${REMOTE_URL}/api/v1/models/unload`,
        { instance_id: 'inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      expect(setActiveBaseUrl).toHaveBeenCalledWith(null);
      expect(message).toMatch(/1 model instance\(s\) unloaded successfully/);
    });

    it('leaves the active base URL alone when resetBaseUrl=false', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      await unloadActiveModel(REMOTE_URL, false);

      expect(setActiveBaseUrl).not.toHaveBeenCalled();
    });

    it('does not call runtime.stop when nothing was loaded on the remote server', async () => {
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });

      const message = await unloadActiveModel(REMOTE_URL, true);

      expect(mockRuntime.stop).not.toHaveBeenCalled();
      expect(message).toBe('No models were loaded on the remote server.');
    });
  });

  describe('unloadModelAtUrl', () => {
    const LOCAL_URL = 'http://localhost:1234';
    const REMOTE_URL = 'http://10.0.0.1:1234';

    it('unloads all loaded instances at the given local URL and returns the count', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
                { id: 'inst-2', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValue({ data: {} });

      const count = await unloadModelAtUrl(LOCAL_URL);

      expect(count).toBe(2);
      expect(mockAxiosPost).toHaveBeenCalledTimes(2);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models/unload`,
        { instance_id: 'inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models/unload`,
        { instance_id: 'inst-2' },
        expect.objectContaining({ timeout: 15000 })
      );
      // runtime.stop is only called when 0 instances were unloaded.
      expect(mockRuntime.stop).not.toHaveBeenCalled();
    });

    it('unloads loaded instances at a given remote URL and does not call runtime.stop', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      const count = await unloadModelAtUrl(REMOTE_URL);

      expect(count).toBe(1);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${REMOTE_URL}/api/v1/models/unload`,
        { instance_id: 'inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      expect(mockRuntime.stop).not.toHaveBeenCalled();
    });

    it('tolerates individual unload failures and still returns the successful count', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );

      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/llama-3-8b',
              loaded_instances: [
                { id: 'inst-1', config: { context_length: 4096 } },
                { id: 'inst-2', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockRejectedValueOnce(new Error('first unload failed'));
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      const count = await unloadModelAtUrl(LOCAL_URL);

      expect(count).toBe(1);
      expect(mockAxiosPost).toHaveBeenCalledTimes(2);
    });

    it('tolerates GET failure and returns 0', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );

      mockAxiosGet.mockRejectedValueOnce(new Error('network down'));
      mockRuntime.stop?.mockClear();

      const count = await unloadModelAtUrl(REMOTE_URL);

      expect(count).toBe(0);
      // Remote URL with GET failure: no runtime.stop should be called
      expect(mockRuntime.stop).not.toHaveBeenCalled();
    });

    it('falls back to runtime.stop() for local URL when nothing was loaded', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });

      const count = await unloadModelAtUrl(LOCAL_URL);

      expect(count).toBe(0);
      expect(mockRuntime.stop).toHaveBeenCalled();
    });

    it('does not call runtime.stop() for remote URL even when nothing was loaded', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );
      mockRuntime.stop?.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });

      const count = await unloadModelAtUrl(REMOTE_URL);

      expect(count).toBe(0);
      expect(mockRuntime.stop).not.toHaveBeenCalled();
    });
  });

  describe('URL switch — local to remote unloads the previous local model', () => {
    const LOCAL_URL = 'http://localhost:1234';
    const REMOTE_URL = 'http://10.0.0.1:1234';

    it('unloads the local URL first, then loads on the remote URL, without restarting the local runtime', async () => {
      // Set up: active is local, new call is for remote
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => url !== LOCAL_URL && !!url
      );
      vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
      mockRuntime.restartWithModel?.mockClear();

      // 1st call (unloadModelAtUrl on previous local): GET enumerates 1 instance
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/old-local',
              loaded_instances: [
                { id: 'local-inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      // 1st call: POST unload on local URL
      mockAxiosPost.mockResolvedValueOnce({ data: {} });
      // 2nd call (loadLlmModel on new remote): GET enumerates 0 instances
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      // 2nd call: POST load on remote URL
      mockAxiosPost.mockResolvedValueOnce({
        data: { instance_id: 'remote-inst-1', load_time_seconds: 1.0 },
      });

      // Simulate the set-model route flow: unload first, then load
      const unloaded = await unloadModelAtUrl(getActiveBaseUrl());
      await loadLlmModel('meta/remote-model', 8192, REMOTE_URL);

      expect(unloaded).toBe(1);
      // Unload POST hit the local URL
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models/unload`,
        { instance_id: 'local-inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      // Load POST hit the remote URL
      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === `${REMOTE_URL}/api/v1/models/load`
      );
      expect(loadCall).toBeDefined();
      expect(loadCall![1]).toMatchObject({
        model: 'meta/remote-model',
        context_length: 8192,
      });
      // Local runtime was NOT restarted (we're loading on remote)
      expect(mockRuntime.restartWithModel).not.toHaveBeenCalled();
    });

    it('switching from remote A to remote B unloads A and loads B', async () => {
      const REMOTE_A = 'http://10.0.0.1:1234';
      const REMOTE_B = 'http://10.0.0.2:1234';

      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => !!url && url !== 'http://localhost:1234'
      );
      vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_A);

      // Pre-switch: GET on A returns 1 instance; POST unload on A
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/old',
              loaded_instances: [
                { id: 'a-inst-1', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} });
      // Load: GET on B returns 0; POST load on B
      mockAxiosGet.mockResolvedValueOnce({ data: { models: [] } });
      mockAxiosPost.mockResolvedValueOnce({
        data: { instance_id: 'b-inst-1', load_time_seconds: 1.0 },
      });

      const unloaded = await unloadModelAtUrl(getActiveBaseUrl());
      await loadLlmModel('meta/new', 4096, REMOTE_B);

      expect(unloaded).toBe(1);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        `${REMOTE_A}/api/v1/models/unload`,
        { instance_id: 'a-inst-1' },
        expect.objectContaining({ timeout: 15000 })
      );
      const loadCall = mockAxiosPost.mock.calls.find(
        ([url]: any) => url === `${REMOTE_B}/api/v1/models/load`
      );
      expect(loadCall).toBeDefined();
    });

    it('when the new URL equals the current URL, the helper still unloads whatever is there (caller decides)', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockImplementation(
        (url?: string | null) => !!url && url !== 'http://localhost:1234'
      );
      vi.mocked(getActiveBaseUrl).mockReturnValue('http://10.0.0.1:1234');

      mockAxiosGet.mockResolvedValueOnce({
        data: {
          models: [
            {
              type: 'llm',
              publisher: 'meta',
              key: 'meta/same',
              loaded_instances: [
                { id: 'inst-same', config: { context_length: 4096 } },
              ],
            },
          ],
        },
      });
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      const count = await unloadModelAtUrl('http://10.0.0.1:1234');

      expect(count).toBe(1);
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'http://10.0.0.1:1234/api/v1/models/unload',
        { instance_id: 'inst-same' },
        expect.objectContaining({ timeout: 15000 })
      );
    });
  });

  describe('ensureLlmReady', () => {
    const LOCAL_URL = 'http://localhost:1234';
    const REMOTE_URL = 'http://10.0.0.1:1234';

    it('local: calls runtime.ensureReady and then health-checks via GET /api/v1/models', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);
      mockRuntime.ensureReady.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ status: 200 });

      await expect(ensureLlmReady()).resolves.toBeUndefined();

      expect(mockRuntime.ensureReady).toHaveBeenCalled();
      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${LOCAL_URL}/api/v1/models`,
        expect.objectContaining({ timeout: 3000 })
      );
    });

    it('local: throws InternalServerError when the runtime comes up but the API is not responsive', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);

      mockAxiosGet.mockResolvedValueOnce({ status: 500 });

      await expect(ensureLlmReady()).rejects.toThrow(
        /LLM runtime \(native\) failed health check/
      );
    });

    it('remote: skips runtime.ensureReady and only health-checks the remote URL', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
      vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_URL);
      mockRuntime.ensureReady.mockClear();

      mockAxiosGet.mockResolvedValueOnce({ status: 200 });

      await expect(ensureLlmReady(REMOTE_URL)).resolves.toBeUndefined();

      expect(mockRuntime.ensureReady).not.toHaveBeenCalled();
      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${REMOTE_URL}/api/v1/models`,
        expect.objectContaining({ timeout: 3000 })
      );
    });

    it('remote: throws InternalServerError when the remote server is unreachable', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(true);
      vi.mocked(getActiveBaseUrl).mockReturnValue(REMOTE_URL);

      mockAxiosGet.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(ensureLlmReady(REMOTE_URL)).rejects.toThrow(
        /Remote LLM at .* failed health check/
      );
    });

    it('checkLlmApiHealth is a thin wrapper that returns isLlmApiResponsive for the resolved URL', async () => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue(LOCAL_URL);

      mockAxiosGet.mockResolvedValueOnce({ status: 200 });
      await expect(checkLlmApiHealth()).resolves.toBe(true);

      mockAxiosGet.mockReset();
      mockAxiosGet.mockRejectedValueOnce(new Error('boom'));
      await expect(checkLlmApiHealth()).resolves.toBe(false);
    });
  });

  describe('streamChatResponse', () => {
    const messages: BackendChatMessage[] = [
      { id: 1, chatId: 1, sender: 'user', text: 'hi', timestamp: 0 },
    ];

    beforeEach(() => {
      vi.mocked(isRemoteLlmBaseUrl).mockReturnValue(false);
      vi.mocked(getActiveBaseUrl).mockReturnValue('http://localhost:1234');
      // Reset configured-value mocks so earlier tests (e.g. CPU-only numGpuLayers=0)
      // don't leak their state into the default-merge assertions below.
      vi.mocked(getConfiguredTemperature).mockReturnValue(0.7);
      vi.mocked(getConfiguredTopP).mockReturnValue(0.9);
      vi.mocked(getConfiguredRepeatPenalty).mockReturnValue(1.1);
      vi.mocked(getConfiguredNumGpuLayers).mockReturnValue(null);
      vi.mocked(getConfiguredThinkingBudget).mockReturnValue(null);
    });

    async function consume<T, R>(
      gen: AsyncGenerator<T, R>
    ): Promise<{ chunks: T[]; result: R }> {
      const chunks: T[] = [];
      let step: IteratorResult<T, R>;
      while (!(step = await gen.next()).done) {
        chunks.push(step.value);
      }
      return { chunks, result: step.value };
    }

    it('resolves the base URL from getActiveBaseUrl when no override is given', async () => {
      vi.mocked(streamLlmChatDetailed).mockImplementation(async function* () {
        yield { content: 'a' };
        yield { content: 'b' };
        return { promptTokens: 3, completionTokens: 2 };
      });

      const { chunks, result } = await consume(streamChatResponse(messages));

      expect(chunks).toEqual([{ content: 'a' }, { content: 'b' }]);
      expect(result).toEqual({ promptTokens: 3, completionTokens: 2 });
      expect(streamLlmChatDetailed).toHaveBeenCalledTimes(1);
      const passedCall = vi.mocked(streamLlmChatDetailed).mock.calls[0]!;
      const [passedMsgs, passedOpts] = passedCall as any;
      expect(passedMsgs).toBe(messages);
      expect(passedOpts).toMatchObject({
        llamaCppBaseUrl: 'http://localhost:1234',
        temperature: 0.7,
        topP: 0.9,
        repeatPenalty: 1.1,
        numGpuLayers: null,
        thinkingBudget: null,
      });
    });

    it('prefers an explicit llamaCppBaseUrl option over the active base URL', async () => {
      vi.mocked(streamLlmChatDetailed).mockImplementation(async function* () {
        return { promptTokens: 0, completionTokens: 0 };
      });

      await consume(
        streamChatResponse(messages, {
          llamaCppBaseUrl: 'http://10.0.0.1:1234',
        })
      );

      const passedCall = vi.mocked(streamLlmChatDetailed).mock.calls[0]!;
      const [, passedOpts] = passedCall as any;
      expect(passedOpts.llamaCppBaseUrl).toBe('http://10.0.0.1:1234');
    });

    it('treats explicit null as a reset to the active base URL', async () => {
      vi.mocked(streamLlmChatDetailed).mockImplementation(async function* () {
        return { promptTokens: 0, completionTokens: 0 };
      });

      await consume(streamChatResponse(messages, { llamaCppBaseUrl: null }));

      const passedCall = vi.mocked(streamLlmChatDetailed).mock.calls[0]!;
      const [, passedOpts] = passedCall as any;
      expect(passedOpts.llamaCppBaseUrl).toBe('http://localhost:1234');
    });

    it('lets explicit options override the configured defaults', async () => {
      vi.mocked(streamLlmChatDetailed).mockImplementation(async function* () {
        return { promptTokens: 0, completionTokens: 0 };
      });

      await consume(
        streamChatResponse(messages, {
          temperature: 0.2,
          numGpuLayers: 16,
          llamaCppBaseUrl: 'http://10.0.0.1:1234',
        })
      );

      const passedCall = vi.mocked(streamLlmChatDetailed).mock.calls[0]!;
      const [, passedOpts] = passedCall as any;
      expect(passedOpts.temperature).toBe(0.2);
      expect(passedOpts.numGpuLayers).toBe(16);
      // base URL is always re-resolved AFTER the spread
      expect(passedOpts.llamaCppBaseUrl).toBe('http://10.0.0.1:1234');
    });

    it('forwards the return value from the inner generator', async () => {
      vi.mocked(streamLlmChatDetailed).mockImplementation(async function* () {
        yield { content: 'x' };
        return { promptTokens: 11, completionTokens: 22 };
      });

      const { result } = await consume(streamChatResponse(messages));

      expect(result).toEqual({ promptTokens: 11, completionTokens: 22 });
    });
  });
});
