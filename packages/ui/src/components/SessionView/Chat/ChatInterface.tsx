// =========================================
// File: packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
// =========================================
/* packages/ui/src/components/SessionView/Chat/ChatInterface.tsx */
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatPanelHeader } from './ChatPanelHeader';
import { useMessageStream } from '../../../hooks/useMessageStream'; // <-- Import the hook
import {
    fetchSessionChatDetails, addSessionChatMessageStream, // Session APIs
    fetchStandaloneChatDetails, addStandaloneChatMessageStream, // Standalone APIs
} from '../../../api/api'; // <-- Use barrel file
import { debounce } from '../../../helpers';
import type { ChatSession, Session, ChatMessage, OllamaStatus } from '../../../types';
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

    const chatQueryKey = useMemo(() => isStandalone ? ['standaloneChat', activeChatId] : ['chat', activeSessionId, activeChatId], [isStandalone, activeChatId, activeSessionId]);

    const { data: chatData, isLoading: isLoadingMessages, error: chatError, isFetching } = useQuery<ChatSession | null, Error>({
        queryKey: chatQueryKey,
        queryFn: () => {
            if (activeChatId === null) return Promise.resolve(null);
            if (isStandalone) {
                return fetchStandaloneChatDetails(activeChatId);
            } else {
                if (!activeSessionId) {
                    console.warn("[ChatInterface] Attempting to fetch session chat without activeSessionId.");
                    return Promise.resolve(null);
                }
                return fetchSessionChatDetails(activeSessionId, activeChatId);
            }
        },
        enabled: activeChatId !== null && (isStandalone || activeSessionId !== null),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
    });

    // --- Use the custom hook for stream processing ---
    const { streamingAiMessageId, processStream } = useMessageStream({
        chatQueryKey: chatQueryKey,
        onStreamComplete: (key) => { console.log("[Stream Complete Callback] Invalidating chat query:", key); setTimeout(() => queryClient.invalidateQueries({ queryKey: key }), 100); },
        onStreamError: (error) => { console.error("[Stream Error Callback] Stream processing failed:", error); /* Optionally show toast */ }
    });
    // --- End hook usage ---

    const lastAiMessageWithTokens = useMemo(() => {
        if (!chatData?.messages || chatData.messages.length === 0) {
            return null;
        }
        return [...chatData.messages].reverse().find(msg => msg.sender === 'ai');
     }, [chatData]);

    const latestPromptTokens = lastAiMessageWithTokens?.promptTokens ?? null;
    const latestCompletionTokens = lastAiMessageWithTokens?.completionTokens ?? null;

    // Removed inline processStream function, now handled by the hook

     // Add Message Mutation
     const addMessageMutation = useMutation({
        mutationFn: async (text: string) => {
            if (!activeChatId) throw new Error("Chat ID missing");
            if (isStandalone) {
                return addStandaloneChatMessageStream(activeChatId, text);
            } else {
                if (!activeSessionId) throw new Error("Session ID missing for session chat");
                return addSessionChatMessageStream(activeSessionId, activeChatId, text);
            }
        },
        onMutate: async (newMessageText) => { // Optimistic update logic remains similar
            if (!activeChatId) return;
            // Use memoized key
            const currentChatQueryKey = chatQueryKey;
            await queryClient.cancelQueries({ queryKey: currentChatQueryKey });
            const previousChatData = queryClient.getQueryData<ChatSession>(currentChatQueryKey);
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
                ...(oldData ?? { id: activeChatId, sessionId: isStandalone ? null : activeSessionId, timestamp: Date.now(), name: 'Unknown Chat', messages: [] }),
                messages: [...(oldData?.messages ?? []), temporaryUserMessage, temporaryAiMessage],
            }));

            console.log('[Optimistic ChatInterface] Added temporary user message ID:', temporaryUserMessage.id);
            console.log('[Optimistic ChatInterface] Added temporary AI message ID:', tempAiMessageId);

            return { previousChatData, temporaryUserMessageId: temporaryUserMessage.id, tempAiMessageId };
        },
        onSuccess: (data, variables, context) => {
             console.log("Stream initiated successfully. Header User Msg ID:", data.userMessageId);
             if (!context?.tempAiMessageId) {
                  console.error("Missing temporary AI message ID in mutation context!");
                  throw new Error("Mutation context missing tempAiMessageId");
             }
             processStream(data.stream, context.temporaryUserMessageId, data.userMessageId, context.tempAiMessageId)
                 .catch(streamError => {
                     // Error is now also handled by the hook's onStreamError callback
                     console.error("Caught error from processStream in onSuccess:", streamError);
                     // The hook's finally block handles setting streaming ID to null
                     throw streamError;
                 });
             // Removed the direct call to setStreamingAiMessageId(null) from here
        },
        onError: (error, newMessageText, context) => {
            console.error("Mutation failed (Initiation or Stream Error):", error);
            // Use memoized key
            const currentChatQueryKey = chatQueryKey;
            if (context?.previousChatData && activeChatId && (isStandalone || activeSessionId)) {
                 queryClient.setQueryData(currentChatQueryKey, context.previousChatData);
                 console.log("[Mutation Error] Reverted optimistic user message.");
            }
            // The hook's finally block handles setting streaming ID to null
        },
        onSettled: () => {
            console.log("[Mutation Settled] Clearing input.");
            setCurrentQuery('');
             console.log('[ChatInterface Settled] Invalidating ollamaStatus query.');
             queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
        },
    });

    const chatMessages = chatData?.messages || [];
    const combinedIsLoading = (!isStandalone && isLoadingSessionMeta) || (isLoadingMessages && !chatData);

     // Scroll logic
     const debouncedScrollSave = useCallback(
         debounce((scrollTop: number) => { if (onScrollUpdate) { onScrollUpdate(scrollTop); } }, 150),
         [onScrollUpdate]
     );
     const handleScroll = useCallback(
         (event: React.UIEvent<HTMLDivElement>) => {
            if (!restoreScrollRef.current && event.currentTarget) { debouncedScrollSave(event.currentTarget.scrollTop); }
            if (restoreScrollRef.current) { restoreScrollRef.current = false; }
        },
         [debouncedScrollSave]
     );
     useEffect(() => { if (isTabActive) { restoreScrollRef.current = true; } else { restoreScrollRef.current = false; } }, [isTabActive]);
     useEffect(() => {
         if (restoreScrollRef.current && viewportRef.current) {
             requestAnimationFrame(() => { if (restoreScrollRef.current && viewportRef.current) { if (viewportRef.current.scrollTop !== initialScrollTop) { viewportRef.current.scrollTop = initialScrollTop; } else { restoreScrollRef.current = false; } } });
         }
     }, [isTabActive, initialScrollTop]);
     useEffect(() => {
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current && !combinedIsLoading) {
             if (chatContentRef.current) {
                 const shouldScroll = chatMessages.length > 0 || streamingAiMessageId !== null;
                 if (shouldScroll) {
                     const lastElement = chatContentRef.current.lastElementChild;
                     if (lastElement) {
                         requestAnimationFrame(() => { lastElement.scrollIntoView({ behavior: "smooth", block: "end" }); });
                     }
                 }
             }
         }
     }, [chatMessages.length, combinedIsLoading, isTabActive, streamingAiMessageId]);

    const isAiResponding = addMessageMutation.isPending || streamingAiMessageId !== null;

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)', overflow: 'hidden' }}>
            <ChatPanelHeader
                ollamaStatus={ollamaStatus}
                isLoadingStatus={isLoadingOllamaStatus}
                latestPromptTokens={latestPromptTokens}
                latestCompletionTokens={latestCompletionTokens}
                onOpenLlmModal={onOpenLlmModal}
            />

            <ScrollArea
                type="auto" scrollbars="vertical" ref={viewportRef} onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}
            >
                {combinedIsLoading && ( <Flex align="center" justify="center" style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--color-panel-translucent)', zIndex: 10, borderRadius: 'var(--radius-3)' }} ><Spinner size="3" /> <Text ml="2" color="gray">Loading messages...</Text></Flex> )}
                {chatError && !combinedIsLoading && ( <Flex justify="center" p="4"><Text color="red">Error loading chat: {chatError.message}</Text></Flex> )}

                <Box p="4" ref={chatContentRef} style={{ opacity: combinedIsLoading ? 0.5 : 1, transition: 'opacity 0.2s ease-in-out' }}>
                    <ChatMessages
                        messages={chatMessages}
                        activeChatId={activeChatId}
                        activeSessionId={activeSessionId} // Pass activeSessionId down
                        isStandalone={isStandalone}
                        streamingMessageId={streamingAiMessageId}
                    />
                </Box>
            </ScrollArea>

            <Box
                px="4" pt="4" pb="2"
                style={{ flexShrink: 0, borderTop: '1px solid var(--gray-a6)', backgroundColor: 'var(--color-panel-solid)', opacity: combinedIsLoading ? 0.6 : 1, transition: 'opacity 0.2s ease-in-out' }} >
                <ChatInput
                    isStandalone={isStandalone}
                    disabled={combinedIsLoading || !activeChatId || isAiResponding}
                    addMessageMutation={addMessageMutation}
                />
            </Box>
        </Flex>
    );
}
// TODO comments should not be removed
