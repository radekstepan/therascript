import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  default: {
    ollama: { model: 'llama3' },
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
