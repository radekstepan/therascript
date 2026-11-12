// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Chat/ChatInput.test.tsx
//
// Until the model is ready, the input row is replaced by a state panel:
// a loading spinner while the model loads, otherwise a short message
// with a button that opens the model picker. The input fades back in
// once the model is ready.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { Theme } from '@radix-ui/themes';
import { ChatInput } from './ChatInput';
import type { LlmStatus } from '../../../types';
import { activeChatIdAtom, activeSessionIdAtom } from '../../../store';

vi.mock('../../../api/chat', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/chat')>();
  return {
    ...original,
    fetchSessionContextUsage: vi
      .fn()
      .mockRejectedValue(new Error('no context usage in test')),
    fetchStandaloneContextUsage: vi
      .fn()
      .mockRejectedValue(new Error('no context usage in test')),
  };
});

const BASE_STATUS: LlmStatus = {
  status: 'available',
  activeModel: 'llama-3',
  modelChecked: 'other-model',
  loaded: false,
  serverReachable: true,
  actualLoadedModel: null,
  loadState: {
    status: 'idle',
    modelName: null,
    error: null,
    attemptedAt: null,
  },
};

const LOADING_STATUS: LlmStatus = {
  ...BASE_STATUS,
  loadState: {
    status: 'loading',
    modelName: 'llama-3',
    error: null,
    attemptedAt: '2024-01-01T00:00:00.000Z',
  },
};

const READY_STATUS: LlmStatus = {
  ...BASE_STATUS,
  modelChecked: 'llama-3',
  loaded: true,
};

const NOT_LOADED_STATUS: LlmStatus = { ...BASE_STATUS };

const NO_MODEL_STATUS: LlmStatus = {
  ...BASE_STATUS,
  activeModel: 'default',
  modelChecked: 'default',
};

const FAILED_STATUS: LlmStatus = {
  ...BASE_STATUS,
  loadState: {
    status: 'failed',
    modelName: 'llama-3',
    error: 'boom',
    attemptedAt: '2024-01-01T00:00:00.000Z',
  },
};

const MISMATCH_STATUS: LlmStatus = {
  ...BASE_STATUS,
  modelChecked: 'qwen-2',
  loaded: true,
  actualLoadedModel: 'qwen-2',
};

const UNREACHABLE_STATUS: LlmStatus = {
  ...BASE_STATUS,
  status: 'unavailable',
  serverReachable: false,
};

function renderChatInput(
  queryClient: QueryClient,
  mutateMock?: ReturnType<typeof vi.fn>
) {
  const addMessageMutation = {
    mutate: mutateMock ?? vi.fn(),
    isError: false,
    error: null,
    reset: vi.fn(),
  };
  const store = createStore();
  store.set(activeChatIdAtom, 5);
  store.set(activeSessionIdAtom, 1);
  return render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <Theme>
          <ChatInput
            isStandalone={false}
            disabled={false}
            isAiResponding={false}
            onCancelStream={vi.fn()}
            addMessageMutation={addMessageMutation as any}
          />
        </Theme>
      </QueryClientProvider>
    </JotaiProvider>
  );
}

function makeQueryClient(status: LlmStatus) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  queryClient.setQueryData(['llmStatus'], status);
  return queryClient;
}

const openPickerFromPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Configure AI Model' }));
  await screen.findByRole('dialog');
};

describe('ChatInput model state panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading panel instead of the input while the model loads', () => {
    renderChatInput(makeQueryClient(LOADING_STATUS));

    const panel = screen.getByTestId('model-state-panel');
    expect(panel.textContent).toContain('Loading model…');
    expect(screen.queryByTestId('chat-input')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fades the input back in and sends once the model is ready', async () => {
    const mutateMock = vi.fn();
    const queryClient = makeQueryClient(LOADING_STATUS);
    renderChatInput(queryClient, mutateMock);

    expect(screen.queryByTestId('chat-input')).toBeNull();

    act(() => {
      queryClient.setQueryData(['llmStatus'], READY_STATUS);
    });

    const input = (await screen.findByTestId('chat-input')) as HTMLInputElement;
    expect(screen.queryByTestId('model-state-panel')).toBeNull();
    expect(screen.getByTestId('chat-input-row').className).toContain(
      'chat-input-fade-in'
    );
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    expect(mutateMock.mock.calls[0][0].text).toBe('hello');
  });

  it('offers only the load action when the model is not loaded', async () => {
    renderChatInput(makeQueryClient(NOT_LOADED_STATUS));

    const panel = screen.getByTestId('model-state-panel');
    expect(panel.textContent).not.toContain("isn't loaded");
    await openPickerFromPanel();
  });

  it('opens the picker when no model is selected', async () => {
    renderChatInput(makeQueryClient(NO_MODEL_STATUS));

    expect(screen.getByTestId('model-state-panel').textContent).toContain(
      'No model selected'
    );
    await openPickerFromPanel();
  });

  it('surfaces the failure reason with a retry action', async () => {
    renderChatInput(makeQueryClient(FAILED_STATUS));

    const panel = screen.getByTestId('model-state-panel');
    expect(panel.textContent).toContain('Model failed to load');
    expect(panel.textContent).toContain('boom');
    await openPickerFromPanel();
  });

  it('offers to switch when the server holds a different model', async () => {
    renderChatInput(makeQueryClient(MISMATCH_STATUS));

    expect(screen.getByTestId('model-state-panel').textContent).toContain(
      'Wrong model loaded'
    );
    await openPickerFromPanel();
  });

  it('opens configuration when the server is unreachable', async () => {
    renderChatInput(makeQueryClient(UNREACHABLE_STATUS));

    expect(screen.getByTestId('model-state-panel').textContent).toContain(
      'LLM server unreachable'
    );
    await openPickerFromPanel();
  });
});
