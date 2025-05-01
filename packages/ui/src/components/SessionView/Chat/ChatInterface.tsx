/* packages/ui/src/components/SessionView/Chat/ChatInterface.tsx */
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatPanelHeader } from './ChatPanelHeader';
import {
  fetchSessionChatDetails,
  addSessionChatMessageStream, // Session APIs
  fetchStandaloneChatDetails,
  addStandaloneChatMessageStream, // Standalone APIs
} from '../../../api/api';
import { debounce } from '../../../helpers';
import type {
  ChatSession,
  Session,
  ChatMessage,
  OllamaStatus,
} from '../../../types';
import { currentQueryAtom } from '../../../store';
import { useAtom } from 'jotai';

interface ChatInterfaceProps {
  session?: Session | null;
  activeChatId: number | null;
  isStandalone: boolean;
  isLoadingSessionMeta?: boolean;
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  onOpenLlmModal: () => void;
  isTabActive?: boolean;
  initialScrollTop?: number;
  onScrollUpdate?: (scrollTop: number) => void;
}

const createTemporaryId = (): number => -Math.floor(Math.random() * 1000000);

export function ChatInterface({
  session,
  activeChatId,
  isStandalone,
  isLoadingSessionMeta,
  ollamaStatus,
  isLoadingOllamaStatus,
  onOpenLlmModal,
  isTabActive,
  initialScrollTop = 0,
  onScrollUpdate,
}: ChatInterfaceProps) {
  // Get activeSessionId from the session prop IF it exists
  const activeSessionId = session?.id ?? null;

  const restoreScrollRef = useRef(false);
  const chatContentRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);

  const [streamingAiMessageId, setStreamingAiMessageId] = useState<
    number | null
  >(null);

  const chatQueryKey = useMemo(
    () =>
      isStandalone
        ? ['standaloneChat', activeChatId]
        : ['chat', activeSessionId, activeChatId],
    [isStandalone, activeChatId, activeSessionId]
  );

  const {
    data: chatData,
    isLoading: isLoadingMessages,
    error: chatError,
    isFetching,
  } = useQuery<ChatSession | null, Error>({
    queryKey: chatQueryKey,
    queryFn: () => {
      if (activeChatId === null) return Promise.resolve(null);
      if (isStandalone) {
        return fetchStandaloneChatDetails(activeChatId);
      } else {
        if (!activeSessionId) {
          console.warn(
            '[ChatInterface] Attempting to fetch session chat without activeSessionId.'
          );
          return Promise.resolve(null);
        }
        return fetchSessionChatDetails(activeSessionId, activeChatId);
      }
    },
    enabled:
      activeChatId !== null && (isStandalone || activeSessionId !== null),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const lastAiMessageWithTokens = useMemo(() => {
    if (!chatData?.messages || chatData.messages.length === 0) {
      return null;
    }
    return [...chatData.messages].reverse().find((msg) => msg.sender === 'ai');
  }, [chatData]);

  const latestPromptTokens = lastAiMessageWithTokens?.promptTokens ?? null;
  const latestCompletionTokens =
    lastAiMessageWithTokens?.completionTokens ?? null;

  // Process Stream Function
  const processStream = async (
    stream: ReadableStream<Uint8Array>,
    tempUserMsgId: number | undefined,
    receivedUserMsgId: number,
    tempAiMessageId: number
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let actualUserMessageId = receivedUserMsgId;
    // Use the memoized key
    const currentChatQueryKey = chatQueryKey;
    let streamErrored = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.substring(5).trim();
            try {
              const data = JSON.parse(dataStr);
              if (data.userMessageId && actualUserMessageId === -1) {
                actualUserMessageId = data.userMessageId;
                console.log(
                  'Received user message ID via SSE:',
                  actualUserMessageId
                );
                if (
                  tempUserMsgId &&
                  activeChatId &&
                  (isStandalone || activeSessionId)
                ) {
                  queryClient.setQueryData<ChatSession>(
                    currentChatQueryKey,
                    (oldData) => {
                      if (!oldData) return oldData;
                      const currentMessages = oldData.messages ?? [];
                      return {
                        ...oldData,
                        messages: currentMessages.map((msg) =>
                          msg.id === tempUserMsgId
                            ? { ...msg, id: actualUserMessageId }
                            : msg
                        ),
                      };
                    }
                  );
                }
              } else if (data.chunk) {
                // Update the temporary AI message in the query cache
                queryClient.setQueryData<ChatSession>(
                  currentChatQueryKey,
                  (oldData) => {
                    if (!oldData) return oldData;
                    const currentMessages = oldData.messages ?? [];
                    return {
                      ...oldData,
                      messages: currentMessages.map((msg) =>
                        msg.id === tempAiMessageId
                          ? { ...msg, text: msg.text + data.chunk }
                          : msg
                      ),
                    };
                  }
                );
              } else if (data.done) {
                console.log(
                  'Stream processing received done signal. Tokens:',
                  data
                );
                // Clear the streaming ID *before* invalidating
                setStreamingAiMessageId(null);

                if (activeChatId && !streamErrored) {
                  console.log(
                    '[Stream Done] Stream completed without error. Invalidating chat query.'
                  );
                  // Invalidate query to fetch the final message with tokens
                  setTimeout(() => {
                    queryClient.invalidateQueries({
                      queryKey: currentChatQueryKey,
                    });
                  }, 100);
                }
                // Stop processing further chunks after 'done'
                return;
              } else if (data.error) {
                console.error(
                  'Received error event from backend stream:',
                  data.error
                );
                streamErrored = true;
              }
            } catch (e) {
              console.error('SSE parse error', e);
            }
          }
        }
      }
      console.log(
        "Stream processing loop complete (no 'done' event received?)."
      );
    } catch (error) {
      console.error('Error reading stream:', error);
      streamErrored = true;
    } finally {
      // --- Final Cleanup ---
      console.log(
        `[Stream Finally] Clearing streaming message ID: ${tempAiMessageId}. Stream Errored: ${streamErrored}`
      );
      setStreamingAiMessageId(null); // Ensure it's cleared even if loop finishes without 'done'

      // Invalidate only if the stream didn't error AND didn't receive a 'done' event (unlikely)
      if (activeChatId && !streamErrored) {
        console.warn(
          "[Stream Finally] Stream ended without 'done' signal and no error. Invalidating query as fallback."
        );
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: currentChatQueryKey });
        }, 100);
      } else if (streamErrored) {
        console.warn(
          '[Stream Finally] Stream ended with an error. Skipping final query invalidation.'
        );
      }
    }
  };

  // Add Message Mutation
  const addMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!activeChatId) throw new Error('Chat ID missing');
      if (isStandalone) {
        return addStandaloneChatMessageStream(activeChatId, text);
      } else {
        if (!activeSessionId)
          throw new Error('Session ID missing for session chat');
        return addSessionChatMessageStream(activeSessionId, activeChatId, text);
      }
    },
    onMutate: async (newMessageText) => {
      if (!activeChatId) return;
      // Use memoized key
      const currentChatQueryKey = chatQueryKey;
      await queryClient.cancelQueries({ queryKey: currentChatQueryKey });
      const previousChatData =
        queryClient.getQueryData<ChatSession>(currentChatQueryKey);
      const temporaryUserMessage: ChatMessage = {
        id: createTemporaryId(),
        chatId: activeChatId,
        sender: 'user',
        text: newMessageText,
        timestamp: Date.now(),
        starred: false,
      };
      const tempAiMessageId = createTemporaryId();
      const temporaryAiMessage: ChatMessage = {
        id: tempAiMessageId,
        chatId: activeChatId,
        sender: 'ai',
        text: '', // Start AI message as empty
        timestamp: Date.now(),
        starred: false,
      };

      queryClient.setQueryData<ChatSession>(currentChatQueryKey, (oldData) => ({
        ...(oldData ?? {
          id: activeChatId,
          sessionId: isStandalone ? null : activeSessionId,
          timestamp: Date.now(),
          name: 'Unknown Chat',
          messages: [],
        }),
        messages: [
          ...(oldData?.messages ?? []),
          temporaryUserMessage,
          temporaryAiMessage,
        ],
      }));

      setStreamingAiMessageId(tempAiMessageId); // Set the streaming ID

      console.log(
        '[Optimistic ChatInterface] Added temporary user message ID:',
        temporaryUserMessage.id
      );
      console.log(
        '[Optimistic ChatInterface] Added temporary AI message ID:',
        tempAiMessageId
      );

      return {
        previousChatData,
        temporaryUserMessageId: temporaryUserMessage.id,
        tempAiMessageId,
      };
    },
    onSuccess: (data, variables, context) => {
      console.log(
        'Stream initiated successfully. Header User Msg ID:',
        data.userMessageId
      );
      if (!context?.tempAiMessageId) {
        console.error('Missing temporary AI message ID in mutation context!');
        throw new Error('Mutation context missing tempAiMessageId');
      }
      // Start processing the stream
      processStream(
        data.stream,
        context.temporaryUserMessageId,
        data.userMessageId,
        context.tempAiMessageId
      ).catch((streamError) => {
        console.error(
          'Caught error from processStream in onSuccess:',
          streamError
        );
        setStreamingAiMessageId(null); // Clear streaming ID on error
        // Re-throw or handle as needed, mutation's onError will also catch it
        throw streamError;
      });
    },
    onError: (error, newMessageText, context) => {
      console.error('Mutation failed (Initiation or Stream Error):', error);
      // Use memoized key
      const currentChatQueryKey = chatQueryKey;
      if (
        context?.previousChatData &&
        activeChatId &&
        (isStandalone || activeSessionId)
      ) {
        queryClient.setQueryData(currentChatQueryKey, context.previousChatData);
        console.log('[Mutation Error] Reverted optimistic user message.');
      }
      setStreamingAiMessageId(null); // Ensure streaming ID is cleared on error
    },
    onSettled: () => {
      console.log('[Mutation Settled] Clearing input.');
      setCurrentQuery(''); // Clear input after mutation settles (success or error)
      console.log('[ChatInterface Settled] Invalidating ollamaStatus query.');
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
    },
  });

  const chatMessages = chatData?.messages || [];
  const combinedIsLoading =
    (!isStandalone && isLoadingSessionMeta) || (isLoadingMessages && !chatData);

  // Scroll logic
  const debouncedScrollSave = useCallback(
    debounce((scrollTop: number) => {
      if (onScrollUpdate) {
        onScrollUpdate(scrollTop);
      }
    }, 150),
    [onScrollUpdate]
  );
  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (!restoreScrollRef.current && event.currentTarget) {
        debouncedScrollSave(event.currentTarget.scrollTop);
      }
      if (restoreScrollRef.current) {
        restoreScrollRef.current = false;
      }
    },
    [debouncedScrollSave]
  );
  useEffect(() => {
    if (isTabActive) {
      restoreScrollRef.current = true;
    } else {
      restoreScrollRef.current = false;
    }
  }, [isTabActive]);
  useEffect(() => {
    if (restoreScrollRef.current && viewportRef.current) {
      requestAnimationFrame(() => {
        if (restoreScrollRef.current && viewportRef.current) {
          if (viewportRef.current.scrollTop !== initialScrollTop) {
            viewportRef.current.scrollTop = initialScrollTop;
          } else {
            restoreScrollRef.current = false;
          }
        }
      });
    }
  }, [isTabActive, initialScrollTop]);
  useEffect(() => {
    if (
      (isTabActive === undefined || isTabActive) &&
      !restoreScrollRef.current &&
      !combinedIsLoading
    ) {
      if (chatContentRef.current) {
        const shouldScroll =
          chatMessages.length > 0 || streamingAiMessageId !== null;
        if (shouldScroll) {
          const lastElement = chatContentRef.current.lastElementChild;
          if (lastElement) {
            requestAnimationFrame(() => {
              lastElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
            });
          }
        }
      }
    }
  }, [
    chatMessages.length,
    combinedIsLoading,
    isTabActive,
    streamingAiMessageId,
  ]);

  // Determine if AI is actively responding (mutation pending OR streaming in progress)
  const isAiResponding =
    addMessageMutation.isPending || streamingAiMessageId !== null;

  return (
    <Flex
      direction="column"
      style={{
        height: '100%',
        minHeight: 0,
        border: '1px solid var(--gray-a6)',
        borderRadius: 'var(--radius-3)',
        overflow: 'hidden',
      }}
    >
      <ChatPanelHeader
        ollamaStatus={ollamaStatus}
        isLoadingStatus={isLoadingOllamaStatus}
        latestPromptTokens={latestPromptTokens}
        latestCompletionTokens={latestCompletionTokens}
        onOpenLlmModal={onOpenLlmModal}
      />

      <ScrollArea
        type="auto"
        scrollbars="vertical"
        ref={viewportRef}
        onScroll={handleScroll}
        style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}
      >
        {combinedIsLoading && (
          <Flex
            align="center"
            justify="center"
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: 'var(--color-panel-translucent)',
              zIndex: 10,
              borderRadius: 'var(--radius-3)',
            }}
          >
            <Spinner size="3" />{' '}
            <Text ml="2" color="gray">
              Loading messages...
            </Text>
          </Flex>
        )}
        {chatError && !combinedIsLoading && (
          <Flex justify="center" p="4">
            <Text color="red">Error loading chat: {chatError.message}</Text>
          </Flex>
        )}

        <Box
          p="4"
          ref={chatContentRef}
          style={{
            opacity: combinedIsLoading ? 0.5 : 1,
            transition: 'opacity 0.2s ease-in-out',
          }}
        >
          <ChatMessages
            messages={chatMessages}
            activeChatId={activeChatId}
            activeSessionId={activeSessionId} // Pass activeSessionId down
            isStandalone={isStandalone}
            streamingMessageId={streamingAiMessageId}
            isAiResponding={addMessageMutation.isPending} // Pass down the mutation pending state
          />
        </Box>
      </ScrollArea>

      <Box
        px="4"
        pt="4"
        pb="2"
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--gray-a6)',
          backgroundColor: 'var(--color-panel-solid)',
          opacity: combinedIsLoading ? 0.6 : 1,
          transition: 'opacity 0.2s ease-in-out',
        }}
      >
        <ChatInput
          isStandalone={isStandalone}
          disabled={combinedIsLoading || !activeChatId || isAiResponding} // Disable input while AI is responding
          addMessageMutation={addMessageMutation}
        />
      </Box>
    </Flex>
  );
}
// TODO comments should not be removed
