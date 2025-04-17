// packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'; // Keep useQueryClient
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatPanelHeader } from './ChatPanelHeader';
import { fetchChatDetails, addChatMessage } from '../../../api/api';
import { debounce } from '../../../helpers';
import type { ChatSession, Session, ChatMessage, OllamaStatus } from '../../../types';
import { currentQueryAtom } from '../../../store';
import { useAtom } from 'jotai';

interface ChatInterfaceProps {
    session: Session | null;
    activeChatId: number | null;
    isLoadingSessionMeta?: boolean;
    ollamaStatus: OllamaStatus | undefined;
    isLoadingOllamaStatus: boolean;
    onOpenLlmModal: () => void;
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
}

// Helper function to create a temporary message ID
const createTemporaryId = () => Date.now();

export function ChatInterface({
    session,
    activeChatId,
    isLoadingSessionMeta,
    ollamaStatus,
    isLoadingOllamaStatus,
    onOpenLlmModal,
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
}: ChatInterfaceProps) {
    const activeSessionId = session?.id ?? null;

    const restoreScrollRef = useRef(false);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const queryClient = useQueryClient(); // Get query client instance
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);

    const [latestPromptTokens, setLatestPromptTokens] = useState<number | null>(null);
    const [latestCompletionTokens, setLatestCompletionTokens] = useState<number | null>(null);

    // Fetch chat details query
    const { data: chatData, isLoading: isLoadingMessages, error: chatError, isFetching } = useQuery<ChatSession | null, Error>({
        queryKey: ['chat', activeSessionId, activeChatId],
        queryFn: () => {
            if (!activeSessionId || activeChatId === null) return Promise.resolve(null);
            return fetchChatDetails(activeSessionId, activeChatId);
        },
        enabled: !!activeSessionId && activeChatId !== null,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
    });

     // Add Message Mutation
     const addMessageMutation = useMutation({
        mutationFn: (text: string) => {
            if (!activeSessionId || !activeChatId) {
                throw new Error("Session ID or Chat ID missing");
            }
            return addChatMessage(activeSessionId, activeChatId, text);
        },
        onMutate: async (newMessageText) => {
            if (!activeSessionId || !activeChatId) return;
            const queryKey = ['chat', activeSessionId, activeChatId];
            await queryClient.cancelQueries({ queryKey });
            const previousChatData = queryClient.getQueryData<ChatSession>(queryKey);
            const temporaryMessage: ChatMessage = { id: createTemporaryId(), sender: 'user', text: newMessageText };
            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => ({
                ...(oldData ?? { id: activeChatId, sessionId: activeSessionId, timestamp: Date.now(), name: 'Unknown Chat', messages: [] }),
                messages: [...(oldData?.messages ?? []), temporaryMessage],
            }));
            console.log('[Optimistic ChatInterface] Added temporary message ID:', temporaryMessage.id);
            return { previousChatData, temporaryMessageId: temporaryMessage.id };
        },
        onError: (error, newMessageText, context) => {
            console.error("Failed to send message:", error);
            if (context?.previousChatData && activeSessionId && activeChatId) {
                queryClient.setQueryData(['chat', activeSessionId, activeChatId], context.previousChatData);
            }
            // TODO: Show error toast
        },
        onSuccess: (data, newMessageText, context) => {
            if (!activeSessionId || !activeChatId || !context?.temporaryMessageId) return;
            const queryKey = ['chat', activeSessionId, activeChatId];
             console.log('[Optimistic ChatInterface] onSuccess: Replacing temp msg', context.temporaryMessageId, 'with real msg', data.userMessage.id, 'and adding AI msg', data.aiMessage.id);

            setLatestPromptTokens(data.aiMessage.promptTokens ?? null);
            setLatestCompletionTokens(data.aiMessage.completionTokens ?? null);

            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
                 if (!oldData) {
                      console.warn('[Optimistic onSuccess ChatInterface] Cache data missing unexpectedly.');
                      return { id: activeChatId, sessionId: activeSessionId, timestamp: Date.now(), name: 'Unknown Chat', messages: [data.userMessage, data.aiMessage] };
                 }
                 const messagesWithRealUser = (oldData.messages || []).map(msg =>
                     msg.id === context.temporaryMessageId ? data.userMessage : msg
                 );
                 return { ...oldData, messages: [...messagesWithRealUser, data.aiMessage] };
            });
            setCurrentQuery(''); // Clear input field

            // --- Invalidate Ollama Status Query ---
            // This tells Tanstack Query that the status data might be outdated
            // and should be refetched the next time it's needed (or immediately if observed).
            console.log('[ChatInterface] Invalidating ollamaStatus query after successful message send.');
            queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
            // --- End Invalidation ---

        },
         onSettled: (data, error, variables, context) => {
             if (activeSessionId && activeChatId) {
                 console.log('[Optimistic ChatInterface] onSettled: Invalidating chat query.');
                 queryClient.invalidateQueries({ queryKey: ['chat', activeSessionId, activeChatId] });
             }
         },
    });
    // --- End Mutation ---


    const chatMessages = chatData?.messages || [];
    const combinedIsLoading = isLoadingSessionMeta || isLoadingMessages;

     const debouncedScrollSave = useCallback(
         debounce((scrollTop: number) => {
             if (onScrollUpdate) {
                 onScrollUpdate(scrollTop);
             }
         }, 150),
     [onScrollUpdate]);

     const handleScroll = useCallback(
         (event: React.UIEvent<HTMLDivElement>) => {
            if (!restoreScrollRef.current && event.currentTarget) {
                debouncedScrollSave(event.currentTarget.scrollTop);
            }
            if (restoreScrollRef.current) {
                restoreScrollRef.current = false;
            }
        },
    [debouncedScrollSave]);

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

    // Scroll to bottom effect
    useEffect(() => {
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current && !combinedIsLoading && chatMessages.length > 0) {
            if (chatContentRef.current) {
                const lastElement = chatContentRef.current.lastElementChild;
                if (lastElement) {
                    requestAnimationFrame(() => {
                        lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
                    });
                }
            }
        }
    }, [chatMessages.length, combinedIsLoading, isTabActive]);


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)', overflow: 'hidden' }}>
            {/* Use ChatPanelHeader */}
            <ChatPanelHeader
                ollamaStatus={ollamaStatus}
                isLoadingStatus={isLoadingOllamaStatus}
                latestPromptTokens={latestPromptTokens}
                latestCompletionTokens={latestCompletionTokens}
                onOpenLlmModal={onOpenLlmModal}
            />
            {/* End Header */}

            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}
            >
                {/* Loading/Error states */}
                {combinedIsLoading && (
                    <Flex align="center" justify="center" style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--color-panel-translucent)', zIndex: 10, borderRadius: 'var(--radius-3)' }} >
                        <Spinner size="3" /> <Text ml="2" color="gray">Loading messages...</Text>
                    </Flex>
                )}
                 {chatError && !combinedIsLoading && (
                     <Flex justify="center" p="4"><Text color="red">Error loading chat: {chatError.message}</Text></Flex>
                 )}

                <Box p="4" ref={chatContentRef} style={{ opacity: combinedIsLoading ? 0.5 : 1, transition: 'opacity 0.2s ease-in-out' }}>
                    <ChatMessages messages={chatMessages} activeChatId={activeChatId} />
                </Box>
            </ScrollArea>

            <Box
                px="4" pt="4" pb="2"
                style={{ flexShrink: 0, borderTop: '1px solid var(--gray-a6)', backgroundColor: 'var(--color-panel-solid)', opacity: combinedIsLoading ? 0.6 : 1, transition: 'opacity 0.2s ease-in-out' }} >
                <ChatInput
                    disabled={combinedIsLoading || !activeChatId}
                    addMessageMutation={addMessageMutation}
                />
            </Box>
        </Flex>
    );
}
