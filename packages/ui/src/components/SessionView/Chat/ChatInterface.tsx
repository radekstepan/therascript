// Path: packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatPanelHeader } from './ChatPanelHeader';
import {
    fetchSessionChatDetails, addSessionChatMessageStream, // Session APIs
    fetchStandaloneChatDetails, addStandaloneChatMessageStream, // Standalone APIs
} from '../../../api/api';
import { debounce } from '../../../helpers';
import type { ChatSession, Session, ChatMessage, OllamaStatus } from '../../../types';
import { currentQueryAtom } from '../../../store';
import { useAtom } from 'jotai';

interface ChatInterfaceProps {
    session?: Session | null; // Re-add session prop, make it optional
    activeChatId: number | null;
    isStandalone: boolean; // Keep flag
    isLoadingSessionMeta?: boolean;
    ollamaStatus: OllamaStatus | undefined;
    isLoadingOllamaStatus: boolean;
    onOpenLlmModal: () => void;
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
}

// Helper function to create temporary message IDs
const createTemporaryId = (): number => -Math.floor(Math.random() * 1000000); // Negative for user
const createTemporaryAiId = (): number => -Math.floor(Math.random() * 1000000) - 1000000; // Different range for AI

export function ChatInterface({
    session, // Use the optional session prop
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
    // Derive session ID only if session exists
    const activeSessionId = session?.id ?? null;

    const restoreScrollRef = useRef(false);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const queryClient = useQueryClient();
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);

    const [streamingAiPlaceholderId, setStreamingAiPlaceholderId] = useState<string | null>(null);
    const [streamingAiContent, setStreamingAiContent] = useState<string>('');

    // Fetch chat details query
    const chatQueryKey = isStandalone ? ['standaloneChat', activeChatId] : ['chat', activeSessionId, activeChatId];
    const { data: chatData, isLoading: isLoadingMessages, error: chatError, isFetching } = useQuery<ChatSession | null, Error>({
        queryKey: chatQueryKey,
        queryFn: () => {
            if (activeChatId === null) return Promise.resolve(null);
            if (isStandalone) {
                return fetchStandaloneChatDetails(activeChatId);
            } else {
                // Need session ID for session chats
                if (!activeSessionId) {
                    console.warn("[ChatInterface] Attempting to fetch session chat without activeSessionId.");
                    return Promise.resolve(null); // Return null if session ID isn't available yet
                }
                return fetchSessionChatDetails(activeSessionId, activeChatId);
            }
        },
        enabled: activeChatId !== null && (isStandalone || activeSessionId !== null),
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
        // onSuccess removed from useQuery options
    });

    // --- Derive latest tokens from chatData ---
    const lastAiMessageWithTokens = useMemo(() => {
        if (!chatData?.messages || chatData.messages.length === 0) {
            return null;
        }
        return [...chatData.messages].reverse().find(msg => msg.sender === 'ai');
     }, [chatData]);

    const latestPromptTokens = lastAiMessageWithTokens?.promptTokens ?? null;
    const latestCompletionTokens = lastAiMessageWithTokens?.completionTokens ?? null;
    // --- End derivation ---

    // Process Stream Function
    const processStream = async (
        stream: ReadableStream<Uint8Array>,
        tempUserMsgId: number | undefined,
        receivedUserMsgId: number,
        tempAiPlaceholderId: string
    ) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let finalTokens: { prompt?: number, completion?: number } | null = null;
        let actualUserMessageId = receivedUserMsgId;
        const currentChatQueryKey = isStandalone ? ['standaloneChat', activeChatId] : ['chat', activeSessionId, activeChatId];

        try {
            setStreamingAiContent('');

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
                                console.log("Received user message ID via SSE:", actualUserMessageId);
                                // Update cache using the correct query key
                                if (tempUserMsgId && activeChatId && (isStandalone || activeSessionId)) {
                                     queryClient.setQueryData<ChatSession>(currentChatQueryKey, (oldData) => {
                                         if (!oldData) return oldData;
                                         console.log(`[Stream] Optimistically replacing user msg ID ${tempUserMsgId} with ${actualUserMessageId}`);
                                         // Ensure messages is always an array before mapping
                                         const currentMessages = oldData.messages ?? [];
                                         return { ...oldData, messages: currentMessages.map(msg => msg.id === tempUserMsgId ? { ...msg, id: actualUserMessageId } : msg) };
                                     });
                                }
                            } else if (data.chunk) {
                                fullText += data.chunk;
                                setStreamingAiContent(prev => prev + data.chunk);
                            } else if (data.done) {
                                console.log("Stream processing received done signal. Tokens:", data);
                                finalTokens = { prompt: data.promptTokens, completion: data.completionTokens };
                            }
                        } catch (e) { console.error('SSE parse error', e); }
                    }
                }
            }
            console.log("Stream processing complete. Full text received.");

            if (activeChatId && fullText.trim()) {
                 const finalAiMessage: ChatMessage = {
                     id: createTemporaryAiId(),
                     sender: 'ai',
                     text: fullText.trim(),
                     promptTokens: finalTokens?.prompt,
                     completionTokens: finalTokens?.completion,
                 };
                 queryClient.setQueryData<ChatSession>(currentChatQueryKey, (oldData) => {
                     if (!oldData) return oldData;
                     // Ensure messages is always an array
                     const currentMessages = oldData.messages ?? [];
                     let finalMessages = currentMessages.map(msg =>
                         (tempUserMsgId && msg.id === tempUserMsgId && actualUserMessageId !== -1)
                         ? { ...msg, id: actualUserMessageId }
                         : msg
                     );
                     finalMessages.push(finalAiMessage);
                     console.log(`[Stream Complete] Optimistically adding final AI message (temp ID: ${finalAiMessage.id})`);
                     return { ...oldData, messages: finalMessages };
                 });
            }

             setStreamingAiPlaceholderId(null);
             setStreamingAiContent('');

            if (activeChatId) {
                console.log("[Stream Complete] Invalidating chat query to fetch final saved messages eventually.");
                queryClient.invalidateQueries({ queryKey: currentChatQueryKey });
            }

        } catch (error) {
            console.error("Error reading stream:", error);
             setStreamingAiPlaceholderId(null);
             setStreamingAiContent('');
             throw error;
        }
    };


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
        onMutate: async (newMessageText) => {
            if (!activeChatId) return;
            const currentChatQueryKey = isStandalone ? ['standaloneChat', activeChatId] : ['chat', activeSessionId, activeChatId];
            await queryClient.cancelQueries({ queryKey: currentChatQueryKey });
            const previousChatData = queryClient.getQueryData<ChatSession>(currentChatQueryKey);
            const temporaryUserMessage: ChatMessage = { id: createTemporaryId(), sender: 'user', text: newMessageText };

            queryClient.setQueryData<ChatSession>(currentChatQueryKey, (oldData) => ({
                ...(oldData ?? { id: activeChatId, sessionId: isStandalone ? null : activeSessionId, timestamp: Date.now(), name: 'Unknown Chat', messages: [] }),
                // Ensure messages is always an array before spreading
                messages: [...(oldData?.messages ?? []), temporaryUserMessage],
            }));

            const tempAiPlaceholderId = `ai-streaming-${Date.now()}`;
            setStreamingAiPlaceholderId(tempAiPlaceholderId);
            setStreamingAiContent('');

            console.log('[Optimistic ChatInterface] Added temporary user message ID:', temporaryUserMessage.id);
            console.log('[Optimistic ChatInterface] Added temporary AI placeholder ID:', tempAiPlaceholderId);

            return { previousChatData, temporaryUserMessageId: temporaryUserMessage.id, tempAiPlaceholderId };
        },
        onSuccess: (data, variables, context) => {
             console.log("Stream initiated successfully. Header User Msg ID:", data.userMessageId);
             if (!context?.tempAiPlaceholderId) {
                  console.error("Missing temporary AI placeholder ID in mutation context!");
                  throw new Error("Mutation context missing tempAiPlaceholderId");
             }
             processStream(data.stream, context.temporaryUserMessageId, data.userMessageId, context.tempAiPlaceholderId)
                 .catch(streamError => {
                     console.error("Caught error from processStream in onSuccess, letting mutation handler take over:", streamError);
                     throw streamError;
                 });
        },
        onError: (error, newMessageText, context) => {
            console.error("Mutation failed (Initiation or Stream):", error);
            const currentChatQueryKey = isStandalone ? ['standaloneChat', activeChatId] : ['chat', activeSessionId, activeChatId];
            if (context?.previousChatData && activeChatId && (isStandalone || activeSessionId)) {
                 queryClient.setQueryData(currentChatQueryKey, context.previousChatData);
                 console.log("[Mutation Error] Reverted optimistic user message.");
            }
            setStreamingAiPlaceholderId(null);
            setStreamingAiContent('');
        },
        onSettled: () => {
            console.log("[Mutation Settled] Clearing input.");
            setCurrentQuery('');
             console.log('[ChatInterface Settled] Invalidating ollamaStatus query.');
             queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
        },
    });
    // --- End Mutation ---


    const chatMessages = chatData?.messages || [];
    // Use isLoadingSessionMeta only if it's NOT a standalone chat
    const combinedIsLoading = (!isStandalone && isLoadingSessionMeta) || (isLoadingMessages && !chatData);


     // Scroll logic (unchanged)
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
                 const shouldScroll = chatMessages.length > 0 || streamingAiPlaceholderId !== null;
                 if (shouldScroll) {
                     const lastElement = chatContentRef.current.lastElementChild;
                     if (lastElement) {
                         requestAnimationFrame(() => { lastElement.scrollIntoView({ behavior: "smooth", block: "end" }); });
                     }
                 }
             }
         }
     }, [chatMessages.length, combinedIsLoading, isTabActive, streamingAiPlaceholderId]);


    const isAiResponding = addMessageMutation.isPending || streamingAiPlaceholderId !== null;

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
                        streamingMessage={streamingAiPlaceholderId ? { id: streamingAiPlaceholderId, content: streamingAiContent } : null}
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
