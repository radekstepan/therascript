import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@therascript/config', () => ({
  default: {
    llm: { modelPath: 'llama3', baseURL: 'http://localhost:1234' },
  },
}));

const defaultMockSettings = () => ({
  llm_base_url: null,
  llm_model_name: 'llama3',
  llm_context_size: null,
  llm_temperature: 0.7,
  llm_top_p: 0.9,
  llm_repeat_penalty: 1.1,
  llm_num_gpu_layers: null,
  llm_thinking_budget: null,
});

let mockSettings: any = defaultMockSettings();

vi.mock('@therascript/data', () => ({
  appSettingsRepository: {
    getSettings: vi.fn(() => mockSettings),
    updateSettings: vi.fn((updates: Record<string, unknown>) => {
      mockSettings = { ...mockSettings, ...updates };
    }),
  },
}));

describe('activeModelService', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSettings = defaultMockSettings();
  });

  it('returns configured model initially and updates model + context size', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.getActiveModel()).toBe('llama3');
    expect(svc.getConfiguredContextSize()).toBeNull();

    svc.setActiveModelAndContextAndParams('mistral', 4096);
    expect(svc.getActiveModel()).toBe('mistral');
    expect(svc.getConfiguredContextSize()).toBe(4096);
  });

  it('rejects invalid model names and does not change state', async () => {
    const svc = await import('./activeModelService.js');
    const beforeModel = svc.getActiveModel();
    const beforeCtx = svc.getConfiguredContextSize();
    svc.setActiveModelAndContextAndParams('' as any, 2048);
    expect(svc.getActiveModel()).toBe(beforeModel);
    expect(svc.getConfiguredContextSize()).toBe(beforeCtx);
  });
});

describe('activeModelService — numGpuLayers', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSettings = defaultMockSettings();
  });

  it('starts as null (auto) by default', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.getConfiguredNumGpuLayers()).toBeNull();
  });

  it('stores a valid positive layer count', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'gemma3:12b',
      null,
      0.7,
      0.9,
      1.1,
      16
    );
    expect(svc.getConfiguredNumGpuLayers()).toBe(16);
  });

  it('stores 0 (CPU-only mode)', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams('gemma3:12b', null, 0.7, 0.9, 1.1, 0);
    expect(svc.getConfiguredNumGpuLayers()).toBe(0);
  });

  it('stores null when passed null (auto mode)', async () => {
    const svc = await import('./activeModelService.js');
    // First set a value, then reset to auto
    svc.setActiveModelAndContextAndParams('gemma3:12b', null, 0.7, 0.9, 1.1, 8);
    expect(svc.getConfiguredNumGpuLayers()).toBe(8);
    svc.setActiveModelAndContextAndParams(
      'gemma3:12b',
      null,
      0.7,
      0.9,
      1.1,
      null
    );
    expect(svc.getConfiguredNumGpuLayers()).toBeNull();
  });

  it('rejects negative numGpuLayers and falls back to null (auto)', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'gemma3:12b',
      null,
      0.7,
      0.9,
      1.1,
      -1
    );
    expect(svc.getConfiguredNumGpuLayers()).toBeNull();
  });

  it('rejects non-integer numGpuLayers and falls back to null (auto)', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'gemma3:12b',
      null,
      0.7,
      0.9,
      1.1,
      4.5 as any
    );
    expect(svc.getConfiguredNumGpuLayers()).toBeNull();
  });

  it('persists sampling params independently of GPU layers', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'llama3:8b',
      8192,
      1.2,
      0.85,
      1.3,
      24
    );
    expect(svc.getActiveModel()).toBe('llama3:8b');
    expect(svc.getConfiguredContextSize()).toBe(8192);
    expect(svc.getConfiguredTemperature()).toBe(1.2);
    expect(svc.getConfiguredTopP()).toBe(0.85);
    expect(svc.getConfiguredRepeatPenalty()).toBe(1.3);
    expect(svc.getConfiguredNumGpuLayers()).toBe(24);
  });
});

