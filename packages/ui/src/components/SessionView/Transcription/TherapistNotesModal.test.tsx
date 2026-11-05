// @vitest-environment jsdom
// packages/ui/src/components/SessionView/Transcription/TherapistNotesModal.test.tsx
//
// The modal edits the session's optional therapist note: it pre-fills the
// textarea, saves through `updateSessionMetadata`, and disables Save while
// the draft matches the stored note — a no-op save would bump the note
// revision and falsely mark every existing chat as stale.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Theme } from '@radix-ui/themes';
import { TherapistNotesModal } from './TherapistNotesModal';

const { updateSessionMetadataMock } = vi.hoisted(() => ({
  updateSessionMetadataMock: vi.fn(),
}));

vi.mock('../../../api/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../api/api')>();
  return {
    ...original,
    updateSessionMetadata: updateSessionMetadataMock,
  };
});

function renderModal(props?: {
  initialNote?: string | null;
  noteUpdatedAt?: number | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Theme>
        <TherapistNotesModal
          isOpen
          onOpenChange={props?.onOpenChange ?? (() => {})}
          sessionId={1}
          initialNote={props?.initialNote}
          noteUpdatedAt={props?.noteUpdatedAt}
        />
      </Theme>
    </QueryClientProvider>
  );
}

describe('TherapistNotesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSessionMetadataMock.mockResolvedValue({});
  });

  it('pre-fills the stored note and disables Save while unchanged', () => {
    renderModal({ initialNote: 'stored note' });

    const input = screen.getByTestId(
      'therapist-notes-input'
    ) as HTMLTextAreaElement;
    expect(input.value).toBe('stored note');
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('saves the edited note and closes on success', async () => {
    const onOpenChange = vi.fn();
    renderModal({ initialNote: 'old', onOpenChange });

    const input = screen.getByTestId('therapist-notes-input');
    fireEvent.change(input, { target: { value: 'new note' } });

    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => {
      expect(updateSessionMetadataMock).toHaveBeenCalledWith(1, {
        therapistNote: 'new note',
      });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('treats whitespace-only edits as unchanged', () => {
    renderModal({ initialNote: 'note' });

    const input = screen.getByTestId('therapist-notes-input');
    fireEvent.change(input, { target: { value: '  note  ' } });

    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(updateSessionMetadataMock).not.toHaveBeenCalled();
  });

  it('shows when the note was last updated', () => {
    const updatedAt = new Date('2024-05-01T12:00:00Z').getTime();
    renderModal({ initialNote: 'note', noteUpdatedAt: updatedAt });

    expect(screen.getByText(/last updated/i)).toBeDefined();
  });
});
