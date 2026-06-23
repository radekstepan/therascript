// @vitest-environment jsdom
// packages/ui/src/components/Shared/LlmSettingsForm.test.tsx
//
// Tests for the "Context Size" input auto-fill behaviour in LlmSettingsForm.
//
// Background: when a model is loaded with a non-default context size and the
// user opens either "Configure AI Model" or "Analyze Multiple Sessions",
// the form's input must reflect the *saved* configured context size. Prior
// to the fix, an auto-suggest effect clobbered the saved value with a
// recommendation derived from the active transcript's token count.
//
// These tests pin the behaviour laid out in the bug report:
//   1. Loaded model + active transcript tokens  -> saved value preserved.
//   2. Loaded model + no transcript tokens      -> saved value preserved.
//   3. No loaded model + active transcript      -> recommendation auto-fills.
//   4. User picks a new (non-active) model      -> input resets, recommendation auto-fills.
//   5. User-typed value is not clobbered by a later recommendation pass.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';

import { LlmSettingsForm, type LlmSettingsState } from './LlmSettingsForm';
import type { LlmModelInfo, LlmStatus } from '../../types';

// --- Test fixtures -----------------------------------------------------
const MODEL_A: LlmModelInfo = {
  name: 'llama-3-8b',
  modified_at: new Date().toISOString(),
  size: 4_000_000_000,
  digest: 'sha256:model-a',
  details: {
    format: 'gguf',
    family: 'llama',
    families: null,
    parameter_size: '8B',
    quantization_level: 'Q4_K_M',
  },
  defaultContextSize: 8192,
  size_vram: 4_000_000_000,
  expires_at: null,
  architecture: null,
};

const MODEL_B: LlmModelInfo = {
  ...MODEL_A,
  name: 'qwen2.5-14b',
  defaultContextSize: 32768,
};

// --- Mock the model picker --------------------------------------------
// The real `LlmEndpointModelPicker` fires a `useQuery` and pushes the
// resolved list back into the form via `onModelsChange`. In a test that
// indirection is a timing nightmare (React Query microtasks + Radix
// layout effects), and it has nothing to do with the behaviour under
// test. Replace it with a stub that synchronously hands the form the
// fixture list so the form's `selectedModelDetails` resolves on the
// very first render.
vi.mock('./LlmEndpointModelPicker', () => ({
  LlmEndpointModelPicker: ({
    onModelsChange,
    selectedModel,
    onSelectedModelChange,
  }: {
    onModelsChange?: (models: LlmModelInfo[]) => void;
    selectedModel: string;
    onSelectedModelChange: (model: string) => void;
  }) => {
    React.useEffect(() => {
      onModelsChange?.([MODEL_A, MODEL_B]);
    }, [onModelsChange]);
    return (
      <div data-testid="llm-endpoint-model-picker">
        <span data-testid="picker-selected-model">{selectedModel}</span>
        <button
          type="button"
          onClick={() => onSelectedModelChange(MODEL_B.name)}
          data-testid="pick-model-b"
        >
          Pick model B
        </button>
      </div>
    );
  },
}));

// --- Mock the API module ----------------------------------------------
// The form calls into `api.ts` for GPU stats, VRAM estimates, and model
// unload. None of them are exercised by the context-size logic under
// test, but they will all fire on mount, so stub them with no-ops.
vi.mock('../../api/api', () => ({
  fetchGpuStats: vi.fn().mockResolvedValue({
    available: false,
    gpus: [],
    systemMemory: { totalMb: 0, usedMb: 0, freeMb: 0, percentUsed: 0 },
    summary: {
      gpuCount: 0,
      totalMemoryMb: 0,
      totalMemoryUsedMb: 0,
      isUnifiedMemory: false,
    },
  }),
  estimateModelVram: vi.fn().mockResolvedValue({
    model: 'mock',
    context_size: null,
    estimated_vram_bytes: null,
    estimated_ram_bytes: null,
    vram_per_token_bytes: null,
  }),
  unloadLlmModel: vi.fn().mockResolvedValue({ message: 'ok' }),
}));

// --- Helpers -----------------------------------------------------------
const baseState: LlmSettingsState = {
  selectedModel: MODEL_A.name,
  contextSizeInput: '',
  isRemote: false,
  remoteUrl: '',
  temperature: 0.7,
  topP: 0.9,
  repeatPenalty: 1.1,
  numGpuLayers: undefined,
  thinkingBudget: -1,
};

function makeLlmStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    activeModel: MODEL_A.name,
    modelChecked: MODEL_A.name,
    loaded: true,
    details: MODEL_A,
    configuredContextSize: 16384,
    configuredTemperature: 0.7,
    configuredTopP: 0.9,
    configuredRepeatPenalty: 1.1,
    configuredNumGpuLayers: null,
    configuredThinkingBudget: -1,
    activeBaseUrl: 'http://localhost:1234',
    defaultBaseUrl: 'http://localhost:1234',
    isRemoteBaseUrl: false,
    ...overrides,
  };
}

interface RenderOpts {
  state: LlmSettingsState;
  llmStatus: LlmStatus;
  activeTranscriptTokens?: number | null;
  isOpen?: boolean;
  onChange?: (updater: (prev: LlmSettingsState) => LlmSettingsState) => void;
}

