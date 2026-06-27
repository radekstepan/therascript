import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppSettingsRow } from '@therascript/domain';

type Row = AppSettingsRow;

const makeDbMock = () => {
  // Holds the single settings row (id = 1) in memory. The repository
  // contract is that exactly one row exists; the v18 migrator inserts
  // it on a fresh install, and `getSettings` falls back to a default
  // object if the row is missing.
  let row: Row | null = null;

  return {
    reset() {
      row = null;
    },
    seed(initial: Partial<Row>) {
      row = {
        id: 1,
        llm_base_url: null,
        llm_model_name: 'default',
        llm_context_size: null,
        llm_temperature: 0.7,
        llm_top_p: 0.9,
        llm_repeat_penalty: 1.1,
        llm_num_gpu_layers: null,
        llm_thinking_budget: null,
        llm_api_token: null,
        ...initial,
      };
    },
    setRow(next: Row) {
      row = next;
    },
    getRow(): Row | null {
      return row;
    },
  };
};

const dbMock = makeDbMock();

vi.mock('@therascript/db', () => ({
  get: vi.fn(() => dbMock.getRow()),
  run: vi.fn((_sql: string, ...params: unknown[]) => {
    // The repository calls `run` with the full ordered parameter
    // list (see appSettingsRepository.ts:35-51). Pull the params
    // into a Row and update the in-memory copy. The real DB would
    // persist the same shape.
    const [
      llm_base_url,
      llm_model_name,
      llm_context_size,
      llm_temperature,
      llm_top_p,
      llm_repeat_penalty,
      llm_num_gpu_layers,
      llm_thinking_budget,
      llm_api_token,
    ] = params as Row extends never
      ? never
      : [
          Row['llm_base_url'],
          Row['llm_model_name'],
          Row['llm_context_size'],
          Row['llm_temperature'],
          Row['llm_top_p'],
          Row['llm_repeat_penalty'],
          Row['llm_num_gpu_layers'],
          Row['llm_thinking_budget'],
          Row['llm_api_token'],
        ];
    dbMock.setRow({
      id: 1,
      llm_base_url,
      llm_model_name,
      llm_context_size,
      llm_temperature,
      llm_top_p,
      llm_repeat_penalty,
      llm_num_gpu_layers,
      llm_thinking_budget,
      llm_api_token,
    });
    return { changes: 1 };
  }),
}));

