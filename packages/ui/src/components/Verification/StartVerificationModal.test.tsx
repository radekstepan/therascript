// @vitest-environment jsdom
// packages/ui/src/components/Verification/StartVerificationModal.test.tsx
//
// Regression coverage: the transcript picker in "Run Verification Audit"
// lists sessions newest-first (not alphabetical), with a deterministic
// tie-break and stable behaviour across the hide-verified toggle.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';
import type { SessionVerificationSummary } from '../../api/verification';
import type { LlmModelInfo, LlmStatus } from '../../types';
import {
  StartVerificationModal,
  sortVerificationSessionsNewestFirst,
} from './StartVerificationModal';

vi.mock('../Shared/LlmEndpointModelPicker', () => ({
  LlmEndpointModelPicker: ({
    selectedModel,
    onSelectedModelChange,
    onModelsChange,
  }: {
    selectedModel: string;
    onSelectedModelChange: (model: string) => void;
    onModelsChange?: (models: LlmModelInfo[]) => void;
  }) => {
    // Hand the form a fixture model list (the real picker resolves this
    // via a models query) so `selectedModelDetails` resolves, the
    // unknown-model guard stays quiet, and the Context Size input renders.
    React.useEffect(() => {
      const details = {
        format: 'gguf',
        family: 'test',
        families: null,
        parameter_size: '8B',
        quantization_level: 'Q4_K_M',
      };
      onModelsChange?.([
        {
          name: 'judge-model',
          modified_at: new Date().toISOString(),
          size: 4_000_000_000,
          digest: 'sha256:judge-model',
          details,
          defaultContextSize: 32768,
          size_vram: 4_000_000_000,
          expires_at: null,
          architecture: null,
        },
        {
          name: 'picked-model',
          modified_at: new Date().toISOString(),
          size: 4_000_000_000,
          digest: 'sha256:picked-model',
          details,
          defaultContextSize: 8192,
          size_vram: 4_000_000_000,
          expires_at: null,
          architecture: null,
        },
      ]);
    }, [onModelsChange]);
    return (
      <div data-testid="llm-endpoint-model-picker">
        <span data-testid="picker-selected-model">{selectedModel}</span>
        <button
          type="button"
          data-testid="pick-model"
          onClick={() => onSelectedModelChange('picked-model')}
        >
          Pick model
        </button>
      </div>
    );
  },
}));

const LLM_STATUS: LlmStatus = {
  activeModel: 'judge-model',
  modelChecked: 'judge-model',
  loaded: true,
  details: null,
  configuredContextSize: 32768,
  configuredTopP: 0.9,
  configuredRepeatPenalty: 1.1,
  configuredNumGpuLayers: null,
  configuredThinkingBudget: 1024,
  activeBaseUrl: 'http://localhost:1234',
  defaultBaseUrl: 'http://localhost:1234',
  isRemoteBaseUrl: false,
  hasRemoteApiToken: false,
};

