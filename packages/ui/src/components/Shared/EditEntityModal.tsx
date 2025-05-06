/* packages/ui/src/components/Shared/EditEntityModal.tsx */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Callout,
  Spinner,
} from '@radix-ui/themes';
import { InfoCircledIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons';

interface BaseEntity {
  id: number;
  name?: string | null;
}

interface EditEntityModalProps<T extends BaseEntity, FormState> {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  entity: T | null;
  entityTypeLabel: string;
  getInitialFormState: (entity: T | null) => FormState;
  // Adjust ref type to accept null from useRef initialization
  renderFormFields: (
    formState: FormState,
    setFormState: React.Dispatch<React.SetStateAction<FormState>>,
    isSaving: boolean,
    firstInputRef: React.RefObject<
      HTMLInputElement | HTMLTextAreaElement | null
    > // Allow null
  ) => React.ReactNode;
  validateForm: (formState: FormState) => string | null;
  onSave: (entityId: number, validatedState: FormState) => Promise<any>;
  isSaving: boolean;
  saveError?: string | null;
  // REMOVED onSaveSuccess prop - parent mutation should handle success actions
}

export function EditEntityModal<T extends BaseEntity, FormState>({
  isOpen,
  onOpenChange,
  entity,
  entityTypeLabel,
  getInitialFormState,
  renderFormFields,
  validateForm,
  onSave,
  isSaving,
  saveError,
  // Removed onSaveSuccess from props
}: EditEntityModalProps<T, FormState>) {
  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(entity)
  );
  const [localValidationError, setLocalValidationError] = useState<
    string | null
  >(null);

  // Initialize ref allowing null
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null
  );

  useEffect(() => {
    if (isOpen && entity) {
      setFormState(getInitialFormState(entity));
      setLocalValidationError(null);
      const timer = setTimeout(() => {
        // Check if ref exists before focusing
        firstInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else if (!isOpen) {
      setLocalValidationError(null);
    }
  }, [isOpen, entity, getInitialFormState]);

  const handleSaveClick = async () => {
    if (!entity || isSaving) return;

    const validationError = validateForm(formState);
    setLocalValidationError(validationError);

    if (validationError === null) {
      try {
        await onSave(entity.id, formState);
        // Success handling (closing modal, invalidation) is now done
        // within the parent component's useMutation hook.
      } catch (error) {
        console.error(
          `[EditEntityModal] Save failed for ${entityTypeLabel}:`,
          error
        );
        // Error is passed down via saveError prop from parent mutation
      }
    }
  };

  const handleManualClose = (open: boolean) => {
    if (!open && isSaving) {
      console.log('[EditEntityModal] Prevented close while saving.');
      return;
    }
    onOpenChange(open);
    if (!open) {
      setLocalValidationError(null);
    }
  };

  const displayError = localValidationError || saveError;

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
      <Dialog.Content style={{ maxWidth: 525 }}>
        <Dialog.Title>Edit {entityTypeLabel} Details</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Update the details for this {entityTypeLabel.toLowerCase()}.
        </Dialog.Description>

        <Flex direction="column" gap="4" py="4">
          {/* Pass the ref correctly */}
          {renderFormFields(formState, setFormState, isSaving, firstInputRef)}

          {displayError && (
            <Callout.Root color="red" role="alert" size="1" mt="2">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{displayError}</Callout.Text>
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
          <Button type="button" onClick={handleSaveClick} disabled={isSaving}>
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
