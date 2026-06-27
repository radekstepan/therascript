// @vitest-environment jsdom
// packages/ui/src/components/Shared/LlmEndpointModelPicker.test.tsx
//
// Pins the persistence contract of the remote LM Studio URL field:
//
//   - The picker does NOT write to `remoteBaseUrlAtom` on typing. The
//     atom is owned by the modal's Save handler so Cancel / Escape
//     discard unsaved typing. Pre-fix: `handleRemoteUrlChange` wrote
//     every non-empty value to localStorage on every keystroke, but the
//     empty-string case was gated out, so clearing the field had no
//     effect — the stale value re-surfaced on the next Local→Remote
//     toggle.
//
//   - The picker reads the atom on the Local→Remote boundary and
//     pre-fills the field with the last saved URL (or leaves it empty
//     if the user has already typed something in the same session).
//
// These tests cover the picker in isolation. The save-side writes
// (`setPersistedRemoteUrl` in the modal's `handleSave`/`handleSubmit`)
// are covered by SelectActiveModelModal.test.tsx.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, useAtomValue } from 'jotai';
import { Theme } from '@radix-ui/themes';

import { LlmEndpointModelPicker } from './LlmEndpointModelPicker';
import { remoteBaseUrlAtom } from '../../store';

// --- Mocks --------------------------------------------------------------
// The picker fires a React-Query fetch on mount. The persistence contract
// doesn't depend on the network — stub the API so the component renders
// without a network and doesn't spam the test console.
vi.mock('../../api/api', () => ({
  fetchAvailableModels: vi.fn().mockResolvedValue({ models: [] }),
}));

// --- Helpers ------------------------------------------------------------
const STORAGE_KEY = 'llm-remote-base-url';

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
        localBaseUrl={props.localBaseUrl ?? 'http://localhost:1234'}
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

function clickRemoteSegment(user: ReturnType<typeof userEvent.setup>) {
  // Radix Themes' SegmentedControl renders the segment label twice in
  // the DOM (active + inactive state) so `getByText` finds two matches
  // and fails. The button itself is a `radio` role; query by role +
  // accessible name to get exactly one element.
  return user.click(screen.getByRole('radio', { name: 'Remote Machine' }));
}

describe('LlmEndpointModelPicker — remote URL persistence', () => {
  beforeEach(() => {
    // Jotai's atomWithStorage reads localStorage synchronously on mount.
    // Each test starts from a clean slate so a value leaked from a
    // previous test can't pre-fill the field.
    localStorage.removeItem(STORAGE_KEY);
  });

  it('does not write to remoteBaseUrlAtom on typing (typing is transient)', async () => {
    // A small probe that mirrors the atom into a test-observable span.
    // The picker's `handleRemoteUrlChange` must not call the atom's
    // setter; if it does, this span updates.
    const AtomValueProbe: React.FC = () => {
      const value = useAtomValue(remoteBaseUrlAtom);
      return <span data-testid="atom-value">{JSON.stringify(value)}</span>;
    };

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
      },
    });
    const Stateful: React.FC = () => {
      const [remoteUrl, setRemoteUrl] = React.useState('');
      const [isRemote, setIsRemote] = React.useState(false);
      const [apiToken, setApiToken] = React.useState('');
      const [selectedModel, setSelectedModel] = React.useState('');
      return (
        <QueryClientProvider client={queryClient}>
          <JotaiProvider>
            <Theme>
              <LlmEndpointModelPicker
                selectedModel={selectedModel}
                onSelectedModelChange={setSelectedModel}
                isRemote={isRemote}
                setIsRemote={setIsRemote}
                remoteUrl={remoteUrl}
                setRemoteUrl={setRemoteUrl}
                apiToken={apiToken}
                setApiToken={setApiToken}
                hasRemoteApiToken={false}
                localBaseUrl="http://localhost:1234"
                enabled
              />
              <AtomValueProbe />
            </Theme>
          </JotaiProvider>
        </QueryClientProvider>
      );
    };

    render(<Stateful />);

    // Atom is the default '' (nothing has been saved).
    expect(screen.getByTestId('atom-value').textContent).toBe('""');

    const user = userEvent.setup();
    // Toggle to Remote so the URL field renders.
    await clickRemoteSegment(user);
    // Type a URL.
    const field = getRemoteUrlField();
    await user.type(field, 'http://new-host:1234');

    // The atom MUST still be '' — persistence is owned by the modal's
    // Save handler, not by the picker.
    expect(screen.getByTestId('atom-value').textContent).toBe('""');
  });

  it('does not write to remoteBaseUrlAtom when the field is cleared', async () => {
    // Mirror of the typing case for the empty-string path. Pre-fix, the
    // empty case was explicitly gated out of the write — so the atom
    // would never be updated to ''. Post-fix, the atom is never
    // touched by the picker at all (see above), so the contract for
    // the empty case is "no change" rather than "explicit clear".
    renderPicker();
    const user = userEvent.setup();
    await clickRemoteSegment(user);
    const field = getRemoteUrlField();
    await user.type(field, 'http://new-host:1234');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('pre-fills the field from the atom on a Local→Remote toggle', async () => {
    // Simulate a previous Save by writing a URL to localStorage
    // (Jotai's atomWithStorage rehydrates on mount).
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
    // Regression guard for the "always remember the latest" contract:
    // with no prior save, toggling to Remote should not invent a value.
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
});