describe('activeModelService — LLM base URL', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSettings = defaultMockSettings();
  });

  it('returns the configured default base URL initially', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.getDefaultBaseUrl()).toBe('http://localhost:1234');
    expect(svc.getActiveBaseUrl()).toBe('http://localhost:1234');
    expect(svc.getConfiguredBaseUrlOverride()).toBeNull();
    expect(svc.isRemoteLlmBaseUrl()).toBe(false);
  });

  it('normalizes a valid URL by trimming and stripping trailing slashes', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.normalizeLlmBaseUrl('  http://example.com:1234/  ')).toBe(
      'http://example.com:1234'
    );
  });

  it('normalizes empty/whitespace strings to null', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.normalizeLlmBaseUrl('')).toBeNull();
    expect(svc.normalizeLlmBaseUrl('   ')).toBeNull();
    expect(svc.normalizeLlmBaseUrl(null)).toBeNull();
    expect(svc.normalizeLlmBaseUrl(undefined)).toBeNull();
  });

  it('rejects URLs that are not http or https', async () => {
    const svc = await import('./activeModelService.js');
    expect(() => svc.normalizeLlmBaseUrl('ftp://example.com')).toThrow(
      /http or https/
    );
  });

  it('rejects invalid URL strings', async () => {
    const svc = await import('./activeModelService.js');
    expect(() => svc.normalizeLlmBaseUrl('not a url')).toThrow(/Invalid LLM/);
  });

  it('treats undefined as a no-op for the override', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      undefined
    );
    expect(svc.getConfiguredBaseUrlOverride()).toBeNull();
    expect(svc.getActiveBaseUrl()).toBe('http://localhost:1234');
  });

  it('treats null as a reset to the default', async () => {
    const svc = await import('./activeModelService.js');
    // First set a remote URL
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      'http://remote.example.com:1234'
    );
    expect(svc.getActiveBaseUrl()).toBe('http://remote.example.com:1234');
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);

    // Then reset
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      null
    );
    expect(svc.getConfiguredBaseUrlOverride()).toBeNull();
    expect(svc.getActiveBaseUrl()).toBe('http://localhost:1234');
    expect(svc.isRemoteLlmBaseUrl()).toBe(false);
  });

  it('treats a string as setting an explicit override', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      'http://10.0.0.1:1234'
    );
    expect(svc.getActiveBaseUrl()).toBe('http://10.0.0.1:1234');
    expect(svc.getConfiguredBaseUrlOverride()).toBe('http://10.0.0.1:1234');
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);
  });

  it('isRemoteLlmBaseUrl accepts an explicit candidate URL', async () => {
    const svc = await import('./activeModelService.js');
    // Currently default
    expect(svc.isRemoteLlmBaseUrl('http://localhost:1234')).toBe(false);
    expect(svc.isRemoteLlmBaseUrl('http://other:1234')).toBe(true);

    // After override (active is remote at 10.0.0.1)
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      'http://10.0.0.1:1234'
    );
    // Candidate is local default => not remote
    expect(svc.isRemoteLlmBaseUrl('http://localhost:1234')).toBe(false);
    // Candidate is the remote URL => remote
    expect(svc.isRemoteLlmBaseUrl('http://10.0.0.1:1234')).toBe(true);
    // No candidate => falls back to active (10.0.0.1) => remote
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);
  });

  it('setting the same base URL twice in a row is idempotent (no-op semantics)', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      'http://10.0.0.1:1234'
    );
    const afterFirst = svc.getActiveBaseUrl();
    expect(afterFirst).toBe('http://10.0.0.1:1234');
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);

    svc.setActiveModelAndContextAndParams(
      'llama3',
      null,
      0.7,
      0.9,
      1.1,
      null,
      null,
      'http://10.0.0.1:1234'
    );
    expect(svc.getActiveBaseUrl()).toBe(afterFirst);
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);
  });
});

describe('activeModelService — clearModelAndContext', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSettings = {
      llm_base_url: 'http://10.0.0.1:1234',
      llm_model_name: 'llama3:8b',
      llm_context_size: 8192,
      llm_temperature: 1.2,
      llm_top_p: 0.85,
      llm_repeat_penalty: 1.3,
      llm_num_gpu_layers: 24,
      llm_thinking_budget: 512,
    };
  });

  it('resets model name + context size to defaults', async () => {
    const svc = await import('./activeModelService.js');
    svc.clearModelAndContext();

    expect(svc.getActiveModel()).toBe('default');
    expect(svc.getConfiguredContextSize()).toBeNull();
  });

  it('preserves user sampling params (temp, topP, repeatPenalty, gpu layers, thinking)', async () => {
    const svc = await import('./activeModelService.js');
    svc.clearModelAndContext();

    expect(svc.getConfiguredTemperature()).toBe(1.2);
    expect(svc.getConfiguredTopP()).toBe(0.85);
    expect(svc.getConfiguredRepeatPenalty()).toBe(1.3);
    expect(svc.getConfiguredNumGpuLayers()).toBe(24);
    expect(svc.getConfiguredThinkingBudget()).toBe(512);
  });

  it('preserves the remote base URL override', async () => {
    const svc = await import('./activeModelService.js');
    svc.clearModelAndContext();

    expect(svc.getConfiguredBaseUrlOverride()).toBe('http://10.0.0.1:1234');
    expect(svc.isRemoteLlmBaseUrl()).toBe(true);
  });

  it('clears the in-memory VRAM estimate', async () => {
    const svc = await import('./activeModelService.js');
    svc.setActiveModelVramEstimateBytes(5_000_000_000);
    expect(svc.getActiveModelVramEstimateBytes()).toBe(5_000_000_000);

    svc.clearModelAndContext();
    expect(svc.getActiveModelVramEstimateBytes()).toBeNull();
  });

  it('is a no-op when model + context are already at defaults', async () => {
    mockSettings = {
      llm_base_url: 'http://10.0.0.1:1234',
      llm_model_name: 'default',
      llm_context_size: null,
      llm_temperature: 1.2,
      llm_top_p: 0.85,
      llm_repeat_penalty: 1.3,
      llm_num_gpu_layers: 24,
      llm_thinking_budget: 512,
    };
    const svc = await import('./activeModelService.js');
    const { appSettingsRepository } = await import('@therascript/data');
    vi.mocked(appSettingsRepository.updateSettings).mockClear();

    svc.clearModelAndContext();

    expect(appSettingsRepository.updateSettings).not.toHaveBeenCalled();
  });
});
