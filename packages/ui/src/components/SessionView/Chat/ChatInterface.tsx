// packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
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
  addSessionChatMessageStream,
  fetchStandaloneChatDetails,
  addStandaloneChatMessageStream,
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
  session?: Session | null; // Optional for standalone
  activeChatId: number | null;
  isStandalone: boolean;
  isLoadingSessionMeta?: boolean; // Optional for standalone
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  onOpenLlmModal: () => void;
  isTabActive?: boolean; // For tabbed layout on small screens
  transcriptTokenCount?: number | null; // <-- ADDED
  activeModelDefaultContextSize?: number | null; // <-- ADDED
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
  transcriptTokenCount, // <-- DESTRUCTURED
  activeModelDefaultContextSize, // <-- DESTRUCTURED
}: ChatInterfaceProps) {
  const activeSessionId = session?.id ?? null;

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
                setStreamingAiMessageId(null);
                if (activeChatId && !streamErrored) {
                  setTimeout(() => {
                    queryClient.invalidateQueries({
                      queryKey: currentChatQueryKey,
                    });
                  }, 100);
                }
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
    } catch (error) {
      console.error('Error reading stream:', error);
      streamErrored = true;
    } finally {
      setStreamingAiMessageId(null);
      if (activeChatId && !streamErrored) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: currentChatQueryKey });
        }, 100);
      }
    }
  };

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
        text: '',
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
      setStreamingAiMessageId(tempAiMessageId);
      return {
        previousChatData,
        temporaryUserMessageId: temporaryUserMessage.id,
        tempAiMessageId,
      };
    },
    onSuccess: (data, variables, context) => {
      if (!context?.tempAiMessageId) {
        console.error('Missing temporary AI message ID in mutation context!');
        throw new Error('Mutation context missing tempAiMessageId');
      }
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
        setStreamingAiMessageId(null);
        throw streamError; // Rethrow to be caught by mutation's onError
      });
    },
    onError: (error, newMessageText, context) => {
      console.error('Mutation failed (Initiation or Stream Error):', error);
      const currentChatQueryKey = chatQueryKey;
      if (
        context?.previousChatData &&
        activeChatId &&
        (isStandalone || activeSessionId)
      ) {
        queryClient.setQueryData(currentChatQueryKey, context.previousChatData);
      }
      setStreamingAiMessageId(null);
    },
    onSettled: () => {
      setCurrentQuery('');
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
    },
  });

  const chatMessages = chatData?.messages || [];
  const combinedIsLoading =
    (!isStandalone && isLoadingSessionMeta) || (isLoadingMessages && !chatData);

  // Auto-scroll logic
  useEffect(() => {
    // Check if the tab is active or if tab-based behavior is not applicable
    if (isTabActive === undefined || isTabActive) {
      if (!combinedIsLoading && chatContentRef.current) {
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

  const isAiResponding =
    addMessageMutation.isPending || streamingAiMessageId !== null;

  return (
    <Flex
      direction="column"
      style={{
        height: '100%', // Fill parent height
        minHeight: 0, // Essential for flex child
        border: '1px solid var(--gray-a6)',
        borderRadius: 'var(--radius-3)',
        overflow: 'hidden', // Prevent this Flex from scrolling
        backgroundColor: 'var(--color-panel-translucent)',
      }}
    >
      {!isStandalone && session && (
        <ChatPanelHeader // Fixed height
          session={session}
          activeChatId={activeChatId}
          ollamaStatus={ollamaStatus}
          isLoadingOllamaStatus={isLoadingOllamaStatus}
          latestPromptTokens={latestPromptTokens}
          latestCompletionTokens={latestCompletionTokens}
          onOpenLlmModal={onOpenLlmModal}
          transcriptTokenCount={transcriptTokenCount} // <-- PASS PROP
          activeModelDefaultContextSize={activeModelDefaultContextSize} // <-- PASS PROP
        />
      )}

      <ScrollArea // This is the scrollable part for messages
        type="auto"
        scrollbars="vertical"
        ref={viewportRef} // Keep if needed for other scroll logic
        style={{ flexGrow: 1, minHeight: 0, position: 'relative' }} // Crucial: flexGrow and minHeight: 0
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

        <Box // Padding container for messages
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
            activeSessionId={activeSessionId}
            isStandalone={isStandalone}
            streamingMessageId={streamingAiMessageId}
            isAiResponding={addMessageMutation.isPending}
          />
        </Box>
      </ScrollArea>

      <Box // Chat input area, fixed height
        px="4"
        pt="4"
        pb="2"
        style={{
          flexShrink: 0,
          borderTop: '1px solid var(--gray-a6)',
          opacity: combinedIsLoading ? 0.6 : 1,
          transition: 'opacity 0.2s ease-in-out',
        }}
      >
        <ChatInput
          isStandalone={isStandalone}
          disabled={combinedIsLoading || !activeChatId || isAiResponding}
          addMessageMutation={addMessageMutation}
        />
      </Box>
    </Flex>
  );
}
