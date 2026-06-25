// @vitest-environment jsdom
// packages/ui/src/components/User/GpuStatusModal.test.tsx
//
// Tests for the "Active Model Resources" card in the System Resources modal.
//
// Background: the modal receives `llmStatus` from React Query and renders
// different model cards depending on whether the LLM is local or remote.
// Prior to the remote-aware fix, the modal would always try to display
// VRAM/RAM figures from `details.size_vram` / `details.size`, which is
// misleading for a remote LLM because those numbers describe the remote
// server, not the local machine.
//
// These tests pin the behaviour:
//   1. Local + loaded + details           -> ActiveModelCard (VRAM/RAM)
//   2. Local + loaded + no details        -> no model card
//   3. Remote + loaded + details          -> RemoteModelCard (no VRAM/RAM)
//   4. Remote + loaded + no details       -> RemoteModelCard still shows
//   5. Remote + default == active URL     -> "Local default" row hidden
//   6. Remote + default != active URL     -> "Local default" row shown
//   7. Unloaded                           -> no model card
//   8. Remote + GPU stats present         -> local GPU sections still render
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Theme } from '@radix-ui/themes';

import { GpuStatusModal } from './GpuStatusModal';
import type { GpuStats, LlmModelInfo, LlmStatus } from '../../types';

// --- Test fixtures ----------------------------------------------------
const MODEL: LlmModelInfo = {
  name: 'qwen2.5-7b-instruct',
  modified_at: new Date().toISOString(),
  size: 4_500_000_000,
  digest: 'sha256:qwen-test',
  details: {
    format: 'gguf',
    family: 'qwen2',
    families: null,
    parameter_size: '7B',
    quantization_level: 'Q4_K_M',
  },
  defaultContextSize: 32768,
  size_vram: 4_500_000_000,
  expires_at: null,
  architecture: null,
};

const LOCAL_URL = 'http://localhost:1234';
const REMOTE_URL = 'http://10.0.0.5:1234';

function makeLlmStatus(overrides: Partial<LlmStatus> = {}): LlmStatus {
  return {
    activeModel: MODEL.name,
    modelChecked: MODEL.name,
    loaded: true,
    details: MODEL,
    configuredContextSize: 8192,
    configuredTemperature: 0.7,
    configuredTopP: 0.9,
    configuredRepeatPenalty: 1.1,
    configuredNumGpuLayers: null,
    configuredThinkingBudget: -1,
    activeBaseUrl: LOCAL_URL,
    defaultBaseUrl: LOCAL_URL,
    isRemoteBaseUrl: false,
    ...overrides,
  };
}

function makeGpuStats(overrides: Partial<GpuStats> = {}): GpuStats {
  return {
    available: true,
    driverVersion: '550.54',
    cudaVersion: '12.4',
    gpus: [
      {
        id: 0,
        name: 'NVIDIA GeForce RTX 4090',
        fanSpeedPercent: 30,
        performanceState: 'P0',
        memory: { totalMb: 24576, usedMb: 4096, freeMb: 20480 },
        utilization: { gpuPercent: 12, memoryPercent: 16 },
        temperature: { currentCelsius: 45 },
        power: { drawWatts: 35, limitWatts: 450 },
        processes: [],
        isUnifiedMemory: false,
      },
    ],
    summary: {
      gpuCount: 1,
      totalMemoryMb: 24576,
      totalMemoryUsedMb: 4096,
      avgGpuUtilizationPercent: 12,
      avgMemoryUtilizationPercent: 16,
      avgTemperatureCelsius: 45,
      totalPowerDrawWatts: 35,
      totalPowerLimitWatts: 450,
      isUnifiedMemory: false,
    },
    executionProvider: 'gpu',
    systemMemory: {
      totalMb: 32768,
      usedMb: 8192,
      freeMb: 24576,
      percentUsed: 25,
    },
    ...overrides,
  };
}

interface RenderOpts {
  llmStatus?: LlmStatus;
  gpuStats?: GpuStats;
  isLoading?: boolean;
  error?: Error | null;
}

function renderModal(opts: RenderOpts = {}) {
  return render(
    <Theme>
      <GpuStatusModal
        isOpen
        onOpenChange={() => {}}
        gpuStats={opts.gpuStats ?? makeGpuStats()}
        llmStatus={opts.llmStatus ?? makeLlmStatus()}
        isLoading={opts.isLoading ?? false}
        error={opts.error ?? null}
      />
    </Theme>
  );
}

// Helper: find the "Active Model Resources" card and return a scoped
// `within` so we can assert on its contents without picking up other
// elements with the same text (e.g. "GPU 0" in the GPU list).
function getModelCard(): HTMLElement {
  const card = screen
    .getAllByText('Active Model Resources')
    .map((heading) => heading.closest('.rt-Card'))
    .find((el): el is HTMLElement => el !== null);
  if (!card) throw new Error('Active Model Resources card not found');
  return card;
}

// Convenience: `expect(...).toBePresent()` style without jest-dom. Returns
// the element on success, throws on failure. Uses `getBy*` semantics
// (throws if not found).
function expectPresent(getter: () => HTMLElement): HTMLElement {
  const el = getter();
  if (!el) throw new Error('Expected element to be present');
  return el;
}