function renderForm(opts: RenderOpts) {
  // The form calls `onChange` to push state updates up to the parent. If
  // we hand it a no-op, recommended-value effects that write to
  // `contextSizeInput` silently disappear, and tests that depend on
  // those writes fail with stale `''` values. Drive the state with a
  // real `useState` so the parent's view stays in sync.
  const Stateful: React.FC = () => {
    const [state, setState] = React.useState<LlmSettingsState>(opts.state);
    const handleChange = React.useCallback(
      (updater: (prev: LlmSettingsState) => LlmSettingsState) => {
        setState((prev) => {
          const next = updater(prev);
          opts.onChange?.(updater);
          return next;
        });
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );
    return (
      <LlmSettingsForm
        llmStatus={opts.llmStatus}
        activeTranscriptTokens={opts.activeTranscriptTokens ?? null}
        state={state}
        onChange={handleChange}
        isOpen={opts.isOpen ?? true}
      />
    );
  };

  // Fresh QueryClient per test so cache state never leaks across cases.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <Theme>
          <Stateful />
        </Theme>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

// Find the Context Size <input>. Radix's <Text> renders the label as a
// <div>, so the implicit <label> association doesn't expose a stable
// accessible name. Use the "Default (...)" placeholder that the
// component stamps on the input as a stable handle.
function getContextSizeInput(): HTMLInputElement {
  const input = screen.getByPlaceholderText(/Default/) as HTMLInputElement;
  expect(input.type).toBe('number');
  return input;
}

describe('LlmSettingsForm — Context Size auto-fill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the saved configured context size when a model is loaded and transcript tokens are present', () => {
    // Reproduces the reported bug: the parent seeds the form with the
    // saved `configuredContextSize` (16384). Before the fix, the
    // recommended-value effect would overwrite the input with a smaller
    // recommendation based on `activeTranscriptTokens`.
    const state: LlmSettingsState = {
      ...baseState,
      selectedModel: MODEL_A.name,
      contextSizeInput: '16384',
    };
    const llmStatus = makeLlmStatus({ configuredContextSize: 16384 });

    renderForm({ state, llmStatus, activeTranscriptTokens: 1500 });

    expect(getContextSizeInput().value).toBe('16384');
  });

  it('keeps the saved configured context size when a model is loaded and there are no transcript tokens', () => {
    // Same as above but with `activeTranscriptTokens = null` (e.g. a
    // session that's still being transcribed, or a session view that
    // doesn't pass a token count). The recommendation loop should never
    // fire, but the saved value must still surface.
    const state: LlmSettingsState = {
      ...baseState,
      selectedModel: MODEL_A.name,
      contextSizeInput: '16384',
    };
    const llmStatus = makeLlmStatus({ configuredContextSize: 16384 });

    renderForm({ state, llmStatus, activeTranscriptTokens: null });

    expect(getContextSizeInput().value).toBe('16384');
  });

  it('auto-fills with the recommended size when the input is empty and transcript tokens are present', () => {
    // No saved value to preserve -> the recommendation loop is allowed to
    // suggest a sensible default derived from `activeTranscriptTokens`.
    // With 1500 active tokens, the formula yields
    //   Math.ceil((1500 + 2048) / 256) * 256 = 4096
    // which is well under MODEL_A's defaultContextSize of 8192.
    const state: LlmSettingsState = {
      ...baseState,
      selectedModel: MODEL_A.name,
      contextSizeInput: '',
    };
    const llmStatus = makeLlmStatus({ configuredContextSize: null });

    renderForm({ state, llmStatus, activeTranscriptTokens: 1500 });

    expect(getContextSizeInput().value).toBe('4096');
  });

  it('resets the context size and re-suggests a recommendation when the user picks a non-active model', async () => {
    // The "new model" effect must clear `contextSizeInput` so the
    // recommendation loop can repopulate it for the new model. Otherwise
    // the old value would leak across model changes.
    const initialState: LlmSettingsState = {
      ...baseState,
      selectedModel: MODEL_A.name,
      contextSizeInput: '16384',
    };
    // Active model is `llama-3-8b`; the test will pick `qwen2.5-14b` to
    // trigger the reset branch. With 1500 active tokens, the recommendation
    // for the new model is also 4096 (capped at MODEL_B's 32768 max).
    const llmStatus = makeLlmStatus({
      activeModel: MODEL_A.name,
      modelChecked: MODEL_A.name,
      configuredContextSize: 16384,
    });
    const user = userEvent.setup();
    renderForm({
      state: initialState,
      llmStatus,
      activeTranscriptTokens: 1500,
    });

    // Sanity: the saved value is visible before the switch.
    expect(getContextSizeInput().value).toBe('16384');

    // Simulate the user picking model B via the mocked picker.
    await user.click(screen.getByTestId('pick-model-b'));

    // After the new-model reset, the input should briefly empty and then
    // the recommendation loop fills it with 4096.
    await waitFor(() => expect(getContextSizeInput().value).toBe('4096'));
  });
});

describe('LlmSettingsForm — user typing behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not overwrite a user-typed context size when transcript tokens change', async () => {
    // No model loaded -> the input is editable, which is the only
    // configuration where the user can actually type into it. The
    // recommended loop should still leave a typed value alone.
    let current: LlmSettingsState = {
      ...baseState,
      selectedModel: MODEL_A.name,
      contextSizeInput: '',
    };
    const onChange = (
      updater: (prev: LlmSettingsState) => LlmSettingsState
    ) => {
      current = updater(current);
    };
    const llmStatus = makeLlmStatus({
      loaded: false,
      activeModel: 'default',
      modelChecked: 'default',
      details: undefined,
      configuredContextSize: null,
    });

    const user = userEvent.setup();
    renderForm({
      state: current,
      llmStatus,
      activeTranscriptTokens: 1500,
      onChange,
    });

    // Recommendation loop fills the empty input with 4096.
    expect(getContextSizeInput().value).toBe('4096');

    // User clears the auto-filled value and types 8192.
    const input = getContextSizeInput();
    await user.clear(input);
    await user.type(input, '8192');
    expect(input.value).toBe('8192');
    expect(current.contextSizeInput).toBe('8192');
  });
});
