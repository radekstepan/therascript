// @vitest-environment jsdom
// packages/ui/src/components/Shared/LlmEndpointModelPicker.test.tsx
//
// Pins the last-known-good persistence contract of the remote LM Studio
// URL field. The picker is the single owner of `remoteBaseUrlAtom` writes:
//
//   - A remote models request that succeeds with a valid models response
//     persists its (normalized) URL — saving a model is not required.
//     A successful empty list still counts as a successful connection.
//   - HTTP errors, malformed responses, and local-endpoint requests
//     never overwrite the remembered value.
//   - Typed values stay transient until their own request succeeds. A
//     delayed response for URL A persists A, never the live input
//     (which may already be URL B).
//   - The picker reads the atom on the Local→Remote boundary and
//     pre-fills an untouched empty field with the remembered URL.
//   - API tokens are never persisted alongside the URL.
//
// Modal Save/Submit handlers must NOT write the atom (an untested typed
// value must not replace a good one); that half of the contract is
// covered by SelectActiveModelModal.test.tsx.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { Theme } from '@radix-ui/themes';

import {
  LlmEndpointModelPicker,
  isValidModelsListResponse,
} from './LlmEndpointModelPicker';
import { remoteBaseUrlAtom } from '../../store';
import { fetchAvailableModels } from '../../api/api';
import type { AvailableModelsResponse, LlmModelInfo } from '../../types';

// --- Mocks --------------------------------------------------------------
// The picker fires a React-Query fetch on mount and after every debounced
// URL change. Tests control the network per case via the mocked
// `fetchAvailableModels` (deferred, resolved, or rejected).
vi.mock('../../api/api', () => ({
  fetchAvailableModels: vi.fn(),
}));

const fetchModelsMock = vi.mocked(fetchAvailableModels);

