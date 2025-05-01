/* packages/ui/src/components/SessionView/Chat/ChatMessages.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Flex,
  Spinner,
  Text,
  IconButton,
  Tooltip,
  TextField,
  AlertDialog,
  Button,
  Callout,
} from '@radix-ui/themes';
import {
  StarIcon,
  StarFilledIcon,
  CheckIcon,
  Cross1Icon,
  Pencil1Icon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { updateMessageStarStatus } from '../../../api/api';
import { toastMessageAtom, renderMarkdownAtom } from '../../../store';
import type { ChatMessage, ChatSession, Session } from '../../../types';
import { ChatMessageBubble } from './ChatMessageBubble'; // Import the new component

interface ChatMessagesProps {
  messages: ChatMessage[];
  activeChatId: number | null;
  isStandalone: boolean;
  streamingMessageId: number | null;
  activeSessionId: number | null;
  isAiResponding: boolean;
}

export function ChatMessages({
  messages,
  activeChatId,
  isStandalone,
  streamingMessageId,
  activeSessionId,
  isAiResponding,
}: ChatMessagesProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const renderMd = useAtomValue(renderMarkdownAtom);
  const [editingStarMessageId, setEditingStarMessageId] = useState<
    number | null
  >(null);
  const [currentStarredName, setCurrentStarredName] = useState('');
  const [starEditError, setStarEditError] = useState<string | null>(null);

  const starNameInputRef = useRef<HTMLInputElement>(null);

  // useEffect for focus unchanged
  useEffect(() => {
    if (editingStarMessageId !== null) {
      const timer = setTimeout(() => {
        starNameInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editingStarMessageId]);

  // starMutation unchanged
  const starMutation = useMutation({
    mutationFn: (variables: {
      messageId: number;
      starred: boolean;
      starredName?: string | null;
    }) => {
      const { messageId, starred, starredName } = variables;
      if (isStandalone && activeChatId) {
        return updateMessageStarStatus(
          messageId,
          starred,
          starredName,
          activeChatId,
          null
        );
      } else if (!isStandalone && activeSessionId && activeChatId) {
        return updateMessageStarStatus(
          messageId,
          starred,
          starredName,
          activeChatId,
          activeSessionId
        );
      } else {
        throw new Error(
          'Missing required IDs (session/chat) to update star status.'
        );
      }
    },
    onSuccess: (updatedMessage) => {
      const queryKey = isStandalone
        ? ['standaloneChat', activeChatId]
        : ['chat', activeSessionId, activeChatId];
      queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          messages: (oldData.messages || []).map((msg) =>
            msg.id === updatedMessage.id ? updatedMessage : msg
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['starredMessages'] });
      setToast(
        `Message ${updatedMessage.starred ? 'starred' : 'unstarred'} successfully.`
      );
      cancelStarEdit();
    },
    onError: (error) => {
      console.error('Star update failed:', error);
      setStarEditError(`Failed to update star status: ${error.message}`);
    },
  });

  // handleStarClick unchanged
  const handleStarClick = (message: ChatMessage) => {
    if (message.sender !== 'user' || starMutation.isPending) return;

    if (message.starred) {
      starMutation.mutate({ messageId: message.id, starred: false });
    } else {
      setEditingStarMessageId(message.id);
      setCurrentStarredName(message.starredName || '');
      setStarEditError(null);
    }
  };

  // handleSaveStarName unchanged
  const handleSaveStarName = () => {
    if (editingStarMessageId === null || starMutation.isPending) return;
    const nameToSave = currentStarredName.trim();
    if (!nameToSave) {
      setStarEditError('Please enter a name for the starred template.');
      return;
    }
    setStarEditError(null);
    starMutation.mutate({
      messageId: editingStarMessageId,
      starred: true,
      starredName: nameToSave,
    });
  };

  // cancelStarEdit unchanged
  const cancelStarEdit = () => {
    setEditingStarMessageId(null);
    setCurrentStarredName('');
    setStarEditError(null);
    starMutation.reset();
  };

  // handleStarNameKeyDown unchanged
  const handleStarNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveStarName();
    }
  };

  // handleCopyClick unchanged
  const handleCopyClick = (textToCopy: string) => {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setToast('Copied to clipboard!');
      })
      .catch((err) => {
        console.error('Failed to copy text: ', err);
        setToast('Error copying text.');
      });
  };

  return (
    <>
      <Flex direction="column" gap="3">
        {/* Render the ChatMessageBubble component inside the map */}
        {messages.map((message) => {
          const isCurrentlyStreaming = message.id === streamingMessageId;
          return (
            <ChatMessageBubble
              key={message.id}
              message={message}
              isCurrentlyStreaming={isCurrentlyStreaming}
              isAiResponding={isAiResponding} // Pass down thinking status
              renderMd={renderMd} // Pass down markdown setting
              onStarClick={handleStarClick} // Pass down handler
              onCopyClick={handleCopyClick} // Pass down handler
              isStarMutationPending={starMutation.isPending} // Pass down mutation status
            />
          );
        })}

        {/* ===================== CHANGE START ===================== */}
        {/* REMOVED the redundant "Thinking..." indicator */}
        {/* ===================== CHANGE END ===================== */}
      </Flex>

      {/* Star Naming Modal (unchanged) */}
      <AlertDialog.Root
        open={editingStarMessageId !== null}
        onOpenChange={(open) => !open && cancelStarEdit()}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>
            <Flex align="center" gap="2">
              <Pencil1Icon /> Save Starred Template
            </Flex>
          </AlertDialog.Title>
          <AlertDialog.Description size="2" mt="1" mb="4">
            Give this starred message a short name for easy identification.
          </AlertDialog.Description>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                Template Name
              </Text>
              <TextField.Root
                ref={starNameInputRef}
                size="2"
                placeholder="Enter template name..."
                value={currentStarredName}
                onChange={(e) => setCurrentStarredName(e.target.value)}
                onKeyDown={handleStarNameKeyDown}
                disabled={starMutation.isPending}
                maxLength={50}
              />
            </label>
            {starEditError && (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>{starEditError}</Callout.Text>
              </Callout.Root>
            )}
            {starMutation.isError && !starEditError && (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>Error: {starMutation.error.message}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={cancelStarEdit}
              disabled={starMutation.isPending}
            >
              <Cross1Icon /> Cancel
            </Button>
            <Button
              onClick={handleSaveStarName}
              disabled={starMutation.isPending || !currentStarredName.trim()}
            >
              {starMutation.isPending ? (
                <>
                  {' '}
                  <Spinner size="2" /> <Text ml="1">Saving...</Text>{' '}
                </>
              ) : (
                <>
                  {' '}
                  <CheckIcon /> Save Template{' '}
                </>
              )}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
