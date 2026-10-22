// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Modals/SelectActiveModelModal.test.tsx
//
// Pins the modal side of the last-known-good remote URL contract. The
// picker is the single owner of `remoteBaseUrlAtom` writes (persisted
// only after a models request succeeds); the modal's `handleSave` must
// NEVER write the atom:
//
//   1. Saving a typed-but-untested URL must not replace the remembered
//      good value.
//   2. Saving in Local mode preserves (not clears) the remembered URL —
//      the preference is "last known good", not "last saved".
//   3. Cancel / Escape do not persist — they have no atom side effect.
//
// The modal only READS the atom: on open it pre-fills the remote URL
// field from the remembered value, unless the backend reports an
// active remote URL (live endpoint truth wins).
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, createStore, useAtomValue } from 'jotai';
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
//
// NOTE: because the picker is mocked, no model discovery ever runs in
// these tests — every typed URL is definitionally "untested", which is
// exactly what the no-save-write assertions need.
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
  /**
   * Optional pre-configured Jotai store. Pass a store with
   * `remoteBaseUrlAtom` pre-set to simulate an already-hydrated
   * session (avoids the mount-time localStorage rehydration race for
   * open-cycle pre-fill assertions).
   */
  store?: ReturnType<typeof createStore>;
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
  const store = opts.store ?? createStore();
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
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

  it('does not persist a typed-but-untested URL to the atom on Save', async () => {
    // The picker is mocked, so no discovery ever runs: the typed URL
    // is untested by construction. Saving it must not replace the
    // remembered good value — persistence belongs to successful
    // discovery, not to Save.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://good-host:1234'));

    renderModal({ llmStatus: makeLlmStatus() });

    const user = userEvent.setup();
    await clickRemoteSegment(user);

    const field = getRemoteUrlField();
    await user.type(field, 'http://untested-host:1234');

    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    // Give the save mutation a chance to settle (and any stray atom
    // write a chance to land), then assert nothing changed.
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe(
        '"http://good-host:1234"'
      )
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://good-host:1234')
    );
  });

  it('does not write an empty value on Save when nothing is remembered', async () => {
    // With no prior discovery, saving must not create a preference
    // entry at all — the atom stays at its default ''.
    renderModal({ llmStatus: makeLlmStatus() });

    const user = userEvent.setup();
    await clickRemoteSegment(user);
    await user.type(getRemoteUrlField(), 'http://untested-host:1234');

    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe('""')
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not persist when Save is blocked by an invalid URL', async () => {
    // An invalid URL short-circuits the save handler; the previously
    // remembered good value survives a bad attempt.
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

  it('preserves the remembered URL when saving in Local mode', async () => {
    // The user previously discovered a remote URL, then decides to go
    // back to local. Saving in Local mode sends baseUrl=null to the
    // backend but must NOT clear the last-known-good preference — the
    // next Local→Remote toggle still pre-fills it.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://good-host:1234'));

    renderModal({ llmStatus: makeLlmStatus() });
    const user = userEvent.setup();

    // The modal opens in Local mode (status says local). Confirm and
    // save directly.
    await clickLocalSegment(user);
    const saveButton = screen.getByRole('button', {
      name: /Save & Load Model/,
    });
    await user.click(saveButton);

    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe(
        '"http://good-host:1234"'
      )
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://good-host:1234')
    );
  });

  it('pre-fills the remote URL field from the remembered value on open', async () => {
    // Pre-hydrate the store (in-session state): the open-cycle
    // snapshot seeds the field from the atom, so toggling to Remote
    // shows the last known good URL.
    const store = createStore();
    store.set(remoteBaseUrlAtom, 'http://good-host:1234');

    renderModal({ llmStatus: makeLlmStatus(), store });
    const user = userEvent.setup();

    await clickRemoteSegment(user);
    expect(getRemoteUrlField().value).toBe('http://good-host:1234');
  });

  it('prefers the backend active remote URL over the remembered value on open', async () => {
    // When the backend reports a live remote endpoint, the form must
    // reflect that truth — not a stale (or merely unsaved) preference.
    const store = createStore();
    store.set(remoteBaseUrlAtom, 'http://remembered-host:1234');

    renderModal({
      llmStatus: makeLlmStatus({
        activeBaseUrl: 'http://live-remote:1234',
        isRemoteBaseUrl: true,
      }),
      store,
    });

    // The modal opens already in Remote mode; the field shows the live
    // endpoint without any toggle.
    expect(getRemoteUrlField().value).toBe('http://live-remote:1234');
  });
});
