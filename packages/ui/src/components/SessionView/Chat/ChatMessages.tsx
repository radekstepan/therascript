/* packages/ui/src/components/SessionView/Chat/ChatMessages.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { useSetAtom } from 'jotai';
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
  CopyIcon,
} from '@radix-ui/react-icons';
import ReactMarkdown from 'react-markdown';
import { updateMessageStarStatus } from '../../../api/api';
import { cn } from '../../../utils';
import { toastMessageAtom, renderMarkdownAtom } from '../../../store';
import type { ChatMessage, ChatSession, Session } from '../../../types';
import { useAtomValue } from 'jotai';

interface ChatMessagesProps {
  messages: ChatMessage[];
  activeChatId: number | null;
  isStandalone: boolean; // Determines which API endpoint to potentially call (though unified in api.ts)
  streamingMessageId: number | null;
  activeSessionId: number | null; // Needed for session-based star updates
  isAiResponding: boolean; // <-- Add prop to know when AI is thinking (before first token)
}

export function ChatMessages({
  messages,
  activeChatId,
  isStandalone,
  streamingMessageId,
  activeSessionId, // Destructure the required prop
  isAiResponding, // <-- Destructure prop
}: ChatMessagesProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const renderMd = useAtomValue(renderMarkdownAtom);
  const [editingStarMessageId, setEditingStarMessageId] = useState<
    number | null
  >(null);
  const [currentStarredName, setCurrentStarredName] = useState('');
  const [starEditError, setStarEditError] = useState<string | null>(null);

  // Ref for auto-focus
  const starNameInputRef = useRef<HTMLInputElement>(null);

  // Effect for auto-focusing star name input
  useEffect(() => {
    if (editingStarMessageId !== null) {
      const timer = setTimeout(() => {
        starNameInputRef.current?.focus();
      }, 50); // Small delay ensures element is ready
      return () => clearTimeout(timer);
    }
  }, [editingStarMessageId]);

  // Mutation for updating star status (unchanged)
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

  const handleStarClick = (message: ChatMessage) => {
    if (message.sender !== 'user' || starMutation.isPending) return;

    if (message.starred) {
      // Unstar directly
      starMutation.mutate({ messageId: message.id, starred: false });
    } else {
      // Star: Open modal to get name
      setEditingStarMessageId(message.id);
      setCurrentStarredName(message.starredName || '');
      setStarEditError(null);
    }
  };

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

  const cancelStarEdit = () => {
    setEditingStarMessageId(null);
    setCurrentStarredName('');
    setStarEditError(null);
    starMutation.reset();
  };

  // Handle Enter key in star naming modal
  const handleStarNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveStarName();
    }
  };

  // Copy Message Handler (unchanged)
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
        {messages.map((message) => {
          const isStreamingThisMessage = message.id === streamingMessageId;
          const showSpinner =
            isStreamingThisMessage && message.text === '' && isAiResponding;
          const showBlinkingCursor = isStreamingThisMessage && !showSpinner; // Show cursor if streaming and text exists OR if not responding yet but text is empty (though spinner handles that)
          const showCopyButton =
            message.sender === 'ai' && !isStreamingThisMessage; // Show copy only for completed AI messages

          return (
            <Flex
              key={message.id}
              direction="column" // Stack message content and potential actions
              align={message.sender === 'user' ? 'end' : 'start'}
            >
              <Box
                p="3"
                className={cn(
                  'rounded-md shadow-sm max-w-[85%] relative group', // Allow group hover for star/copy
                  message.sender === 'user'
                    ? 'bg-[--accent-a3] text-[--accent-a11]' // User message style
                    : 'bg-[--gray-a3] text-[--gray-a12]', // AI message style
                  // Add min-height if showing spinner to prevent layout jump
                  showSpinner && 'min-h-[4rem]' // Adjust as needed
                )}
              >
                {/* Star Button for User Messages */}
                {message.sender === 'user' && (
                  <Tooltip
                    content={
                      message.starred
                        ? 'Unstar this message'
                        : 'Star this message (Save as template)'
                    }
                  >
                    <IconButton
                      variant="ghost"
                      color={message.starred ? 'yellow' : 'gray'}
                      size="1"
                      className={cn(
                        'absolute top-1 right-1 p-0.5 transition-opacity z-10', // Ensure button is above text
                        message.starred
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                      )}
                      onClick={() => handleStarClick(message)}
                      aria-label={
                        message.starred ? 'Unstar message' : 'Star message'
                      }
                      disabled={starMutation.isPending}
                    >
                      {message.starred ? (
                        <StarFilledIcon width={14} height={14} />
                      ) : (
                        <StarIcon width={14} height={14} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}

                {/* Copy Button for AI Messages */}
                {showCopyButton && (
                  <Tooltip content="Copy message text">
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      className="absolute top-1 right-1 p-0.5 transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 z-10" // Ensure button is above text
                      onClick={() => handleCopyClick(message.text)}
                      aria-label="Copy message text"
                    >
                      <CopyIcon width={14} height={14} />
                    </IconButton>
                  </Tooltip>
                )}

                {/* Message Content */}
                {showSpinner ? (
                  <Flex align="center" justify="center" className="h-full">
                    <Spinner size="2" />
                    {/* Removed "Thinking..." as spinner indicates this */}
                  </Flex>
                ) : (
                  <>
                    {message.sender === 'ai' && renderMd ? (
                      <Box className="markdown-ai-message">
                        <ReactMarkdown>{message.text}</ReactMarkdown>
                        {showBlinkingCursor && (
                          <span
                            className="streaming-cursor"
                            style={{ animationPlayState: 'running' }}
                          ></span>
                        )}
                      </Box>
                    ) : (
                      <Text
                        size="2"
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {message.text || (isStreamingThisMessage ? '' : '...')}{' '}
                        {/* Show empty if streaming and no text yet */}
                        {showBlinkingCursor && (
                          <span
                            className="streaming-cursor"
                            style={{ animationPlayState: 'running' }}
                          ></span>
                        )}
                      </Text>
                    )}
                  </>
                )}
                {/* Display Starred Name if present */}
                {message.starred && message.starredName && (
                  <Flex
                    align="center"
                    gap="1"
                    mt="1"
                    justify={message.sender === 'user' ? 'end' : 'start'}
                  >
                    <StarFilledIcon
                      width={12}
                      height={12}
                      className="text-yellow-600"
                    />
                    <Text size="1" color="gray" style={{ fontStyle: 'italic' }}>
                      {message.starredName}
                    </Text>
                  </Flex>
                )}
              </Box>
            </Flex>
          );
        })}
        {/* Loading indicator if AI is responding but optimistic update hasn't added message yet */}
        {isAiResponding &&
          !streamingMessageId &&
          !messages.some((m) => m.id === streamingMessageId) && (
            <Flex align="center" gap="2" justify="start" mt="2">
              <Spinner size="2" />
              <Text color="gray" style={{ fontStyle: 'italic' }}>
                Thinking...
              </Text>
            </Flex>
          )}
      </Flex>

      {/* Star Naming Modal */}
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
                ref={starNameInputRef} // Attach ref for focus
                size="2"
                placeholder="Enter template name..."
                value={currentStarredName}
                onChange={(e) => setCurrentStarredName(e.target.value)}
                onKeyDown={handleStarNameKeyDown} // Add keydown handler
                disabled={starMutation.isPending}
                maxLength={50} // Optional: limit name length
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