// Convenience: assert no element matches the query.
function expectAbsent(query: () => HTMLElement | null): void {
  const el = query();
  if (el) throw new Error(`Expected no element, but found: ${el.outerHTML}`);
}

describe('GpuStatusModal — Active Model card', () => {
  it('renders the local ActiveModelCard (VRAM/RAM) when the LLM is local and details are present', () => {
    renderModal({ llmStatus: makeLlmStatus() });

    const card = getModelCard();
    // Model name visible inside the card.
    expectPresent(() => within(card).getByText(MODEL.name));
    // VRAM badge present (local path).
    expectPresent(() => within(card).getByText(/VRAM Usage:/));
    // No remote indicator in the local path.
    expectAbsent(() => within(card).queryByText('Remote'));
    expectAbsent(() =>
      within(card).queryByText(/Model is running on a remote server/)
    );
  });

  it('renders no model card when the LLM is local but details are missing', () => {
    renderModal({
      llmStatus: makeLlmStatus({ details: null }),
    });

    expectAbsent(() => screen.queryByText('Active Model Resources'));
    // Local GPU card still present (sanity).
    expectPresent(() => screen.getByText(/GPU 0:/));
  });

  it('renders the RemoteModelCard with URL and Remote badge when the LLM is remote and details are present', () => {
    renderModal({
      llmStatus: makeLlmStatus({
        isRemoteBaseUrl: true,
        activeBaseUrl: REMOTE_URL,
        defaultBaseUrl: LOCAL_URL,
      }),
    });

    const card = getModelCard();
    // Model name still shown.
    expectPresent(() => within(card).getByText(MODEL.name));
    // Remote badge visible.
    expectPresent(() => within(card).getByText('Remote'));
    // Endpoint row visible.
    expectPresent(() => within(card).getByText('Endpoint:'));
    expectPresent(() => within(card).getByText(REMOTE_URL));
    // Helper text visible.
    expectPresent(() =>
      within(card).getByText(/Model is running on a remote server/)
    );
    // VRAM/RAM badges must NOT appear in the remote card.
    expectAbsent(() => within(card).queryByText(/VRAM Usage:/));
    expectAbsent(() => within(card).queryByText(/System RAM:/));
    // "Offloaded to GPU" progress label also suppressed for remote.
    expectAbsent(() => within(card).queryByText('Offloaded to GPU'));
  });

  it('still renders the RemoteModelCard when the remote LLM has no details', () => {
    renderModal({
      llmStatus: makeLlmStatus({
        isRemoteBaseUrl: true,
        activeBaseUrl: REMOTE_URL,
        defaultBaseUrl: LOCAL_URL,
        details: null,
      }),
    });

    const card = getModelCard();
    // Model name and remote indicator must still surface even without details.
    expectPresent(() => within(card).getByText(MODEL.name));
    expectPresent(() => within(card).getByText('Remote'));
    expectPresent(() => within(card).getByText(REMOTE_URL));
  });

  it('hides the "Local default" row when active and default URLs are the same (remote URL is the only configured one)', () => {
    // Edge case: isRemoteBaseUrl can technically be true even when the
    // active URL matches the default (e.g. legacy data). The card should
    // not display a redundant "Local default" row in that case.
    renderModal({
      llmStatus: makeLlmStatus({
        isRemoteBaseUrl: true,
        activeBaseUrl: REMOTE_URL,
        defaultBaseUrl: REMOTE_URL,
      }),
    });

    const card = getModelCard();
    expectAbsent(() => within(card).queryByText('Local default:'));
    expectPresent(() => within(card).getByText('Endpoint:'));
  });

  it('shows the "Local default" row when active and default URLs differ', () => {
    renderModal({
      llmStatus: makeLlmStatus({
        isRemoteBaseUrl: true,
        activeBaseUrl: REMOTE_URL,
        defaultBaseUrl: LOCAL_URL,
      }),
    });

    const card = getModelCard();
    expectPresent(() => within(card).getByText('Local default:'));
    expectPresent(() => within(card).getByText(LOCAL_URL));
  });

  it('renders no model card when the LLM is unloaded', () => {
    renderModal({
      llmStatus: makeLlmStatus({ loaded: false, details: null }),
    });

    expectAbsent(() => screen.queryByText('Active Model Resources'));
    // Local GPU card still present (sanity).
    expectPresent(() => screen.getByText(/GPU 0:/));
  });

  it('keeps the local GPU/RAM sections visible when the LLM is remote', () => {
    // The local box is still relevant diagnostic info (transcription
    // runs locally, etc.) even when the LLM is on a remote server.
    renderModal({
      gpuStats: makeGpuStats(),
      llmStatus: makeLlmStatus({
        isRemoteBaseUrl: true,
        activeBaseUrl: REMOTE_URL,
        defaultBaseUrl: LOCAL_URL,
      }),
    });

    // Remote model card present.
    expectPresent(() => screen.getByText('Active Model Resources'));
    expectPresent(() => screen.getByText('Remote'));
    // Local GPU device card still rendered.
    expectPresent(() => screen.getByText(/GPU 0:/));
    // Local system memory card still rendered (not unified memory).
    expectPresent(() => screen.getByText('System Memory'));
    // Driver / CUDA badges still rendered.
    expectPresent(() => screen.getByText(/Driver:/));
    expectPresent(() => screen.getByText(/CUDA:/));
  });
});
