/* packages/ui/src/components/SessionView/Modals/EditDetailsModal.tsx */
import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  Dialog,
  Flex,
  Text,
  TextField,
  Select,
  Box,
  Callout,
  Spinner,
} from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InfoCircledIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../../constants';
import { updateSessionMetadata } from '../../../api/api';
import type { Session, SessionMetadata } from '../../../types';
import { cn } from '../../../utils';
import { formatIsoDateToYMD } from '../../../helpers';

interface EditDetailsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
  onSaveSuccess: (updatedMetadata: Partial<SessionMetadata>) => void;
}

export function EditDetailsModal({
  isOpen,
  onOpenChange,
  session,
  onSaveSuccess,
}: EditDetailsModalProps) {
  const [editClientName, setEditClientName] = useState('');
  const [editSessionName, setEditSessionName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editType, setEditType] = useState('');
  const [editTherapy, setEditTherapy] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Ref for auto-focus
  const sessionNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && session) {
      setEditClientName(session.clientName || '');
      setEditSessionName(session.sessionName || session.fileName || '');
      setEditDate(formatIsoDateToYMD(session.date));

      const currentSessionTypeLower = session.sessionType?.toLowerCase();
      const matchingType = SESSION_TYPES.find(
        (typeConst) => typeConst.toLowerCase() === currentSessionTypeLower
      );
      const initialEditType = matchingType || SESSION_TYPES[0] || '';
      setEditType(initialEditType);

      const currentTherapyTypeUpper = session.therapy?.toUpperCase();
      const matchingTherapy = THERAPY_TYPES.find(
        (therapyConst) => therapyConst.toUpperCase() === currentTherapyTypeUpper
      );
      const initialEditTherapy = matchingTherapy || THERAPY_TYPES[0] || '';
      setEditTherapy(initialEditTherapy);

      setValidationError(null);
      updateMetadataMutation.reset();

      // Auto-focus on the first input field when the modal opens
      const timer = setTimeout(() => {
        sessionNameInputRef.current?.focus();
      }, 50); // Small delay ensures element is ready
      return () => clearTimeout(timer);
    } else if (!isOpen) {
      updateMetadataMutation.reset();
    }
  }, [isOpen, session]);

  const updateMetadataMutation = useMutation({
    mutationFn: (metadata: Partial<SessionMetadata>) => {
      if (!session) throw new Error('Session data missing');
      return updateSessionMetadata(session.id, metadata);
    },
    onSuccess: (updatedData, variables) => {
      console.log('[EditModal] Save successful (API Response):', updatedData);
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session?.id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onSaveSuccess(variables);
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('[EditModal] Save failed:', error);
      setValidationError(
        `Failed to update session metadata: ${error.message}. Please try again.`
      );
    },
  });

  const isSaving = updateMetadataMutation.isPending;

  const handleSave = async () => {
    if (!session || isSaving) return;

    const trimmedName = editSessionName.trim();
    const trimmedClient = editClientName.trim();

    let errors: string[] = [];
    if (!trimmedName) errors.push('Session Name');
    if (!trimmedClient) errors.push('Client Name');
    if (!editDate || !/^\d{4}-\d{2}-\d{2}$/.test(editDate))
      errors.push('Date (YYYY-MM-DD)');
    if (!SESSION_TYPES.includes(editType)) errors.push('Session Type');
    if (!THERAPY_TYPES.includes(editTherapy)) errors.push('Therapy Type');

    if (errors.length > 0) {
      setValidationError(
        `Please fill in or correct the following fields: ${errors.join(', ')}`
      );
      return;
    }
    setValidationError(null);

    const metadataToSave: Partial<SessionMetadata> = {
      clientName: trimmedClient,
      sessionName: trimmedName,
      date: editDate,
      sessionType: editType,
      therapy: editTherapy,
    };

    const originalDateYMD = formatIsoDateToYMD(session.date);
    const hasChanged =
      metadataToSave.clientName !== (session.clientName || '') ||
      metadataToSave.sessionName !==
        (session.sessionName || session.fileName || '') ||
      metadataToSave.date !== originalDateYMD ||
      metadataToSave.sessionType !== (session.sessionType || '') ||
      metadataToSave.therapy !== (session.therapy || '');

    if (!hasChanged) {
      setValidationError('No changes detected.');
      return;
    }

    try {
      updateMetadataMutation.mutate(metadataToSave);
    } catch (err) {
      console.error('Error initiating mutation:', err);
      setValidationError('An unexpected error occurred while trying to save.');
    }
  };

  const handleManualClose = (open: boolean) => {
    if (!open && isSaving) return;
    if (!open) setValidationError(null);
    onOpenChange(open);
  };

  // Handle Enter key press in input fields to trigger save
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
      <Dialog.Content style={{ maxWidth: 525 }}>
        <Dialog.Title>Edit Session Details</Dialog.Title>
        <Flex direction="column" gap="4" py="4">
          <Box className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <Text
              as="label"
              size="2"
              weight="medium"
              htmlFor="sessionNameEditModal"
              className="text-right"
            >
              Session Name
            </Text>
            <TextField.Root
              ref={sessionNameInputRef} // Attach ref for focus
              id="sessionNameEditModal"
              size="2"
              value={editSessionName}
              onChange={(e) => setEditSessionName(e.target.value)}
              placeholder="e.g., Weekly Check-in"
              required
              aria-required="true"
              disabled={isSaving}
              onKeyDown={handleKeyDown} // Add keydown handler
            />
            <Text
              as="label"
              size="2"
              weight="medium"
              htmlFor="clientNameEditModal"
              className="text-right"
            >
              Client Name
            </Text>
            <TextField.Root
              id="clientNameEditModal"
              size="2"
              value={editClientName}
              onChange={(e) => setEditClientName(e.target.value)}
              placeholder="Client's Full Name"
              required
              aria-required="true"
              disabled={isSaving}
              onKeyDown={handleKeyDown} // Add keydown handler
            />
            <Text
              as="label"
              size="2"
              weight="medium"
              htmlFor="sessionDateEditModal"
              className="text-right"
            >
              Date
            </Text>
            <input
              id="sessionDateEditModal"
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              required
              aria-required="true"
              disabled={isSaving}
              onKeyDown={handleKeyDown} // Add keydown handler
              className={cn(
                'flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]',
                'h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
              )}
              style={{ lineHeight: 'normal' }}
            />
            <Text
              as="label"
              size="2"
              weight="medium"
              htmlFor="sessionTypeEditModal"
              className="text-right"
            >
              Session Type
            </Text>
            <Select.Root
              value={editType}
              onValueChange={setEditType}
              required
              size="2"
              name="sessionType"
              disabled={isSaving}
            >
              <Select.Trigger
                id="sessionTypeEditModal"
                placeholder="Select type..."
              />
              <Select.Content>
                {SESSION_TYPES.map((type) => (
                  <Select.Item key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Text
              as="label"
              size="2"
              weight="medium"
              htmlFor="therapyTypeEditModal"
              className="text-right"
            >
              Therapy Type
            </Text>
            <Select.Root
              value={editTherapy}
              onValueChange={setEditTherapy}
              required
              size="2"
              name="therapyType"
              disabled={isSaving}
            >
              <Select.Trigger
                id="therapyTypeEditModal"
                placeholder="Select therapy..."
              />
              <Select.Content>
                {THERAPY_TYPES.map((type) => (
                  <Select.Item key={type} value={type}>
                    {type}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
          {validationError && (
            <Callout.Root color="red" role="alert" size="1" mt="2">
              {' '}
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>{' '}
              <Callout.Text>{validationError}</Callout.Text>{' '}
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button
              type="button"
              variant="soft"
              color="gray"
              disabled={isSaving}
            >
              <Cross2Icon /> Cancel
            </Button>
          </Dialog.Close>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner size="2" />
                <Text ml="2">Saving...</Text>
              </>
            ) : (
              <>
                <CheckIcon /> Save Changes
              </>
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
