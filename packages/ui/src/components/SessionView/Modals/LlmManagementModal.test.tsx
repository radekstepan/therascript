// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Modals/LlmManagementModal.test.tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { Theme } from '@radix-ui/themes';

import { LlmManagementModal } from './LlmManagementModal';
import type { LlmModelInfo, LlmStatus } from '../../../types';

const VERY_LONG_MODEL_NAME =
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B-GGUF/deepseek-r1-distill-qwen-32b-q4_k_m-extra-long-name-for-testing-overflow-behavior.gguf';

const { LONG_NAME_MODEL_FIXTURE } = vi.hoisted(() => {
  const model: LlmModelInfo = {
    name: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B-GGUF/deepseek-r1-distill-qwen-32b-q4_k_m-extra-long-name-for-testing-overflow-behavior.gguf',
    modified_at: new Date().toISOString(),
    size: 4_200_000_000,
    digest: 'sha256:long-model-digest',
    details: {
      format: 'gguf',
      family: 'qwen2',
      families: null,
      parameter_size: '32B',
      quantization_level: 'Q4_K_M',
    },
    defaultContextSize: 32768,
    size_vram: undefined,
    expires_at: null,
    architecture: null,
  };
  return { LONG_NAME_MODEL_FIXTURE: model };
});

vi.mock('../../../api/api', () => ({
  fetchLlmStatus: vi.fn().mockResolvedValue({
    activeModel: '',
    modelChecked: '',
    loaded: false,
    defaultBaseUrl: 'http://localhost:1234',
    details: null,
  } satisfies LlmStatus),
  fetchAvailableModels: vi.fn().mockResolvedValue({
    models: [LONG_NAME_MODEL_FIXTURE],
  }),
  startDownloadLlmModel: vi.fn(),
  fetchDownloadLlmModelStatus: vi.fn(),
  cancelDownloadLlmModel: vi.fn(),
  deleteLlmModel: vi.fn().mockResolvedValue({ message: 'Model deleted' }),
}));

function renderModal(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <JotaiProvider>
      <QueryClientProvider client={queryClient}>
        <Theme>
          <LlmManagementModal {...props} />
        </Theme>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

describe('LlmManagementModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders long model name with truncation and keeps size badge and action menu accessible', async () => {
    const handleOpenChange = vi.fn();
    renderModal({ isOpen: true, onOpenChange: handleOpenChange });

    // Wait for the model name to appear
    const modelNameEl = await screen.findByText(VERY_LONG_MODEL_NAME);
    expect(modelNameEl).toBeTruthy();

    // Verify truncate class and styles are applied to model name Text
    expect(modelNameEl.className).toContain('rt-truncate');
    expect(modelNameEl.style.minWidth).toBe('0');
    expect(modelNameEl.style.maxWidth).toBe('100%');
    expect(modelNameEl.style.overflow).toBe('hidden');

    // Verify name row container has minWidth: 0 and maxWidth: 100% so it can shrink
    const nameRowBox = modelNameEl.parentElement;
    expect(nameRowBox).toBeTruthy();
    expect((nameRowBox as HTMLElement).style.minWidth).toBe('0');
    expect((nameRowBox as HTMLElement).style.maxWidth).toBe('100%');

    // Verify left block container has minWidth: 0 and overflow: hidden
    const leftBlock = modelNameEl.closest('.rt-Flex');
    expect(leftBlock).toBeTruthy();
    expect((leftBlock as HTMLElement).style.minWidth).toBe('0');
    expect((leftBlock as HTMLElement).style.overflow).toBe('hidden');

    // Verify size badge is rendered
    const sizeBadge = screen.getByText('4.2 GB');
    expect(sizeBadge).toBeTruthy();

    // Verify right block container has flexShrink: 0
    const rightBlock = sizeBadge.closest('.rt-Flex');
    expect(rightBlock).toBeTruthy();
    expect((rightBlock as HTMLElement).className).toContain('rt-r-fs-0');

    // Verify model actions button ("...") is rendered and enabled
    const actionsButton = screen.getByRole('button', {
      name: `Actions for ${VERY_LONG_MODEL_NAME}`,
    });
    expect(actionsButton).toBeTruthy();
    expect((actionsButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('constrains ScrollArea child container to width: 100% and minWidth: 0', async () => {
    const handleOpenChange = vi.fn();
    renderModal({ isOpen: true, onOpenChange: handleOpenChange });

    const modelNameEl = await screen.findByText(VERY_LONG_MODEL_NAME);
    expect(modelNameEl).toBeTruthy();

    // Find the Box containing the list inside ScrollArea
    const rowBox = modelNameEl.closest('[style*="border-bottom"]');
    expect(rowBox).toBeTruthy();
    expect((rowBox as HTMLElement).style.minWidth).toBe('0');
    expect((rowBox as HTMLElement).style.maxWidth).toBe('100%');

    // Parent box in ScrollArea should have width 100%, minWidth 0, and maxWidth 100%
    const scrollContentBox = rowBox?.parentElement;
    expect(scrollContentBox).toBeTruthy();
    expect((scrollContentBox as HTMLElement).style.width).toBe('100%');
    expect((scrollContentBox as HTMLElement).style.minWidth).toBe('0');
    expect((scrollContentBox as HTMLElement).style.maxWidth).toBe('100%');
  });

  it('opens delete confirmation modal when Delete Model is clicked', async () => {
    const user = userEvent.setup();
    const handleOpenChange = vi.fn();
    renderModal({ isOpen: true, onOpenChange: handleOpenChange });

    await screen.findByText(VERY_LONG_MODEL_NAME);

    const actionsButton = screen.getByRole('button', {
      name: `Actions for ${VERY_LONG_MODEL_NAME}`,
    });
    await user.click(actionsButton);

    const deleteMenuItem = await screen.findByRole('menuitem', {
      name: /Delete Model/i,
    });
    await user.click(deleteMenuItem);

    // Delete confirmation dialog should open
    expect(
      await screen.findByRole('heading', { name: 'Delete Model' })
    ).toBeTruthy();
    expect(
      screen.getByText(/Are you sure you want to delete the model/i)
    ).toBeTruthy();
  });
});