vi.mock('../../api/api', () => ({
  createVerificationJob: vi.fn(),
  fetchLlmStatus: vi.fn(),
  setLlmApiToken: vi.fn().mockResolvedValue({ message: 'ok' }),
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

function makeSummary(
  overrides: Partial<SessionVerificationSummary> & { sessionId: number }
): SessionVerificationSummary {
  return {
    sessionName: `Session ${overrides.sessionId}`,
    clientName: 'Jane Doe',
    date: '2026-06-23T12:00:00.000Z',
    totalAiMessages: 4,
    verifiedAiMessages: 0,
    isFullyVerified: false,
    flaggedIssues: 0,
    averageAccuracy: null,
    ...overrides,
  };
}

// Dates deliberately run opposite to alphabetical name order: Alpha is
// oldest, Zulu is newest, so an alphabetical sort would fail this test.
const ORDER_FIXTURE: SessionVerificationSummary[] = [
  makeSummary({
    sessionId: 1,
    sessionName: 'Alpha Session',
    date: '2024-01-10T09:00:00.000Z',
  }),
  makeSummary({
    sessionId: 2,
    sessionName: 'Zulu Session',
    date: '2026-06-23T12:00:00.000Z',
  }),
  makeSummary({
    sessionId: 3,
    sessionName: 'Mike Session',
    date: '2025-03-01T12:00:00.000Z',
    isFullyVerified: true,
    verifiedAiMessages: 4,
  }),
];

function renderModal(sessionsSummary: SessionVerificationSummary[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <Theme>
          <StartVerificationModal
            isOpen
            onOpenChange={vi.fn()}
            sessionsSummary={sessionsSummary}
            initialScope="selected_sessions"
            onJobCreated={vi.fn()}
          />
        </Theme>
      </JotaiProvider>
    </QueryClientProvider>
  );
}

/** Session ids in current DOM order, derived from each row's label text. */
function visibleSessionIds(sessions: SessionVerificationSummary[]): number[] {
  const byName = new Map(sessions.map((s) => [s.sessionName, s.sessionId]));
  return screen.getAllByRole('checkbox').map((checkbox) => {
    const label = checkbox.closest('label');
    const text = label?.textContent ?? '';
    const match = [...byName.entries()].find(([name]) => text.includes(name));
    if (!match) throw new Error(`unmatched checkbox row: ${text}`);
    return match[1];
  });
}

function checkboxFor(sessionName: string): HTMLElement {
  const checkbox = screen
    .getAllByRole('checkbox')
    .find((el) => el.closest('label')?.textContent?.includes(sessionName));
  if (!checkbox) throw new Error(`no checkbox for ${sessionName}`);
  return checkbox;
}

function hideVerifiedSwitch(): HTMLElement {
  const label = screen
    .getByText('Hide already-verified transcripts')
    .closest('label');
  const toggle = label?.querySelector('[role="switch"]');
  if (!(toggle instanceof HTMLElement)) {
    throw new Error('hide-verified switch not found');
  }
  return toggle;
}

describe('sortVerificationSessionsNewestFirst', () => {
  it('orders dates newest first even when names sort the other way', () => {
    expect(
      sortVerificationSessionsNewestFirst(ORDER_FIXTURE).map((s) => s.sessionId)
    ).toEqual([2, 3, 1]);
  });

  it('breaks equal-date ties on descending sessionId', () => {
    const sessions = [
      makeSummary({ sessionId: 4, date: '2025-05-05T00:00:00.000Z' }),
      makeSummary({ sessionId: 5, date: '2025-05-05T00:00:00.000Z' }),
    ];
    expect(
      sortVerificationSessionsNewestFirst(sessions).map((s) => s.sessionId)
    ).toEqual([5, 4]);
  });

  it('puts missing/invalid dates last, still ordered by sessionId', () => {
    const sessions = [
      makeSummary({ sessionId: 6, date: 'not-a-date' }),
      makeSummary({ sessionId: 7, date: '' }),
      makeSummary({ sessionId: 8, date: '2025-01-01T00:00:00.000Z' }),
    ];
    expect(
      sortVerificationSessionsNewestFirst(sessions).map((s) => s.sessionId)
    ).toEqual([8, 7, 6]);
  });

  it('does not mutate the input array', () => {
    const before = ORDER_FIXTURE.map((s) => s.sessionId);
    const sorted = sortVerificationSessionsNewestFirst(ORDER_FIXTURE);
    expect(sorted).not.toBe(ORDER_FIXTURE);
    expect(ORDER_FIXTURE.map((s) => s.sessionId)).toEqual(before);
  });
});

describe('StartVerificationModal transcript ordering', () => {
  it('lists transcripts newest first with hide-verified on', async () => {
    const { fetchLlmStatus } = await import('../../api/api');
    vi.mocked(fetchLlmStatus).mockResolvedValue(LLM_STATUS);
    renderModal(ORDER_FIXTURE);

    await screen.findByText('Transcripts (0 selected)');
    // Session 3 is fully verified, so it is hidden; the rest stay
    // newest-first (Zulu 2026 before Alpha 2024).
    expect(visibleSessionIds(ORDER_FIXTURE)).toEqual([2, 1]);
  });

  it('keeps newest-first order and selections when the filter toggles', async () => {
    const { fetchLlmStatus } = await import('../../api/api');
    vi.mocked(fetchLlmStatus).mockResolvedValue(LLM_STATUS);
    renderModal(ORDER_FIXTURE);

    await screen.findByText('Transcripts (0 selected)');

    // Select a visible row, then reveal verified transcripts: order of
    // the remaining entries must not change and the verified row slots
    // into its date position (Mike 2025 between Zulu 2026, Alpha 2024).
    fireEvent.click(checkboxFor('Alpha Session'));
    await screen.findByText('Transcripts (1 selected)');

    fireEvent.click(hideVerifiedSwitch());
    await waitFor(() =>
      expect(visibleSessionIds(ORDER_FIXTURE)).toEqual([2, 3, 1])
    );
    expect(checkboxFor('Alpha Session').getAttribute('aria-checked')).toBe(
      'true'
    );

    // Select the verified row too, then re-hide: the selection must
    // survive even though its row disappears.
    fireEvent.click(checkboxFor('Mike Session'));
    await screen.findByText('Transcripts (2 selected)');

    fireEvent.click(hideVerifiedSwitch());
    await waitFor(() =>
      expect(visibleSessionIds(ORDER_FIXTURE)).toEqual([2, 1])
    );
    expect(checkboxFor('Alpha Session').getAttribute('aria-checked')).toBe(
      'true'
    );
    expect(await screen.findByText('Transcripts (2 selected)')).toBeTruthy();
  });

  it('renders invalid dates last without crashing', async () => {
    const { fetchLlmStatus } = await import('../../api/api');
    vi.mocked(fetchLlmStatus).mockResolvedValue(LLM_STATUS);
    const sessions = [
      makeSummary({
        sessionId: 11,
        sessionName: 'Broken Date Session',
        date: 'not-a-date',
      }),
      makeSummary({
        sessionId: 12,
        sessionName: 'Newest Valid Session',
        date: '2026-01-01T00:00:00.000Z',
      }),
    ];
    renderModal(sessions);

    await screen.findByText('Transcripts (0 selected)');
    expect(visibleSessionIds(sessions)).toEqual([12, 11]);
  });
});

describe('StartVerificationModal Judge LLM defaults', () => {
  // The Context Size input carries a "Default (...)" placeholder (same
  // handle the LlmSettingsForm specs use). The modal snapshot seeds it
  // with `configuredContextSize`, so its value marks snapshot settle.
  function getContextSizeInput(): HTMLInputElement {
    return screen.getByPlaceholderText(/Default/) as HTMLInputElement;
  }

  it('seeds temperature 0.3 and unrestricted thinking when nothing is configured', async () => {
    const { fetchLlmStatus } = await import('../../api/api');
    vi.mocked(fetchLlmStatus).mockResolvedValue({
      ...LLM_STATUS,
      configuredThinkingBudget: null,
    });
    renderModal(ORDER_FIXTURE);

    await screen.findByText('Transcripts (0 selected)');
    // Snapshot settled (context seeded from configuredContextSize) with
    // Judge sampling intact: 0.3, and -1 instead of the old forced 1024.
    await waitFor(() => expect(getContextSizeInput().value).toBe('32768'));
    expect(screen.getByText('0.3')).toBeTruthy();
    expect(screen.getByText('Unrestricted (-1)')).toBeTruthy();
  });

  it('preserves Judge sampling when a model is picked while activeModel is default', async () => {
    // Production regression: `app_settings.llm_model_name` was 'default'
    // while a real model was selected, so the form reset overwrote the
    // Judge temperature 0.3 with the chat default 0.7 (Jobs 2 and 3).
    const { fetchLlmStatus } = await import('../../api/api');
    vi.mocked(fetchLlmStatus).mockResolvedValue({
      ...LLM_STATUS,
      activeModel: 'default',
      modelChecked: 'default',
      configuredTopP: 0.95,
      configuredThinkingBudget: null,
    });
    renderModal(ORDER_FIXTURE);

    await screen.findByText('Transcripts (0 selected)');
    // Snapshot settled (topP seeded from the backend; nothing is selected
    // yet because the active model is 'default').
    await waitFor(() => expect(screen.getByText('0.95')).toBeTruthy());
    expect(screen.getByText('0.3')).toBeTruthy();
    expect(screen.getByText('Unrestricted (-1)')).toBeTruthy();

    // Picking a model resets the form to Judge sampling defaults.
    fireEvent.click(screen.getByTestId('pick-model'));
    await waitFor(() =>
      expect(screen.getByTestId('picker-selected-model').textContent).toBe(
        'picked-model'
      )
    );
    // The reset itself ran (topP back to the Judge default 0.9) and kept
    // the Judge temperature instead of the chat 0.7.
    await waitFor(() => expect(screen.getByText('0.90')).toBeTruthy());
    expect(screen.getByText('0.3')).toBeTruthy();
    expect(screen.getByText('Unrestricted (-1)')).toBeTruthy();
  });
});