// --- Fixtures -----------------------------------------------------------
const MODEL_FIXTURE: LlmModelInfo = {
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

// --- Helpers ------------------------------------------------------------
const STORAGE_KEY = 'llm-remote-base-url';
const LOCAL_BASE_URL = 'http://localhost:1234';

// The picker debounces remote input by 500ms before querying; allow
// generous headroom for the debounce + React Query scheduling.
const FETCH_TIMEOUT = 5000;

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof LlmEndpointModelPicker>> = {}
) {
  // Minimal stand-in for a parent's controlled state. The picker is a
  // controlled child: it accepts `remoteUrl` / `setRemoteUrl` and
  // mirrors keystrokes into the parent's state.
  const Stateful: React.FC<
    Partial<React.ComponentProps<typeof LlmEndpointModelPicker>>
  > = (props) => {
    const [remoteUrl, setRemoteUrl] = React.useState(props.remoteUrl ?? '');
    const [isRemote, setIsRemote] = React.useState(props.isRemote ?? false);
    const [apiToken, setApiToken] = React.useState(props.apiToken ?? '');
    const [selectedModel, setSelectedModel] = React.useState(
      props.selectedModel ?? ''
    );
    return (
      <LlmEndpointModelPicker
        selectedModel={selectedModel}
        onSelectedModelChange={(m) => {
          setSelectedModel(m);
          props.onSelectedModelChange?.(m);
        }}
        isRemote={isRemote}
        setIsRemote={setIsRemote}
        remoteUrl={remoteUrl}
        setRemoteUrl={setRemoteUrl}
        apiToken={apiToken}
        setApiToken={setApiToken}
        hasRemoteApiToken={props.hasRemoteApiToken ?? false}
        localBaseUrl={props.localBaseUrl ?? LOCAL_BASE_URL}
        disabled={props.disabled ?? false}
        enabled={props.enabled ?? true}
        placeholder={props.placeholder}
        onModelsChange={props.onModelsChange}
      />
    );
  };

  // Probe renders the current atom value next to the picker. The atom
  // rehydrates from localStorage asynchronously; tests that need a
  // non-empty persisted value should `await waitFor` on the probe
  // before interacting with the picker.
  const AtomValueProbe: React.FC = () => {
    const value = useAtomValue(remoteBaseUrlAtom);
    return <span data-testid="atom-value">{JSON.stringify(value)}</span>;
  };

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <Theme>
          <Stateful {...overrides} />
          <AtomValueProbe />
        </Theme>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

function getRemoteUrlField(): HTMLInputElement {
  return screen.getByPlaceholderText(
    'http://192.168.1.100:1234'
  ) as HTMLInputElement;
}

function getAtomProbeText(): string | null {
  return screen.getByTestId('atom-value').textContent;
}

async function waitForAtomValue(expectedJson: string) {
  await waitFor(() => expect(getAtomProbeText()).toBe(expectedJson), {
    timeout: FETCH_TIMEOUT,
  });
}

function clickRemoteSegment(user: ReturnType<typeof userEvent.setup>) {
  // Radix Themes' SegmentedControl renders the segment label twice in
  // the DOM (active + inactive state) so `getByText` finds two matches
  // and fails. The button itself is a `radio` role; query by role +
  // accessible name to get exactly one element.
  return user.click(screen.getByRole('radio', { name: 'Remote Machine' }));
}

interface DeferredFetch {
  url: string;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/**
 * Routes every `fetchAvailableModels` call into a manually-settled
 * deferred, so tests can hold a request in flight (race coverage) or
 * resolve/reject on demand. Returns the live call log.
 */
function setupDeferredFetch(): DeferredFetch[] {
  const calls: DeferredFetch[] = [];
  fetchModelsMock.mockImplementation((baseUrl?: string | null) => {
    // Cast: tests deliberately settle with malformed payloads (and
    // rejections) that the typed signature cannot express.
    return new Promise((resolve, reject) => {
      calls.push({
        url: baseUrl ?? '',
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    }) as Promise<AvailableModelsResponse>;
  });
  return calls;
}

async function waitForFetchUrl(
  calls: DeferredFetch[],
  url: string
): Promise<DeferredFetch> {
  await waitFor(
    () => {
      expect(calls.some((c) => c.url === url)).toBe(true);
    },
    { timeout: FETCH_TIMEOUT }
  );
  const found = calls.find((c) => c.url === url);
  if (!found) throw new Error(`No fetch recorded for ${url}`);
  return found;
}

describe('isValidModelsListResponse', () => {
  it('accepts a populated models list', () => {
    expect(isValidModelsListResponse({ models: [MODEL_FIXTURE] })).toBe(true);
  });

  it('accepts an empty models list (successful connection)', () => {
    expect(isValidModelsListResponse({ models: [] })).toBe(true);
  });

  it.each([
    ['missing models key', {}],
    ['null payload', null],
    ['undefined payload', undefined],
    ['string payload', 'not-an-object'],
    ['non-array models (string)', { models: 'nope' }],
    ['non-array models (null)', { models: null }],
    ['non-array models (object)', { models: { name: 'x' } }],
  ])('rejects %s', (_label, payload) => {
    expect(isValidModelsListResponse(payload)).toBe(false);
  });
});

describe('LlmEndpointModelPicker — last-known-good persistence', () => {
  beforeEach(() => {
    // Jotai's atomWithStorage rehydrates from localStorage on mount.
    // Each test starts from a clean slate so a value leaked from a
    // previous test can't pre-fill the field or pollute assertions.
    localStorage.removeItem(STORAGE_KEY);
    vi.clearAllMocks();
    // Default network: instant success with an empty catalog. Tests
    // that need failure/race control install their own implementation.
    fetchModelsMock.mockResolvedValue({ models: [] });
  });

  it('persists the normalized URL after a successful discovery (no save required)', async () => {
    fetchModelsMock.mockResolvedValue({ models: [MODEL_FIXTURE] });
    renderPicker();
    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    await user.type(field, '  http://new-host:1234  ');

    // The debounced query succeeds → the trimmed URL is remembered in
    // both the atom and localStorage, without any Save click.
    await waitForAtomValue('"http://new-host:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://new-host:1234')
    );
  });

  it('keeps typed values transient until their own request succeeds', async () => {
    const calls = setupDeferredFetch();
    renderPicker();
    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    await user.type(field, 'http://new-host:1234');

    // Immediately after typing — before the debounce fires — nothing
    // may be persisted.
    expect(fetchModelsMock).not.toHaveBeenCalledWith('http://new-host:1234');
    expect(getAtomProbeText()).toBe('""');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // The query fires after the debounce; while it is in flight the
    // typed value is still transient.
    const pending = await waitForFetchUrl(calls, 'http://new-host:1234');
    expect(getAtomProbeText()).toBe('""');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Only the successful response persists it.
    pending.resolve({ models: [MODEL_FIXTURE] });
    await waitForAtomValue('"http://new-host:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://new-host:1234')
    );
  });

  it('persists a successful empty models list (empty is still success)', async () => {
    // Seed a previous good URL so the test proves the empty-list
    // success overwrites it (connection succeeded), rather than
    // merely filling an empty slot.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify('http://previous-good:1234')
    );
    fetchModelsMock.mockResolvedValue({ models: [] });
    renderPicker();
    await waitForAtomValue('"http://previous-good:1234"');

    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    await user.clear(field);
    await user.type(field, 'http://empty-catalog:1234');

    await waitForAtomValue('"http://empty-catalog:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://empty-catalog:1234')
    );
    // The empty-catalog message proves the success path rendered.
    expect(
      screen.getByText('No models found at http://empty-catalog:1234.')
    ).toBeTruthy();
  });

  it('does not overwrite the remembered URL when discovery fails', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://good-host:1234'));
    fetchModelsMock.mockRejectedValue(new Error('ECONNREFUSED'));
    renderPicker();
    await waitForAtomValue('"http://good-host:1234"');

    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    await user.clear(field);
    await user.type(field, 'http://unreachable-host:1234');

    // Wait until the failing request has actually run, then assert the
    // previous good value survived in both layers.
    await waitFor(
      () => {
        expect(fetchModelsMock).toHaveBeenCalledWith(
          'http://unreachable-host:1234'
        );
      },
      { timeout: FETCH_TIMEOUT }
    );
    await waitFor(
      () => {
        expect(
          screen.queryByText(/Could not reach the remote LLM server/)
        ).toBeTruthy();
      },
      { timeout: FETCH_TIMEOUT }
    );
    expect(getAtomProbeText()).toBe('"http://good-host:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://good-host:1234')
    );
  });

  it.each([
    ['missing models key', {}],
    ['null models', { models: null }],
    ['non-array models', { models: 'not-a-list' }],
    ['null payload', null],
  ])(
    'does not overwrite the remembered URL on malformed response (%s)',
    async (_label, payload) => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify('http://good-host:1234')
      );
      fetchModelsMock.mockResolvedValue(payload as never);
      renderPicker();
      await waitForAtomValue('"http://good-host:1234"');

      const user = userEvent.setup();
      await clickRemoteSegment(user);
      const field = getRemoteUrlField();
      await user.clear(field);
      await user.type(field, 'http://weird-host:1234');

      // The request "succeeds" at HTTP level but carries no usable
      // catalog — the remembered value must survive.
      await waitFor(
        () => {
          expect(fetchModelsMock).toHaveBeenCalledWith(
            'http://weird-host:1234'
          );
        },
        { timeout: FETCH_TIMEOUT }
      );
      // Give the queryFn's post-resolution persistence a chance to run
      // (wrongly) before asserting it didn't.
      await new Promise((r) => setTimeout(r, 100));
      expect(getAtomProbeText()).toBe('"http://good-host:1234"');
      expect(localStorage.getItem(STORAGE_KEY)).toBe(
        JSON.stringify('http://good-host:1234')
      );
    }
  );

  it('ignores local-endpoint requests for the remembered URL', async () => {
    // Mount in Local mode: the local query succeeds, but local
    // endpoints must never touch the remote preference.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://good-host:1234'));
    fetchModelsMock.mockResolvedValue({ models: [MODEL_FIXTURE] });
    renderPicker();
    await waitForAtomValue('"http://good-host:1234"');

    await waitFor(
      () => {
        expect(fetchModelsMock).toHaveBeenCalledWith(LOCAL_BASE_URL);
      },
      { timeout: FETCH_TIMEOUT }
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(getAtomProbeText()).toBe('"http://good-host:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://good-host:1234')
    );
  });

  it('never persists the API token alongside the URL', async () => {
    const TOKEN = 'secret-token-xyz-123';
    fetchModelsMock.mockResolvedValue({ models: [MODEL_FIXTURE] });
    renderPicker();
    const user = userEvent.setup();
    await clickRemoteSegment(user);
    await user.type(getRemoteUrlField(), 'http://token-host:1234');
    const tokenField = screen.getByPlaceholderText(
      'Enter API token (optional)'
    ) as HTMLInputElement;
    await user.type(tokenField, TOKEN);

    await waitForAtomValue('"http://token-host:1234"');

    // The stored preference is exactly the URL — and no localStorage
    // entry anywhere may contain the token bytes.
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://token-host:1234')
    );
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      expect(key).toBeTruthy();
      expect(localStorage.getItem(key!) ?? '').not.toContain(TOKEN);
    }
  });

  it('persists the queried URL on a delayed response, not the current input (race)', async () => {
    const calls = setupDeferredFetch();
    // Mount already in remote mode so both requests are observable.
    renderPicker({ isRemote: true, remoteUrl: '' });
    const user = userEvent.setup();
    const field = getRemoteUrlField();

    // Request A goes out and stays in flight…
    await user.type(field, 'http://host-a:1234');
    const requestA = await waitForFetchUrl(calls, 'http://host-a:1234');

    // …then the user moves on to URL B, whose request also goes out.
    await user.clear(field);
    await user.type(field, 'http://host-b:1234');
    const requestB = await waitForFetchUrl(calls, 'http://host-b:1234');

    // A's delayed success persists A — the URL that was actually
    // queried — and must not save the live input B.
    requestA.resolve({ models: [MODEL_FIXTURE] });
    await waitForAtomValue('"http://host-a:1234"');

    // B's success then supersedes it, as the latest discovery.
    requestB.resolve({ models: [MODEL_FIXTURE] });
    await waitForAtomValue('"http://host-b:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://host-b:1234')
    );
  });

  it('survives a remount and prefills another picker (cross-modal + reload)', async () => {
    fetchModelsMock.mockResolvedValue({ models: [MODEL_FIXTURE] });
    const first = renderPicker();
    const user = userEvent.setup();
    await clickRemoteSegment(user);
    await user.type(getRemoteUrlField(), 'http://discovered:1234');
    await waitForAtomValue('"http://discovered:1234"');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify('http://discovered:1234')
    );

    // Simulate modal close + reopen elsewhere (fresh providers, same
    // localStorage — equivalent to a browser reload for this atom).
    first.unmount();
    renderPicker();
    await waitForAtomValue('"http://discovered:1234"');

    const user2 = userEvent.setup();
    await clickRemoteSegment(user2);
    expect(getRemoteUrlField().value).toBe('http://discovered:1234');
  });
});

