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
import type { StandaloneChatListItem } from '../../types';
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
    StandaloneChatListItem, // Type of data returned on success
    Error, // Type of error
    { chatId: number; formState: ChatFormState } // Type of variables passed to mutationFn
  >({
    mutationFn: (variables: { chatId: number; formState: ChatFormState }) => {
      const { chatId, formState } = variables;
      // Ensure name is null if empty string, otherwise pass trimmed name.
      // Ensure tags are passed correctly.
      return editStandaloneChatApi(
        chatId,
        formState.name.trim() || null,
        formState.tags
      );
    },
    onSuccess: (updatedChat) => {
      setToast('Chat details updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      queryClient.invalidateQueries({
        queryKey: ['standaloneChat', updatedChat.id],
      });
      onOpenChange(false); // Close the modal on success
    },
    onError: (error: Error) => {
      setToast(`Error updating chat: ${error.message}`);
      // Error handling, potentially set an error message in the modal state
      console.error('Edit chat failed:', error);
    },
  });

  const getInitialChatFormState = useCallback(
    (entity: StandaloneChatListItem | null): ChatFormState => {
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
      if (formState.tags.some((tag) => !tag.trim())) {
        return 'Tags cannot be empty or just whitespace.';
      }
      if (formState.tags.some((tag) => tag.length > 50)) {
        return 'Tags cannot exceed 50 characters.';
      }
      if (formState.tags.length > 10) {
        return 'Maximum of 10 tags allowed.';
      }

      const originalState = getInitialChatFormState(chat);
      const originalName = originalState.name;
      // Sort tags for consistent comparison
      const originalTagsString = JSON.stringify([...originalState.tags].sort());
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

  const renderChatFormFields = useCallback(
    (
      formState: ChatFormState,
      setFormState: React.Dispatch<React.SetStateAction<ChatFormState>>,
      isSaving: boolean,
      firstInputRef: React.RefObject<
        HTMLInputElement | HTMLTextAreaElement | null
      >
    ): React.ReactNode => {
      const [tagInputError, setTagInputError] = useState<string | null>(null);

      const handleAddTag = (e?: React.FormEvent | React.KeyboardEvent) => {
        const tagToAdd = formState.newTagInput.trim();
        setTagInputError(null);

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
          newTagInput: '',
        }));
      };

      const handleRemoveTag = (tagToRemove: string) => {
        setFormState((prev) => ({
          ...prev,
          tags: prev.tags.filter((tag) => tag !== tagToRemove),
        }));
        setTagInputError(null);
      };

      const handleTagInputKeyDown = (
        e: React.KeyboardEvent<HTMLInputElement>
      ) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          handleAddTag(e);
        }
        if (tagInputError) setTagInputError(null);
      };

      const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Potentially trigger save if this is the only field or for convenience
          // This is handled by the main modal's save button normally
        }
      };

      return (
        <>
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Name (Optional)
            </Text>
            <TextField.Root
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
            <Text as="div" size="2" mb="1" mt="3" weight="medium">
              Tags
            </Text>
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
