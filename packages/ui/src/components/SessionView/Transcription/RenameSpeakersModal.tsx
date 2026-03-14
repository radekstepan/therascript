// packages/ui/src/components/SessionView/Transcription/RenameSpeakersModal.tsx
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  Text,
  Flex,
  Box,
  Button,
  TextField,
  Spinner,
} from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { toastMessageAtom } from '../../../store';
import { renameSpeakers } from '../../../api/api';
import type { StructuredTranscript } from '../../../types';
import { getUniqueSpeakers } from './speakerUtils';

interface RenameSpeakersModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: number;
  transcriptContent: StructuredTranscript | null | undefined;
}

export function RenameSpeakersModal({
  isOpen,
  onOpenChange,
  sessionId,
  transcriptContent,
}: RenameSpeakersModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const speakers = getUniqueSpeakers(transcriptContent);

  // Map from original label → new name input value
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  // Reset inputs whenever the modal opens or the speaker list changes
  useEffect(() => {
    if (isOpen) {
      const initial: Record<string, string> = {};
      for (const s of speakers) {
        initial[s] = s;
      }
      setNameMap(initial);
    }
  }, [isOpen, transcriptContent]);

  const renameMutation = useMutation<
    { message: string },
    Error,
    { sessionId: number; renames: { from: string; to: string }[] }
  >({
    mutationFn: ({ sessionId, renames }) => renameSpeakers(sessionId, renames),
    onSuccess: () => {
      setToast('Speaker labels updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['transcript', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });
      onOpenChange(false);
    },
    onError: (error) => {
      setToast(`Error renaming speakers: ${error.message}`);
      console.error('Rename speakers failed:', error);
    },
  });

  const handleSave = () => {
    const renames = speakers
      .map((original) => ({
        from: original,
        to: (nameMap[original] ?? original).trim(),
      }))
      .filter(({ from, to }) => from !== to && to.length > 0);

    if (renames.length === 0) {
      onOpenChange(false);
      return;
    }

    renameMutation.mutate({ sessionId, renames });
  };

  const handleNameChange = (original: string, value: string) => {
    setNameMap((prev) => ({ ...prev, [original]: value }));
  };

  const isPending = renameMutation.isPending;

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px" style={{ padding: 'var(--space-5)' }}>
        <Dialog.Title mb="1">Rename Speakers</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Enter a new name for each detected speaker. Leave unchanged to keep
          the current label.
        </Dialog.Description>

        {speakers.length === 0 ? (
          <Text size="2" color="gray">
            No speaker labels were detected in this transcript.
          </Text>
        ) : (
          <Flex direction="column" gap="3">
            {/* Column headers */}
            <Flex gap="3" align="center">
              <Box style={{ flex: 1 }}>
                <Text size="1" color="gray" weight="medium">
                  Detected Label
                </Text>
              </Box>
              <Box style={{ flex: 1 }}>
                <Text size="1" color="gray" weight="medium">
                  New Name
                </Text>
              </Box>
            </Flex>

            {speakers.map((original) => (
              <Flex key={original} gap="3" align="center">
                <Box style={{ flex: 1 }}>
                  <Text
                    size="2"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--accent-11)',
                    }}
                  >
                    {original}
                  </Text>
                </Box>
                <Box style={{ flex: 1 }}>
                  <TextField.Root
                    size="2"
                    value={nameMap[original] ?? original}
                    onChange={(e) => handleNameChange(original, e.target.value)}
                    disabled={isPending}
                    placeholder={original}
                  />
                </Box>
              </Flex>
            ))}
          </Flex>
        )}

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" disabled={isPending}>
              Cancel
            </Button>
          </Dialog.Close>
          {speakers.length > 0 && (
            <Button onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <>
                  <Spinner size="1" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
