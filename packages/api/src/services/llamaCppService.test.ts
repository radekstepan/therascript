import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LlmModelInfo, VramEstimate } from '@therascript/domain';

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
}));

vi.mock('./llamaCppRuntime.js', () => ({
  getLlmRuntime: vi.fn().mockReturnValue({
    type: 'native',
    ensureReady: vi.fn().mockResolvedValue(undefined),
    restartWithModel: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue('deleted'),
  }),
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
} = await import('./llamaCppService.js');

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
    it('returns empty array when API fails', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Connection refused'));

      const result = await listModels();
      expect(result).toEqual([]);
    });

    it('returns empty array when request times out', async () => {
      mockAxiosGet.mockRejectedValue(new Error('timeout'));

      const result = await listModels();
      expect(result).toEqual([]);
    });

    it('filters out non-LLM models', async () => {
      mockAxiosGet.mockResolvedValue({
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
    it('returns null when API is not responsive', async () => {
      // First mock returns true for isLlmApiResponsive, second returns null for actual call
      mockAxiosGet.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await checkModelStatus('meta/llama-3-8b');
      expect(result).toBeNull();
    });

    it('returns model info when model is available but not loaded', async () => {
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

    it('includes VRAM estimate when model is loaded', async () => {
      const { getActiveModelVramEstimateBytes } = await import(
        './activeModelService.js'
      );
      vi.mocked(getActiveModelVramEstimateBytes).mockReturnValue(5_000_000_000);

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
    });
  });
});
