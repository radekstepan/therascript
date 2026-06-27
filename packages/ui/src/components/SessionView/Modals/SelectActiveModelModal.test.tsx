// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.test.tsx
//
// Pins the persistence contract of the remote LM Studio URL field on the
// modal side. The picker is read-only with respect to localStorage; the
// modal's `handleSave` is the single owner of `remoteBaseUrlAtom` and
// decides what the next session sees.
//
// Pre-fix bug:
//   1. The picker wrote every non-empty URL to the atom on every keystroke.
//   2. The empty-string case was gated out.
//   3. Result: clearing the field had no observable effect, and the next
//      Local→Remote toggle silently re-populated the input with the last
//      non-empty value — the "always resets to the original value" bug.
//
// Post-fix:
//   1. The picker is a pure controlled child — typing does not touch the atom.
//   2. `handleSave` writes the trimmed URL (or '' for the empty case) to
//      the atom exactly once per save, regardless of validity: an
//      invalid-URL save is rejected early and does not overwrite a good
//      stored value.
//   3. Cancel / Escape do not persist — they have no atom side effect.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { Theme } from '@radix-ui/themes';

import { SelectActiveModelModal } from './SelectActiveModelModal';
import { remoteBaseUrlAtom } from '../../../store';
import type { LlmStatus, LlmModelInfo } from '../../../types';

// --- Fixtures (hoisted) -------------------------------------------------
// vitest hoists `vi.mock` factories to the top of the file, so the
// factories cannot reference top-level `const` declarations by name.
// Use `vi.hoisted` to seed the fixtures that the mock factory needs;
// the rest of the file consumes them via the typed aliases declared
// below.
const { REMOTE_MODEL_FIXTURE, LOCAL_MODEL_FIXTURE } = vi.hoisted(() => {
  const remote = {
    name: 'remote-mock-model',
    modified_at: new Date().toISOString(),
    size: 4_000_000_000,
    digest: 'sha256:remote-mock',
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
  return {
    REMOTE_MODEL_FIXTURE: remote,
    LOCAL_MODEL_FIXTURE: { ...remote, name: 'local-mock-model' },
  };
});

// Re-export the hoisted fixtures under the names the rest of the file
// uses, with proper typing for non-mock call sites.
const REMOTE_MODEL: LlmModelInfo = REMOTE_MODEL_FIXTURE;
const LOCAL_MODEL: LlmModelInfo = LOCAL_MODEL_FIXTURE;

// Mock the picker so the test doesn't have to drive the Radix Select
// dropdown (jsdom-portal awkwardness) just to test the modal's
// persistence contract. The stub forwards every callback as a
// controlled prop, exposes the URL field + Remote/Local toggle, and
// surfaces the model selection through a simple <select> for tests
// that need to set the model. The picker's own persistence behaviour
// is covered by LlmEndpointModelPicker.test.tsx.
vi.mock('../../Shared/LlmEndpointModelPicker', async () => {
  const React = await import('react');
  return {
    LlmEndpointModelPicker: ({
      selectedModel,
      onSelectedModelChange,
      isRemote,
      setIsRemote,
      remoteUrl,
      setRemoteUrl,
      apiToken,
      setApiToken,
      hasRemoteApiToken,
      localBaseUrl,
      enabled,
    }: {
      selectedModel: string;
      onSelectedModelChange: (m: string) => void;
      isRemote: boolean;
      setIsRemote: (b: boolean) => void;
      remoteUrl: string;
      setRemoteUrl: (s: string) => void;
      apiToken: string;
      setApiToken: (s: string) => void;
      hasRemoteApiToken?: boolean;
      localBaseUrl: string;
      enabled: boolean;
    }) => {
      return React.createElement(
        'div',
        { 'data-testid': 'llm-endpoint-model-picker' },
        React.createElement(
          'div',
          { role: 'group' },
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': !isRemote,
              onClick: () => setIsRemote(false),
              'data-testid': 'picker-local',
            },
            'Local Machine'
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': isRemote,
              onClick: () => setIsRemote(true),
              'data-testid': 'picker-remote',
            },
            'Remote Machine'
          )
        ),
        isRemote &&
          React.createElement('input', {
            'data-testid': 'picker-remote-url',
            placeholder: 'http://192.168.1.100:1234',
            value: remoteUrl,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
              setRemoteUrl(e.target.value),
          }),
        React.createElement('input', {
          'data-testid': 'picker-model',
          value: selectedModel,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onSelectedModelChange(e.target.value),
        }),
        React.createElement(
          'span',
          { 'data-testid': 'picker-has-token' },
          hasRemoteApiToken ? 'set' : 'unset'
        )
      );
    },
  };
});