describe('LlmEndpointModelPicker — remote URL pre-fill', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.clearAllMocks();
    fetchModelsMock.mockResolvedValue({ models: [] });
  });

  it('pre-fills the field from the atom on a Local→Remote toggle', async () => {
    // Simulate a previous successful discovery by writing a URL to
    // localStorage (Jotai's atomWithStorage rehydrates on mount).
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://saved-host:1234'));

    renderPicker();
    // The atom rehydrates asynchronously. Wait for the probe to surface
    // the seeded value before driving the toggle — otherwise the test
    // races the rehydration and the field ends up empty.
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe(
        '"http://saved-host:1234"'
      )
    );

    const user = userEvent.setup();
    // The field is hidden while Local is selected; toggle to Remote.
    await clickRemoteSegment(user);
    // The URL field should be pre-filled from the atom.
    expect(getRemoteUrlField().value).toBe('http://saved-host:1234');
  });

  it('keeps the field empty when toggling Local→Remote with no saved URL', async () => {
    // Regression guard: with no prior discovery, toggling to Remote
    // should not invent a value.
    localStorage.removeItem(STORAGE_KEY);

    renderPicker();
    // Confirm the atom is at its default '' before clicking.
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe('""')
    );

    const user = userEvent.setup();
    await clickRemoteSegment(user);
    expect(getRemoteUrlField().value).toBe('');
  });

  it('keeps a cleared field empty across a Local→Remote round trip without saving', async () => {
    // Mirrors e2e remote-llm-url-persistence test 2: with a previously
    // remembered URL, clearing the field and toggling Local→Remote must
    // not silently resurrect the remembered value. The explicit Clear
    // wins because manual edits mark the field touched — while the
    // atom itself keeps the last known good value.
    localStorage.setItem(STORAGE_KEY, JSON.stringify('http://saved-host:1234'));

    renderPicker();
    await waitFor(() =>
      expect(screen.getByTestId('atom-value').textContent).toBe(
        '"http://saved-host:1234"'
      )
    );

    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    expect(field.value).toBe('http://saved-host:1234');

    // Explicit clear (manual edit), then a Local→Remote round trip.
    await user.clear(field);
    expect(field.value).toBe('');
    await user.click(screen.getByRole('radio', { name: 'Local Machine' }));
    await clickRemoteSegment(user);

    expect(getRemoteUrlField().value).toBe('');
    // The atom was never cleared — clearing is transient.
    expect(screen.getByTestId('atom-value').textContent).toBe(
      '"http://saved-host:1234"'
    );
  });
});

