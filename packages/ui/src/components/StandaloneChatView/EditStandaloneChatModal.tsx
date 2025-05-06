/* packages/ui/src/components/StandaloneChatView/EditStandaloneChatModal.tsx */
import React, { useState, useCallback, useRef } from 'react';
import {
  Text,
  TextField,
  Box,
  Badge,
  IconButton,
  Flex,
} from '@radix-ui/themes';
import { PlusIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { StandaloneChatListItem, ChatSession } from '../../types';
import { renameStandaloneChat as editStandaloneChatApi } from '../../api/api';
import { toastMessageAtom } from '../../store';
import { useSetAtom } from 'jotai';
import { EditEntityModal } from '../Shared/EditEntityModal';

interface ChatFormState {
  name: string;
  tags: string[];
  newTagInput: string;
}

interface EditStandaloneChatModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  chat: StandaloneChatListItem | null;
}

export function EditStandaloneChatModal({
  isOpen,
  onOpenChange,
  chat,
}: EditStandaloneChatModalProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const editChatMutation = useMutation<
    StandaloneChatListItem,
    Error,
    { chatId: number; formState: ChatFormState }
  >({
    /* ... mutation logic ... */
  });

  const getInitialChatFormState = useCallback(
    (entity: StandaloneChatListItem | null): ChatFormState => {
      /* ... */
      if (!entity) {
        return { name: '', tags: [], newTagInput: '' };
      }
      return {
        name: entity.name || '',
        tags: Array.isArray(entity.tags) ? [...entity.tags] : [],
        newTagInput: '',
      };
    },
    []
  );

  const validateChatForm = useCallback(
    (formState: ChatFormState): string | null => {
      /* ... */
      if (formState.tags.some((tag) => !tag.trim())) {
        /* ... */
      }
      if (formState.tags.some((tag) => tag.length > 50)) {
        /* ... */
      }
      if (formState.tags.length > 10) {
        /* ... */
      }

      const originalState = getInitialChatFormState(chat);
      const originalName = originalState.name;
      const originalTagsString = JSON.stringify(originalState.tags.sort());
      const currentName = formState.name;
      const currentTagsString = JSON.stringify([...formState.tags].sort());

      if (
        originalName === currentName &&
        originalTagsString === currentTagsString
      ) {
        return 'No changes detected.';
      }
      return null;
    },
    [chat, getInitialChatFormState]
  );

  const handleSaveChat = useCallback(
    async (entityId: number, validatedState: ChatFormState) => {
      editChatMutation.mutate({ chatId: entityId, formState: validatedState });
    },
    [editChatMutation]
  );

  // Fix the ref type here to match EditEntityModal's expectation
  const renderChatFormFields = useCallback(
    (
      formState: ChatFormState,
      setFormState: React.Dispatch<React.SetStateAction<ChatFormState>>,
      isSaving: boolean,
      firstInputRef: React.RefObject<
        HTMLInputElement | HTMLTextAreaElement | null
      > // <-- Use the correct type here
    ): React.ReactNode => {
      const [tagInputError, setTagInputError] = useState<string | null>(null);

      const handleAddTag = (e?: React.FormEvent | React.KeyboardEvent) => {
        /* ... tag add logic ... */
        const tagToAdd = formState.newTagInput.trim();
        setTagInputError(null); // Clear previous error

        if (!tagToAdd) return;

        if (
          formState.tags.some(
            (tag) => tag.toLowerCase() === tagToAdd.toLowerCase()
          )
        ) {
          setTagInputError(`Tag "${tagToAdd}" already exists.`);
          return;
        }
        if (tagToAdd.length > 50) {
          setTagInputError('Tags cannot exceed 50 characters.');
          return;
        }
        if (formState.tags.length >= 10) {
          setTagInputError('Maximum of 10 tags allowed.');
          return;
        }

        setFormState((prev) => ({
          ...prev,
          tags: [...prev.tags, tagToAdd],
          newTagInput: '', // Clear input field after adding
        }));
      };

      const handleRemoveTag = (tagToRemove: string) => {
        /* ... tag remove logic ... */
        setFormState((prev) => ({
          ...prev,
          tags: prev.tags.filter((tag) => tag !== tagToRemove),
        }));
        setTagInputError(null); // Clear error on remove
      };

      const handleTagInputKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>
      ) => {
        /* ... tag keydown logic ... */
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          handleAddTag(e);
        }
        if (tagInputError) setTagInputError(null); // Clear error on typing
      };

      const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        /* ... */
      };

      return (
        <>
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Name (Optional)
            </Text>
            <TextField.Root
              // Cast the ref to the specific type expected by TextField.Root
              ref={firstInputRef as React.RefObject<HTMLInputElement>}
              size="2"
              placeholder="Enter chat name"
              value={formState.name}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, name: e.target.value }))
              }
              disabled={isSaving}
              onKeyDown={handleNameKeyDown}
            />
          </label>

          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Tags
            </Text>
            {/* ... Tag display ... */}
            <Flex
              gap="1"
              wrap="wrap"
              mb={formState.tags.length > 0 ? '2' : '0'}
              style={{ minHeight: formState.tags.length > 0 ? 'auto' : '0px' }}
            >
              {formState.tags.map((tag, index) => (
                <Badge
                  key={`${tag}-${index}`}
                  color="gray"
                  variant="soft"
                  radius="full"
                >
                  {tag}
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    radius="full"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveTag(tag);
                    }}
                    disabled={isSaving}
                    aria-label={`Remove tag ${tag}`}
                    style={{
                      marginLeft: '4px',
                      marginRight: '-5px',
                      height: '12px',
                      width: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <Cross2Icon width="10" height="10" />
                  </IconButton>
                </Badge>
              ))}
            </Flex>
            {/* ... Tag input ... */}
            <Flex gap="2" align="center">
              <TextField.Root
                size="2"
                placeholder="Add a tag..."
                value={formState.newTagInput}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    newTagInput: e.target.value,
                  }))
                }
                onKeyDown={handleTagInputKeyDown}
                disabled={isSaving || formState.tags.length >= 10}
                style={{ flexGrow: 1 }}
                aria-invalid={!!tagInputError}
                aria-describedby={tagInputError ? 'tag-input-error' : undefined}
              />
              <IconButton
                size="2"
                variant="soft"
                onClick={handleAddTag}
                disabled={
                  isSaving ||
                  !formState.newTagInput.trim() ||
                  formState.tags.length >= 10
                }
                aria-label="Add tag"
                title="Add tag"
              >
                <PlusIcon />
              </IconButton>
            </Flex>
            {tagInputError && (
              <Text id="tag-input-error" color="red" size="1" mt="1">
                {tagInputError}
              </Text>
            )}
          </label>
        </>
      );
    },
    []
  );

  return (
    <EditEntityModal<StandaloneChatListItem, ChatFormState>
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      entity={chat}
      entityTypeLabel="Chat"
      getInitialFormState={getInitialChatFormState}
      renderFormFields={renderChatFormFields}
      validateForm={validateChatForm}
      onSave={handleSaveChat}
      isSaving={editChatMutation.isPending}
      saveError={editChatMutation.error?.message}
    />
  );
}
