import React, { useCallback, useEffect } from 'react';
import { Text, TextField, Box, Select } from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Session, SessionMetadata } from '../../types';
import { updateSessionMetadata } from '../../api/api';
import { toastMessageAtom } from '../../store';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import { useSetAtom } from 'jotai';
import { EditEntityModal } from './EditEntityModal';
import { formatIsoDateToYMD } from '../../helpers';

interface SessionFormState {
  sessionName: string;
  clientName: string;
  date: string;
  sessionType: string;
  therapy: string;
}

interface EditSessionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session | null;
}

export function EditSessionModal({
  isOpen,
  onOpenChange,
  session,
}: EditSessionModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const editSessionMutation = useMutation<
    SessionMetadata,
    Error,
    { sessionId: number; formState: SessionFormState }
  >({
    mutationFn: (variables) => {
      const { sessionId, formState } = variables;
      const metadataToUpdate: Partial<SessionMetadata> = {
        sessionName: formState.sessionName.trim() || '',
        clientName: formState.clientName.trim() || '',
        date: formState.date || new Date().toISOString().split('T')[0],
        sessionType: formState.sessionType.trim() || '',
        therapy: formState.therapy.trim() || '',
      };
      return updateSessionMetadata(sessionId, metadataToUpdate);
    },
    onSuccess: (updatedSessionMeta, variables) => {
      setToast('Session details updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({
        queryKey: ['sessionMeta', variables.sessionId],
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setToast(`Error updating session: ${error.message}`);
      console.error('Edit session failed:', error);
    },
  });

  const getInitialSessionFormState = useCallback(
    (entity: Session | null): SessionFormState => {
      if (!entity) {
        return {
          sessionName: '',
          clientName: '',
          date: new Date().toISOString().split('T')[0],
          sessionType: '',
          therapy: '',
        };
      }
      return {
        sessionName: entity.sessionName || '',
        clientName: entity.clientName || '',
        date: entity.date
          ? formatIsoDateToYMD(entity.date)
          : new Date().toISOString().split('T')[0],
        sessionType: entity.sessionType || '',
        therapy: entity.therapy || '',
      };
    },
    []
  );

  const validateSessionForm = useCallback(
    (formState: SessionFormState): string | null => {
      if (!formState.date) {
        return 'Date is required.';
      }
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(formState.date)) {
        return 'Date must be in YYYY-MM-DD format.';
      }

      const originalState = getInitialSessionFormState(session);
      const isChanged =
        originalState.sessionName !== formState.sessionName ||
        originalState.clientName !== formState.clientName ||
        originalState.date !== formState.date ||
        originalState.sessionType !== formState.sessionType ||
        originalState.therapy !== formState.therapy;

      if (!isChanged) {
        return 'No changes detected.';
      }
      return null;
    },
    [session, getInitialSessionFormState]
  );

  const handleSaveSession = useCallback(
    async (entityId: number, validatedState: SessionFormState) => {
      editSessionMutation.mutate({
        sessionId: entityId,
        formState: validatedState,
      });
    },
    [editSessionMutation]
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
      // Keep Therapy Type "N/A" if Intake is selected
      useEffect(() => {
        if (formState.sessionType === 'Intake') {
          setFormState((prev) => ({ ...prev, therapy: 'N/A' }));
        }
      }, [formState.sessionType, setFormState]);

      return (
        <>
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Session Name / Title
            </Text>
            <TextField.Root
              ref={firstInputRef as React.RefObject<HTMLInputElement>}
              size="2"
              placeholder="e.g. Initial Intake"
              value={formState.sessionName}
              onChange={(e) =>
                setFormState((prev) => ({
                  ...prev,
                  sessionName: e.target.value,
                }))
              }
              disabled={isSaving}
            />
          </label>
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
            }}
          >
            <label>
              <Text as="div" size="2" mb="1" mt="3" weight="medium">
                Client Name
              </Text>
              <TextField.Root
                size="2"
                placeholder="Client Initials"
                value={formState.clientName}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    clientName: e.target.value,
                  }))
                }
                disabled={isSaving}
              />
            </label>
            <label>
              <Text as="div" size="2" mb="1" mt="3" weight="medium">
                Date
              </Text>
              <TextField.Root
                type="date"
                size="2"
                value={formState.date}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, date: e.target.value }))
                }
                disabled={isSaving}
              />
            </label>
          </Box>
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
            }}
          >
            <label>
              <Text as="div" size="2" mb="1" mt="3" weight="medium">
                Session Type
              </Text>
              <Select.Root
                value={formState.sessionType}
                onValueChange={(val) =>
                  setFormState((prev) => ({ ...prev, sessionType: val }))
                }
                disabled={isSaving}
                size="2"
              >
                <Select.Trigger
                  placeholder="Select type..."
                  style={{ width: '100%' }}
                />
                <Select.Content>
                  {SESSION_TYPES.map((type) => (
                    <Select.Item key={type} value={type}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label>
              <Text as="div" size="2" mb="1" mt="3" weight="medium">
                Therapy Modality
              </Text>
              <Select.Root
                value={formState.therapy}
                onValueChange={(val) =>
                  setFormState((prev) => ({ ...prev, therapy: val }))
                }
                disabled={isSaving || formState.sessionType === 'Intake'}
                size="2"
              >
                <Select.Trigger
                  placeholder="Select therapy..."
                  style={{ width: '100%' }}
                />
                <Select.Content>
                  {THERAPY_TYPES.map((type) => (
                    <Select.Item key={type} value={type}>
                      {type}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>
          </Box>
        </>
      );
    },
    []
  );

  return (
    <EditEntityModal<Session | null, SessionFormState>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      entity={session}
      entityTypeLabel="Session Details"
      getInitialFormState={getInitialSessionFormState}
      renderFormFields={renderSessionFormFields}
      validateForm={validateSessionForm}
      onSave={handleSaveSession}
      isSaving={editSessionMutation.isPending}
      saveError={editSessionMutation.error?.message}
    />
  );
}
