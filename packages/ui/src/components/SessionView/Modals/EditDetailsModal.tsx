/* packages/ui/src/components/SessionView/Modals/EditDetailsModal.tsx */
import React, { useState, useCallback, useRef } from 'react';
import { Text, TextField, Select, Box, Flex } from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SESSION_TYPES, THERAPY_TYPES } from '../../../constants';
import { updateSessionMetadata } from '../../../api/api';
import type { Session, SessionMetadata } from '../../../types';
import { cn } from '../../../utils';
import { formatIsoDateToYMD, getTodayDateString } from '../../../helpers';
import { EditEntityModal } from '../../Shared/EditEntityModal';

// Define the specific form state structure for sessions
interface SessionFormState {
  clientName: string;
  sessionName: string;
  date: string;
  sessionType: string;
  therapy: string;
}

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
  const queryClient = useQueryClient();

  const updateMetadataMutation = useMutation({
    mutationFn: ({
      entityId,
      formState,
    }: {
      entityId: number;
      formState: SessionFormState;
    }) => {
      const metadataToSave: Partial<SessionMetadata & { date: string }> = {
        clientName: formState.clientName,
        sessionName: formState.sessionName,
        date: formState.date,
        sessionType: formState.sessionType,
        therapy: formState.therapy,
      };
      return updateSessionMetadata(entityId, metadataToSave);
    },
    onSuccess: (
      updatedData,
      variables: { entityId: number; formState: SessionFormState }
    ) => {
      console.log('[EditDetailsModal] Save successful:', updatedData);
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session?.id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onSaveSuccess(variables.formState);
      onOpenChange(false);
    },
    onError: (error) => {
      console.error('[EditDetailsModal] Save failed:', error);
    },
  });

  const getInitialSessionFormState = useCallback(
    (entity: Session | null): SessionFormState => {
      if (!entity) {
        return {
          clientName: '',
          sessionName: '',
          date: getTodayDateString(),
          sessionType: SESSION_TYPES[0] || '',
          therapy: THERAPY_TYPES[0] || '',
        };
      }
      const currentSessionTypeLower = entity.sessionType?.toLowerCase();
      const matchingType = SESSION_TYPES.find(
        (typeConst) => typeConst.toLowerCase() === currentSessionTypeLower
      );
      const initialEditType = matchingType || SESSION_TYPES[0] || '';

      const currentTherapyTypeUpper = entity.therapy?.toUpperCase();
      const matchingTherapy = THERAPY_TYPES.find(
        (therapyConst) => therapyConst.toUpperCase() === currentTherapyTypeUpper
      );
      const initialEditTherapy = matchingTherapy || THERAPY_TYPES[0] || '';

      return {
        clientName: entity.clientName || '',
        sessionName: entity.sessionName || entity.fileName || '',
        date: formatIsoDateToYMD(entity.date),
        sessionType: initialEditType,
        therapy: initialEditTherapy,
      };
    },
    []
  );

  const validateSessionForm = useCallback(
    (formState: SessionFormState): string | null => {
      const errors: string[] = [];
      if (!formState.sessionName.trim()) errors.push('Session Name');
      if (!formState.clientName.trim()) errors.push('Client Name');
      if (!formState.date || !/^\d{4}-\d{2}-\d{2}$/.test(formState.date))
        errors.push('Date (YYYY-MM-DD)');
      if (!SESSION_TYPES.includes(formState.sessionType))
        errors.push('Session Type');
      if (!THERAPY_TYPES.includes(formState.therapy))
        errors.push('Therapy Type');

      if (errors.length > 0) {
        return `Please fill in or correct the following fields: ${errors.join(', ')}`;
      }

      const originalState = getInitialSessionFormState(session);
      const hasChanged =
        JSON.stringify(formState) !== JSON.stringify(originalState);

      if (!hasChanged) {
        return 'No changes detected.';
      }

      return null;
    },
    [session, getInitialSessionFormState]
  );

  const handleSaveSession = useCallback(
    async (entityId: number, validatedState: SessionFormState) => {
      updateMetadataMutation.mutate({ entityId, formState: validatedState });
    },
    [updateMetadataMutation]
  );

  const renderSessionFormFields = useCallback(
    (
      formState: SessionFormState,
      setFormState: React.Dispatch<React.SetStateAction<SessionFormState>>,
      isSaving: boolean,
      firstInputRef: React.RefObject<
        HTMLInputElement | HTMLTextAreaElement | null
      >
    ): React.ReactNode => {
      const updateField = <K extends keyof SessionFormState>(
        field: K,
        value: SessionFormState[K]
      ) => {
        setFormState((prevState) => {
          const newState = { ...prevState, [field]: value };
          if (field === 'sessionType' && value === 'Intake') {
            newState.therapy = 'N/A';
          }
          return newState;
        });
      };

      const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        /* ... */
      };

      return (
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
            ref={firstInputRef as React.RefObject<HTMLInputElement>}
            id="sessionNameEditModal"
            size="2"
            value={formState.sessionName}
            onChange={(e) => updateField('sessionName', e.target.value)}
            placeholder="e.g., Weekly Check-in"
            required
            aria-required="true"
            disabled={isSaving}
            onKeyDown={handleKeyDown}
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
            value={formState.clientName}
            onChange={(e) => updateField('clientName', e.target.value)}
            placeholder="Client's Full Name"
            required
            aria-required="true"
            disabled={isSaving}
            onKeyDown={handleKeyDown}
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
            value={formState.date}
            onChange={(e) => updateField('date', e.target.value)}
            required
            aria-required="true"
            disabled={isSaving}
            onKeyDown={handleKeyDown}
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
            value={formState.sessionType}
            onValueChange={(value) => updateField('sessionType', value)}
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
            value={formState.therapy}
            onValueChange={(value) => updateField('therapy', value)}
            required
            size="2"
            name="therapyType"
            disabled={isSaving || formState.sessionType === 'Intake'}
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
      );
    },
    []
  );

  return (
    <EditEntityModal<Session | null, SessionFormState>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      entity={session}
      entityTypeLabel="Session"
      getInitialFormState={getInitialSessionFormState}
      renderFormFields={renderSessionFormFields}
      validateForm={validateSessionForm}
      onSave={handleSaveSession}
      isSaving={updateMetadataMutation.isPending}
      saveError={updateMetadataMutation.error?.message}
    />
  );
}
