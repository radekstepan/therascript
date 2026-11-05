// packages/ui/src/components/SessionView/Transcription/TherapistNotesModal.tsx
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  Text,
  Flex,
  Button,
  TextArea,
  Spinner,
} from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { toastMessageAtom } from '../../../store';
import { updateSessionMetadata } from '../../../api/api';

interface TherapistNotesModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  initialNote?: string | null;
  noteUpdatedAt?: number | null;
}

export function TherapistNotesModal({
  isOpen,
  onOpenChange,
  sessionId,
  initialNote,
  noteUpdatedAt,
}: TherapistNotesModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const [note, setNote] = useState('');

  // Reset the draft whenever the modal opens (or a fresher note arrives).
  useEffect(() => {
    if (isOpen) {
      setNote(initialNote ?? '');
    }
  }, [isOpen, initialNote]);

  const saveMutation = useMutation({
    mutationFn: (therapistNote: string) =>
      updateSessionMetadata(sessionId, { therapistNote }),
    onSuccess: (_, therapistNote) => {
      setToast(
        therapistNote.trim()
          ? 'Therapist notes saved.'
          : 'Therapist notes cleared.'
      );
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setToast(`Error saving therapist notes: ${error.message}`);
    },
  });

  const isPending = saveMutation.isPending;
  // Compare trimmed text: saving whitespace-only changes would bump the
  // note revision and falsely mark every existing chat as stale.
  const isUnchanged = note.trim() === (initialNote ?? '').trim();

  const handleSave = () => {
    if (isUnchanged || isPending) return;
    saveMutation.mutate(note);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px" style={{ padding: 'var(--space-5)' }}>
        <Dialog.Title mb="1">Therapist Notes</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Optional context for the AI. Notes are sent before the transcript with
          every question about this session. Save an empty note to remove them.
          {noteUpdatedAt != null && (
            <>
              <br />
              Last updated {new Date(noteUpdatedAt).toLocaleString()}.
            </>
          )}
        </Dialog.Description>

        <TextArea
          size="2"
          data-testid="therapist-notes-input"
          aria-label="Therapist notes"
          placeholder="e.g. Patient arrived late and seemed distracted…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isPending}
          autoFocus
          resize="vertical"
          style={{ minHeight: '160px' }}
        />

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={isPending}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button onClick={handleSave} disabled={isPending || isUnchanged}>
            {isPending ? (
              <>
                <Spinner size="1" />
                Saving…
              </>
            ) : (
              'Save'
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