describe('appSettingsRepository', () => {
  beforeEach(() => {
    vi.resetModules();
    dbMock.reset();
  });

  it('getSettings returns the v19 default shape with llm_api_token: null when no row exists', async () => {
    // Regression guard: commit `31d8dc4` extended the default
    // returned from `getSettings` to include `llm_api_token: null`
    // (appSettingsRepository.ts:21). A future refactor that drops
    // the new field would silently break the `LlmStatus.hasRemoteApiToken`
    // mapping in the API layer (`packages/api/src/services/llamaCppService.ts`)
    // because it reads `settings.llm_api_token ?? null`.
    vi.doMock('@therascript/db', () => ({
      get: vi.fn(() => dbMock.getRow()),
      run: vi.fn(),
    }));
    const { appSettingsRepository } = await import(
      './appSettingsRepository.js'
    );

    const settings = appSettingsRepository.getSettings();
    expect(settings).toEqual({
      id: 1,
      llm_base_url: null,
      llm_model_name: 'default',
      llm_context_size: null,
      llm_temperature: 0.7,
      llm_top_p: 0.9,
      llm_repeat_penalty: 1.1,
      llm_num_gpu_layers: null,
      llm_thinking_budget: null,
      llm_api_token: null,
    });
  });

  it('getSettings returns the row from the DB when one exists, including llm_api_token', async () => {
    dbMock.seed({ llm_api_token: 'sk-existing-token-abc' });
    vi.doMock('@therascript/db', () => ({
      get: vi.fn(() => dbMock.getRow()),
      run: vi.fn(),
    }));
    const { appSettingsRepository } = await import(
      './appSettingsRepository.js'
    );

    const settings = appSettingsRepository.getSettings();
    expect(settings.llm_api_token).toBe('sk-existing-token-abc');
  });

  it('updateSettings round-trips a new llm_api_token through the DB layer', async () => {
    dbMock.seed({});
    vi.doMock('@therascript/db', () => ({
      get: vi.fn(() => dbMock.getRow()),
      run: vi.fn((_sql: string, ...params: unknown[]) => {
        // Mirror the same parameter mapping as the outer mock.
        const [
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        ] = params as [
          Row['llm_base_url'],
          Row['llm_model_name'],
          Row['llm_context_size'],
          Row['llm_temperature'],
          Row['llm_top_p'],
          Row['llm_repeat_penalty'],
          Row['llm_num_gpu_layers'],
          Row['llm_thinking_budget'],
          Row['llm_api_token'],
        ];
        dbMock.setRow({
          id: 1,
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        });
        return { changes: 1 };
      }),
    }));
    const { appSettingsRepository } = await import(
      './appSettingsRepository.js'
    );

    appSettingsRepository.updateSettings({
      llm_api_token: 'sk-rotated-xyz',
    });

    // After update, getSettings must return the new token. This
    // is the wire contract the /api/llm/api-token endpoint relies
    // on (packages/api/src/routes/llmRoutes.ts): the route writes
    // the token via updateSettings, the next /api/llm/status call
    // reads it via getSettings and reports `hasRemoteApiToken`.
    const settings = appSettingsRepository.getSettings();
    expect(settings.llm_api_token).toBe('sk-rotated-xyz');
  });

  it('updateSettings preserves all other fields when only llm_api_token is changed', async () => {
    dbMock.seed({
      llm_model_name: 'qwen2.5-7b-instruct',
      llm_base_url: 'http://10.0.0.1:1234',
      llm_context_size: 16384,
      llm_temperature: 0.3,
      llm_top_p: 0.95,
      llm_repeat_penalty: 1.05,
      llm_num_gpu_layers: 24,
      llm_thinking_budget: 1024,
    });
    vi.doMock('@therascript/db', () => ({
      get: vi.fn(() => dbMock.getRow()),
      run: vi.fn((_sql: string, ...params: unknown[]) => {
        const [
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        ] = params as [
          Row['llm_base_url'],
          Row['llm_model_name'],
          Row['llm_context_size'],
          Row['llm_temperature'],
          Row['llm_top_p'],
          Row['llm_repeat_penalty'],
          Row['llm_num_gpu_layers'],
          Row['llm_thinking_budget'],
          Row['llm_api_token'],
        ];
        dbMock.setRow({
          id: 1,
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        });
        return { changes: 1 };
      }),
    }));
    const { appSettingsRepository } = await import(
      './appSettingsRepository.js'
    );

    appSettingsRepository.updateSettings({ llm_api_token: 'new-token' });

    const settings = appSettingsRepository.getSettings();
    expect(settings.llm_model_name).toBe('qwen2.5-7b-instruct');
    expect(settings.llm_base_url).toBe('http://10.0.0.1:1234');
    expect(settings.llm_context_size).toBe(16384);
    expect(settings.llm_temperature).toBe(0.3);
    expect(settings.llm_top_p).toBe(0.95);
    expect(settings.llm_repeat_penalty).toBe(1.05);
    expect(settings.llm_num_gpu_layers).toBe(24);
    expect(settings.llm_thinking_budget).toBe(1024);
    expect(settings.llm_api_token).toBe('new-token');
  });

  it('updateSettings accepts null to clear the token (rotation-only contract)', async () => {
    // The /api/llm/api-token route never calls updateSettings with
    // llm_api_token: null — it only ever persists a non-empty value
    // or skips the write entirely (see llamaCppService.ts). The
    // repository, however, must round-trip `null` correctly so a
    // future clear-token feature can rely on it. This pins the
    // contract: passing null produces a stored null.
    dbMock.seed({ llm_api_token: 'sk-existing' });
    vi.doMock('@therascript/db', () => ({
      get: vi.fn(() => dbMock.getRow()),
      run: vi.fn((_sql: string, ...params: unknown[]) => {
        const [
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        ] = params as [
          Row['llm_base_url'],
          Row['llm_model_name'],
          Row['llm_context_size'],
          Row['llm_temperature'],
          Row['llm_top_p'],
          Row['llm_repeat_penalty'],
          Row['llm_num_gpu_layers'],
          Row['llm_thinking_budget'],
          Row['llm_api_token'],
        ];
        dbMock.setRow({
          id: 1,
          llm_base_url,
          llm_model_name,
          llm_context_size,
          llm_temperature,
          llm_top_p,
          llm_repeat_penalty,
          llm_num_gpu_layers,
          llm_thinking_budget,
          llm_api_token,
        });
        return { changes: 1 };
      }),
    }));
    const { appSettingsRepository } = await import(
      './appSettingsRepository.js'
    );

    appSettingsRepository.updateSettings({ llm_api_token: null });

    expect(appSettingsRepository.getSettings().llm_api_token).toBeNull();
  });
});
