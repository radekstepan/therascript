// packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useMemo,
} from 'react';
import { Box, Flex, Spinner, Text } from '@radix-ui/themes';
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
import {
  currentQueryAtom,
  toastMessageAtom,
  activeLlmJobsAtom,
} from '../../../store';
import type { ActiveLlmJob } from '../../../store';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';

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
type StreamPhase = 'thinking' | 'responding';

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

  const queryClient = useQueryClient();
  const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
  const setToastMessage = useSetAtom(toastMessageAtom);
  const setActiveLlmJobs = useSetAtom(activeLlmJobsAtom);

  const [streamingAiMessageId, setStreamingAiMessageId] = useState<
    number | null
  >(null);
  const [streamPhase, setStreamPhase] = useState<StreamPhase | null>(null);
  const [streamingStartTime, setStreamingStartTime] = useState<number | null>(
    null
  );
  const [streamingTokensCount, setStreamingTokensCount] = useState<number>(0);
  const [currentTokensPerSecond, setCurrentTokensPerSecond] = useState<
    number | null
  >(null);

  const activeStreamControllerRef = useRef<AbortController | null>(null);
  const cancelRequestedRef = useRef(false);

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

  // --- Context for re-mounting/persistent jobs ---
  const activeLlmJobs = useAtomValue(activeLlmJobsAtom);
  const currentJob = useMemo(
    () => activeLlmJobs.find((j: ActiveLlmJob) => j.chatId === activeChatId),
    [activeLlmJobs, activeChatId]
  );

  // Abort stream only when switching to a different chat ID
  const prevChatIdRef = useRef<number | null>(activeChatId);
  useEffect(() => {
    if (prevChatIdRef.current !== activeChatId) {
      // Truly switched chats - find and abort the stream for the previous chat
      const prevJob = activeLlmJobs.find(
        (j: ActiveLlmJob) => j.chatId === prevChatIdRef.current
      );
      if (prevJob?.controller) {
        prevJob.controller.abort();
      }
      prevChatIdRef.current = activeChatId;
    }
  }, [activeChatId, activeLlmJobs]);

  const handleCancelStream = useCallback(() => {
    if (!currentJob?.controller) return;
    currentJob.controller.abort();
    // Mark job as canceling
    setActiveLlmJobs((prev) =>
      prev.map((j) =>
        j.chatId === activeChatId ? { ...j, status: 'canceling' as const } : j
      )
    );
  }, [activeChatId, setActiveLlmJobs, currentJob]);

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
    let localStartTime: number | null = null;
    let localTokenCount = 0;
    let hasOpenThinkingBlock = false;

    setStreamPhase('thinking');
    setStreamingStartTime(null);
    setStreamingTokensCount(0);
    setCurrentTokensPerSecond(null);

    try {
      const updateLiveTokenMetrics = (chunkText: string) => {
        if (!chunkText) {
          return;
        }

        if (localStartTime === null) {
          localStartTime = Date.now();
          setStreamingStartTime(localStartTime);
        }

        const estimatedTokens = Math.max(1, Math.floor(chunkText.length / 4));
        localTokenCount += estimatedTokens;
        setStreamingTokensCount(localTokenCount);

        const elapsedMs = Date.now() - localStartTime;
        const elapsedSeconds = elapsedMs / 1000;
        if (elapsedSeconds > 0) {
          setCurrentTokensPerSecond(localTokenCount / elapsedSeconds);
        }
      };

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
              } else if (data.usage) {
                if (activeChatId) {
                  if (isStandalone) {
                    queryClient.setQueryData(
                      ['contextUsage', 'standalone', activeChatId],
                      data.usage
                    );
                  } else if (activeSessionId) {
                    queryClient.setQueryData(
                      [
                        'contextUsage',
                        'session',
                        activeSessionId,
                        activeChatId,
                      ],
                      data.usage
                    );
                  }
                }
              } else if (
                data.status === 'thinking' ||
                data.status === 'responding'
              ) {
                if (data.status === 'responding' && hasOpenThinkingBlock) {
                  hasOpenThinkingBlock = false;
                  queryClient.setQueryData<ChatSession>(
                    currentChatQueryKey,
                    (oldData) => {
                      if (!oldData) return oldData;
                      const currentMessages = oldData.messages ?? [];
                      return {
                        ...oldData,
                        messages: currentMessages.map((msg) =>
                          msg.id === tempAiMessageId
                            ? { ...msg, text: msg.text + '</think>' }
                            : msg
                        ),
                      };
                    }
                  );
                }
                setStreamPhase(data.status);
              } else if (data.thinkingChunk) {
                setStreamPhase('thinking');
                updateLiveTokenMetrics(data.thinkingChunk);
                queryClient.setQueryData<ChatSession>(
                  currentChatQueryKey,
                  (oldData) => {
                    if (!oldData) return oldData;
                    const currentMessages = oldData.messages ?? [];
                    return {
                      ...oldData,
                      messages: currentMessages.map((msg) => {
                        if (msg.id !== tempAiMessageId) {
                          return msg;
                        }
                        const prefix = hasOpenThinkingBlock ? '' : '<think>';
                        return {
                          ...msg,
                          text: msg.text + prefix + data.thinkingChunk,
                        };
                      }),
                    };
                  }
                );
                hasOpenThinkingBlock = true;
              } else if (data.chunk) {
                setStreamPhase('responding');
                updateLiveTokenMetrics(data.chunk);
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
                if (hasOpenThinkingBlock) {
                  hasOpenThinkingBlock = false;
                  queryClient.setQueryData<ChatSession>(
                    currentChatQueryKey,
                    (oldData) => {
                      if (!oldData) return oldData;
                      const currentMessages = oldData.messages ?? [];
                      return {
                        ...oldData,
                        messages: currentMessages.map((msg) =>
                          msg.id === tempAiMessageId
                            ? { ...msg, text: msg.text + '</think>' }
                            : msg
                        ),
                      };
                    }
                  );
                }
                const completionTokens =
                  data.completionTokens ?? localTokenCount;
                const duration = data.duration ?? null;
                const isTruncated = data.isTruncated ?? false;
                const tokensPerSecond =
                  duration && completionTokens
                    ? (completionTokens * 1000) / duration
                    : null;
                queryClient.setQueryData<ChatSession>(
                  currentChatQueryKey,
                  (oldData) => {
                    if (!oldData) return oldData;
                    const currentMessages = oldData.messages ?? [];
                    return {
                      ...oldData,
                      messages: currentMessages.map((msg) =>
                        msg.id === tempAiMessageId
                          ? {
                              ...msg,
                              completionTokens,
                              duration,
                              isTruncated,
                            }
                          : msg
                      ),
                    };
                  }
                );
                setStreamingAiMessageId(null);
                setStreamPhase(null);
                setStreamingStartTime(null);
                setStreamingTokensCount(0);
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
                setToastMessage(`Chat Error: ${data.error}`);
                streamErrored = true;
              }
            } catch (e) {
              console.error('SSE parse error', e);
            }
          }
        }
      }
    } catch (error: any) {
      const isAbort =
        cancelRequestedRef.current || error?.name === 'AbortError';
      if (!isAbort) {
        console.error('Error reading stream:', error);
        streamErrored = true;
      }
    } finally {
      if (hasOpenThinkingBlock) {
        queryClient.setQueryData<ChatSession>(
          currentChatQueryKey,
          (oldData) => {
            if (!oldData) return oldData;
            const currentMessages = oldData.messages ?? [];
            return {
              ...oldData,
              messages: currentMessages.map((msg) =>
                msg.id === tempAiMessageId
                  ? { ...msg, text: msg.text + '</think>' }
                  : msg
              ),
            };
          }
        );
      }
      activeStreamControllerRef.current = null;
      cancelRequestedRef.current = false;
      setStreamingAiMessageId(null);
      setStreamPhase(null);
      setStreamingStartTime(null);
      setStreamingTokensCount(0);
      setCurrentTokensPerSecond(null);
      // Remove LLM job
      if (activeChatId) {
        setActiveLlmJobs((prev) =>
          prev.filter((j) => j.chatId !== activeChatId)
        );
      }
      if (activeChatId) {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: currentChatQueryKey });
        }, 100);
      }
    }
  };

  const addMessageMutation = useMutation<
    { userMessageId: number; stream: ReadableStream<Uint8Array> },
    Error,
    { text: string; tempAiMessageId: number },
    {
      previousChatData: ChatSession | undefined;
      temporaryUserMessageId: number;
      tempAiMessageId: number;
    }
  >({
    mutationFn: async ({
      text,
      tempAiMessageId,
    }: {
      text: string;
      tempAiMessageId: number;
    }) => {
      if (!activeChatId) throw new Error('Chat ID missing');
      cancelRequestedRef.current = false;
      // Abort any existing stream for THIS chat specifically
      if (currentJob?.controller) {
        currentJob.controller.abort();
      }

      const controller = new AbortController();
      // Store the controller in the global job atom immediately
      setActiveLlmJobs((prev) =>
        prev.map((j: ActiveLlmJob) =>
          j.id === tempAiMessageId ? { ...j, controller } : j
        )
      );

      const opts = { signal: controller.signal };
      if (isStandalone) {
        return addStandaloneChatMessageStream(activeChatId, text, opts);
      } else {
        if (!activeSessionId)
          throw new Error('Session ID missing for session chat');
        return addSessionChatMessageStream(
          activeSessionId,
          activeChatId,
          text,
          opts
        );
      }
    },
    onMutate: async (variables) => {
      const { text, tempAiMessageId } = variables;
      if (!activeChatId) return;
      const currentChatQueryKey = chatQueryKey;
      await queryClient.cancelQueries({ queryKey: currentChatQueryKey });
      const previousChatData =
        queryClient.getQueryData<ChatSession>(currentChatQueryKey);
      const temporaryUserMessage: ChatMessage = {
        id: createTemporaryId(),
        chatId: activeChatId,
        sender: 'user',
        text: text,
        timestamp: Date.now(),
      };
      const temporaryAiMessage: ChatMessage = {
        id: tempAiMessageId,
        chatId: activeChatId,
        sender: 'ai',
        text: '',
        timestamp: Date.now(),
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
      setStreamPhase('thinking');
      // Register active LLM job
      setActiveLlmJobs((prev) => [
        ...prev,
        {
          id: tempAiMessageId,
          chatId: activeChatId,
          sessionId: isStandalone ? null : activeSessionId,
          isStandalone,
          promptPreview: text.length > 80 ? text.slice(0, 80) + '…' : text,
          startedAt: Date.now(),
          status: 'responding',
        },
      ]);
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
        setStreamPhase(null);
        throw streamError; // Rethrow to be caught by mutation's onError
      });
    },
    onError: (error, newMessageText, context) => {
      const isAbort =
        cancelRequestedRef.current || error?.name === 'AbortError';
      if (!isAbort) {
        console.error('Mutation failed (Initiation or Stream Error):', error);
      }
      const currentChatQueryKey = chatQueryKey;
      if (
        context?.previousChatData &&
        activeChatId &&
        (isStandalone || activeSessionId)
      ) {
        queryClient.setQueryData(currentChatQueryKey, context.previousChatData);
      }
      activeStreamControllerRef.current = null;
      cancelRequestedRef.current = false;
      setStreamingAiMessageId(null);
      setStreamPhase(null);
      // Remove LLM job
      if (activeChatId) {
        setActiveLlmJobs((prev) =>
          prev.filter((j) => j.chatId !== activeChatId)
        );
      }
    },
    onSettled: () => {
      setCurrentQuery('');
      queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
    },
  });

  const chatMessages = chatData?.messages || [];
  const combinedIsLoading =
    (!isStandalone && isLoadingSessionMeta) || (isLoadingMessages && !chatData);

  const isAiResponding =
    addMessageMutation.isPending || streamingAiMessageId !== null;

  const handleSendMessage = (text: string) => {
    const tempAiMessageId = createTemporaryId();
    addMessageMutation.mutate({ text, tempAiMessageId });
  };

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

      <Box style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}>
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
          <Flex
            justify="center"
            p="4"
            style={{ position: 'absolute', inset: 0, zIndex: 5 }}
          >
            <Text color="red">Error loading chat: {chatError.message}</Text>
          </Flex>
        )}
        {!combinedIsLoading && !chatError && (
          <Box
            style={{
              height: '100%',
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
              streamingPhase={streamPhase}
              isAiResponding={isAiResponding}
              streamingTokensPerSecond={
                streamingAiMessageId ? currentTokensPerSecond : null
              }
            />
          </Box>
        )}
      </Box>

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
          disabled={combinedIsLoading || !activeChatId}
          isAiResponding={isAiResponding}
          onCancelStream={handleCancelStream}
          addMessageMutation={addMessageMutation}
          transcriptTokenCount={transcriptTokenCount} // <-- PASS PROP
        />
      </Box>
    </Flex>
  );
}