describe('LlmEndpointModelPicker — dialog-visibility gating (Task 6)', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    vi.clearAllMocks();
    fetchModelsMock.mockResolvedValue({ models: [] });
  });

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  function renderHarness(ui: React.ReactElement) {
    // NOTE: no `refetchOnWindowFocus` override — TanStack's default
    // (`true`) applies, so the focus steps below genuinely exercise
    // the focus-refetch path (the app's global default is `false`,
    // but discovery must stay silent regardless of the default).
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <JotaiProvider>
          <Theme>{ui}</Theme>
        </JotaiProvider>
      </QueryClientProvider>
    );
  }

  /** TanStack v5 refetches on `visibilitychange`, not on `focus`. */
  function fireWindowRefocus() {
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
  }

  it('does not fetch while disabled, and starts discovery when enabled', async () => {
    // Remote mode with a valid URL: the picker WOULD fetch immediately
    // if it were enabled, so sustained silence proves the gate.
    const VisibilityHarness: React.FC = () => {
      const [enabled, setEnabled] = React.useState(false);
      const [remoteUrl, setRemoteUrl] = React.useState('http://remote:1234');
      return (
        <>
          <LlmEndpointModelPicker
            selectedModel=""
            onSelectedModelChange={() => {}}
            isRemote
            setIsRemote={() => {}}
            remoteUrl={remoteUrl}
            setRemoteUrl={setRemoteUrl}
            apiToken=""
            setApiToken={() => {}}
            localBaseUrl={LOCAL_BASE_URL}
            enabled={enabled}
          />
          <button onClick={() => setEnabled(true)}>Enable discovery</button>
        </>
      );
    };
    renderHarness(<VisibilityHarness />);

    // Past the 500ms debounce and across a window refocus: zero
    // model-list requests from the hidden control.
    await act(async () => {
      await sleep(800);
    });
    fireWindowRefocus();
    await act(async () => {
      await sleep(300);
    });
    expect(fetchModelsMock).not.toHaveBeenCalled();

    // Enabling (dialog opened) starts discovery for the current URL.
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Enable discovery' }));
    await waitFor(
      () => {
        expect(fetchModelsMock).toHaveBeenCalledWith('http://remote:1234');
      },
      { timeout: FETCH_TIMEOUT }
    );
  });

  it('does not refetch on window focus while enabled', async () => {
    renderPicker();
    await waitFor(
      () => {
        expect(fetchModelsMock).toHaveBeenCalledWith(LOCAL_BASE_URL);
      },
      { timeout: FETCH_TIMEOUT }
    );
    const callsAfterMount = fetchModelsMock.mock.calls.length;

    // Refocusing the window must not start discovery: the only fetch
    // triggers are mount (dialog open), endpoint/URL change, and the
    // explicit error-Retry.
    fireWindowRefocus();
    await act(async () => {
      await sleep(300);
    });
    expect(fetchModelsMock.mock.calls.length).toBe(callsAfterMount);
  });
});
