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

export interface BaseEntity {
  id: number;
  name?: string | null;
}

interface EditEntityModalProps<T extends BaseEntity | null, FormState> {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  entity: T;
  entityTypeLabel: string;
  getInitialFormState: (entity: T) => FormState;
  renderFormFields: (
    formState: FormState,
    setFormState: React.Dispatch<React.SetStateAction<FormState>>,
    isSaving: boolean,
    firstInputRef: React.RefObject<
      HTMLInputElement | HTMLTextAreaElement | null
    >
  ) => React.ReactNode;
  validateForm: (formState: FormState) => string | null;
  onSave: (entityId: number, validatedState: FormState) => Promise<any>;
  isSaving: boolean;
  saveError?: string | null;
}

export function EditEntityModal<T extends BaseEntity | null, FormState>({
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
}: EditEntityModalProps<T, FormState>) {
  const [formState, setFormState] = useState<FormState>(() =>
    getInitialFormState(entity)
  );
  const [localValidationError, setLocalValidationError] = useState<
    string | null
  >(null);

  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null
  );

  useEffect(() => {
    if (isOpen) {
      setFormState(getInitialFormState(entity));
      setLocalValidationError(null);
      const timer = setTimeout(() => {
        firstInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else if (!isOpen) {
      setLocalValidationError(null);
    }
  }, [isOpen, entity, getInitialFormState]);

  const handleSaveClick = async () => {
    if (isSaving || (entity === null && !isOpen)) return;

    const validationError = validateForm(formState);
    setLocalValidationError(validationError);

    if (validationError === null) {
      try {
        await onSave(entity?.id ?? -1, formState);
      } catch (error) {
        console.error(
          `[EditEntityModal] Save failed for ${entityTypeLabel}:`,
          error
        );
      }
    }
  };

  const handleManualClose = (open: boolean) => {
    if (!open && isSaving) {
      return;
    }
    onOpenChange(open);
    if (!open) {
      setLocalValidationError(null);
    }
  };

  const displayError = localValidationError || saveError;
  const isCreating = !entity;

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
      <Dialog.Content style={{ maxWidth: 525 }}>
        <Dialog.Title>
          {isCreating ? 'Create New' : 'Edit'} {entityTypeLabel}
        </Dialog.Title>
        <Dialog.Description size="2" mb="4">
          {isCreating
            ? 'Fill in the details below.'
            : `Update the details for this ${entityTypeLabel.toLowerCase()}.`}
        </Dialog.Description>

        <Flex direction="column" gap="4" py="4">
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
