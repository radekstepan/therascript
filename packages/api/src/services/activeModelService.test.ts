import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@therascript/config', () => ({
  default: {
    llm: { modelPath: 'llama3' },
  },
}));

describe('activeModelService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns configured model initially and updates model + context size', async () => {
    const svc = await import('./activeModelService.js');
    expect(svc.getActiveModel()).toBe('llama3');
    expect(svc.getConfiguredContextSize()).toBeNull();

    svc.setActiveModelAndContext('mistral', 4096);
    expect(svc.getActiveModel()).toBe('mistral');
    expect(svc.getConfiguredContextSize()).toBe(4096);
  });

  it('rejects invalid model names and does not change state', async () => {
    const svc = await import('./activeModelService.js');
    const beforeModel = svc.getActiveModel();
    const beforeCtx = svc.getConfiguredContextSize();
    // invalid input: empty model name should be ignored
    svc.setActiveModelAndContext('' as any, 2048);
    expect(svc.getActiveModel()).toBe(beforeModel);
    expect(svc.getConfiguredContextSize()).toBe(beforeCtx);
  });
});

describe('activeModelService — numGpuLayers', () => {
  beforeEach(() => {
    vi.resetModules();
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