vi.mock('../../../api/api', () => ({
  setLlmModel: vi.fn().mockResolvedValue({
    activeModel: 'remote-mock-model',
    activeBaseUrl: 'http://new-host:1234',
    isRemoteBaseUrl: true,
  }),
  setLlmApiToken: vi.fn().mockResolvedValue({ hasRemoteApiToken: false }),
  fetchAvailableModels: vi.fn().mockResolvedValue({
    models: [REMOTE_MODEL_FIXTURE, LOCAL_MODEL_FIXTURE],
  }),
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

// --- Helpers ------------------------------------------------------------
const STORAGE_KEY = 'llm-remote-base-url';

function makeLlmStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    activeModel: 'default',
    modelChecked: 'default',
    loaded: false,
    details: null,
    configuredContextSize: null,
    configuredTemperature: 0.7,
    configuredTopP: 0.9,
    configuredRepeatPenalty: 1.1,
    configuredNumGpuLayers: null,
    configuredThinkingBudget: -1,
    activeBaseUrl: 'http://localhost:1234',
    defaultBaseUrl: 'http://localhost:1234',
    isRemoteBaseUrl: false,
    hasRemoteApiToken: false,
    ...overrides,
  };
}

interface RenderOpts {
  llmStatus: LlmStatus;
  initialModel?: string;
  onOpenChange?: (open: boolean) => void;
  onModelSuccessfullySet?: () => void;
}

function renderModal(opts: RenderOpts) {
  // Probe renders the atom value next to the dialog so the test can
  // assert what got persisted without poking into localStorage directly.
  const Probe: React.FC = () => {
    const value = useAtomValue(remoteBaseUrlAtom);
    return <span data-testid="atom-value">{JSON.stringify(value)}</span>;
  };

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
          <SelectActiveModelModal
            isOpen
            onOpenChange={opts.onOpenChange ?? vi.fn()}
            onModelSuccessfullySet={opts.onModelSuccessfullySet ?? vi.fn()}
            // Pre-seed the form with a model so the Save button is
            // enabled from the start. The model-pick UI is exercised
            // by the picker tests + e2e suite; this file focuses on
            // the modal's persistence contract.
            currentActiveModelName={opts.initialModel ?? REMOTE_MODEL.name}
            currentConfiguredContextSize={null}
            activeTranscriptTokens={null}
            llmStatus={opts.llmStatus}
          />
          <Probe />
        </Theme>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

function getRemoteUrlField(): HTMLInputElement {
  return screen.getByTestId('picker-remote-url') as HTMLInputElement;
}

function clickRemoteSegment(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByTestId('picker-remote'));
}

function clickLocalSegment(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByTestId('picker-local'));
}

describe('SelectActiveModelModal — remote URL persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('persists a typed remote URL to the atom on Save', async () => {
    renderModal({ llmStatus: makeLlmStatus() });

    const user = userEvent.setup();
    await clickRemoteSegment(user);

    const field = getRemoteUrlField();
    await user.type(field, 'http://new-host:1234');

    // The atom MUST still be '' before Save — typing is transient.
    expect(screen.getByTestId('atom-value').textContent).toBe('""');

    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    // After Save, the atom is the trimmed URL — this is the only
    // moment persistence happens.
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe(
        '"http://new-host:1234"'
      )
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://new-host:1234')
    );
  });

  it('does not persist when Save is blocked by an invalid URL', async () => {
    // An invalid URL short-circuits the save handler before the atom
    // write, so a good previously-saved value survives a bad attempt.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://good-host:1234'));

    renderModal({ llmStatus: makeLlmStatus() });
    const user = userEvent.setup();

    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    // Type something that fails `new URL()` so the modal's own
    // validation blocks the save.
    await user.type(field, 'not-a-url');

    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    // The atom is unchanged. A good previously-saved value is preserved.
    expect(screen.getByTestId('atom-value').textContent).toBe(
      '"http://good-host:1234"'
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://good-host:1234')
    );
  });

  it('persists the cleared state when the user saves in Local mode', async () => {
    // The user previously saved a remote URL, then decides to go
    // back to local. Saving in Local mode sends baseUrl=null to the
    // backend, and the modal must also clear the atom so the next
    // Local→Remote toggle does not re-surface the stale URL.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://stale-host:1234'));

    renderModal({ llmStatus: makeLlmStatus() });
    const user = userEvent.setup();

    // The modal opens in Local mode (status says local). Confirm and
    // save directly. The form is pre-seeded with REMOTE_MODEL.name,
    // but `llmStatus.isRemoteBaseUrl` is false, so the modal will
    // send `baseUrl = null` to the backend and write '' to the atom.
    await clickLocalSegment(user);
    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    // Saving in Local mode clears the atom — the "always remember
    // the latest" rule.
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe('""')
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(''));
  });
});
