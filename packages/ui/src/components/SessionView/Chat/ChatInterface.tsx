// packages/ui/src/components/SessionView/Chat/ChatInterface.tsx
/* packages/ui/src/components/SessionView/Chat/ChatInterface.tsx */
import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react'; // Single import
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes'; // Single import
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatPanelHeader } from './ChatPanelHeader'; // Single import
// Renamed API function import
import { fetchChatDetails, addChatMessageStream } from '../../../api/api';
import { debounce } from '../../../helpers';
// Single import for types
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

// Helper function to create temporary message IDs
const createTemporaryId = (): number => -Math.floor(Math.random() * 1000000); // Negative for user
const createTemporaryAiId = (): number => -Math.floor(Math.random() * 1000000) - 1000000; // Different range for AI

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
    const queryClient = useQueryClient();
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);

    // State for streaming AI message placeholder ID and content
    const [streamingAiPlaceholderId, setStreamingAiPlaceholderId] = useState<string | null>(null);
    const [streamingAiContent, setStreamingAiContent] = useState<string>('');

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

    // --- Derive latest tokens from chatData ---
    const lastAiMessageWithTokens = useMemo(() => {
        if (!chatData?.messages || chatData.messages.length === 0) {
            return null;
        }
        // Find the last message sent by the AI
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
        tempAiPlaceholderId: string // ID of the placeholder UI element
    ) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        let finalTokens: { prompt?: number, completion?: number } | null = null;
        let actualUserMessageId = receivedUserMsgId;

        try {
            setStreamingAiContent(''); // Start empty

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
                                if (tempUserMsgId && activeSessionId && activeChatId) {
                                     queryClient.setQueryData<ChatSession>(['chat', activeSessionId, activeChatId], (oldData) => {
                                         if (!oldData) return oldData;
                                         console.log(`[Stream] Optimistically replacing user msg ID ${tempUserMsgId} with ${actualUserMessageId}`);
                                         return { ...oldData, messages: (oldData.messages || []).map(msg => msg.id === tempUserMsgId ? { ...msg, id: actualUserMessageId } : msg) };
                                     });
                                }
                            } else if (data.chunk) {
                                fullText += data.chunk;
                                setStreamingAiContent(prev => prev + data.chunk); // Update streaming content
                            } else if (data.done) {
                                console.log("Stream processing received done signal. Tokens:", data);
                                finalTokens = { prompt: data.promptTokens, completion: data.completionTokens };
                                // Tokens are derived, no local state update needed here
                            }
                        } catch (e) { console.error('SSE parse error', e); }
                    }
                }
            }
            // --- Stream finished successfully ---
            console.log("Stream processing complete. Full text received.");

            // --- Optimistic Cache Update ---
            if (activeSessionId && activeChatId && fullText.trim()) {
                 const finalAiMessage: ChatMessage = {
                     id: createTemporaryAiId(),
                     sender: 'ai',
                     text: fullText.trim(),
                     promptTokens: finalTokens?.prompt,
                     completionTokens: finalTokens?.completion,
                 };
                 queryClient.setQueryData<ChatSession>(['chat', activeSessionId, activeChatId], (oldData) => {
                     if (!oldData) return oldData;
                     let finalMessages = (oldData.messages || []).map(msg =>
                         (tempUserMsgId && msg.id === tempUserMsgId && actualUserMessageId !== -1)
                         ? { ...msg, id: actualUserMessageId }
                         : msg
                     );
                     finalMessages.push(finalAiMessage);
                     console.log(`[Stream Complete] Optimistically adding final AI message (temp ID: ${finalAiMessage.id}) to cache with tokens P:${finalAiMessage.promptTokens ?? '?'} C:${finalAiMessage.completionTokens ?? '?'}.`);
                     return { ...oldData, messages: finalMessages };
                 });
            }
            // --- End Optimistic Update ---

             // Clear streaming placeholder state *after* optimistic update
             setStreamingAiPlaceholderId(null);
             setStreamingAiContent('');

             // Invalidate query to eventually get the final AI message ID from DB
            if (activeSessionId && activeChatId) {
                console.log("[Stream Complete] Invalidating chat query to fetch final saved messages eventually.");
                queryClient.invalidateQueries({ queryKey: ['chat', activeSessionId, activeChatId] });
            }

        } catch (error) {
            console.error("Error reading stream:", error);
             // Clear streaming state on error immediately
             setStreamingAiPlaceholderId(null);
             setStreamingAiContent('');
             throw error; // Re-throw error
        }
    };


     // Add Message Mutation
     const addMessageMutation = useMutation({
        mutationFn: async (text: string) => {
            if (!activeSessionId || !activeChatId) throw new Error("Session/Chat ID missing");
            return addChatMessageStream(activeSessionId, activeChatId, text);
        },
        onMutate: async (newMessageText) => {
            if (!activeSessionId || !activeChatId) return;
            const queryKey = ['chat', activeSessionId, activeChatId];
            await queryClient.cancelQueries({ queryKey });
            const previousChatData = queryClient.getQueryData<ChatSession>(queryKey);
            const temporaryUserMessage: ChatMessage = { id: createTemporaryId(), sender: 'user', text: newMessageText };

            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => ({
                ...(oldData ?? { id: activeChatId, sessionId: activeSessionId, timestamp: Date.now(), name: 'Unknown Chat', messages: [] }),
                messages: [...(oldData?.messages ?? []), temporaryUserMessage],
            }));

            // Use a placeholder ID for the UI element that shows streaming
            const tempAiPlaceholderId = `ai-streaming-${Date.now()}`;
            setStreamingAiPlaceholderId(tempAiPlaceholderId); // Set placeholder ID
            setStreamingAiContent(''); // Reset content

            console.log('[Optimistic ChatInterface] Added temporary user message ID:', temporaryUserMessage.id);
            console.log('[Optimistic ChatInterface] Added temporary AI placeholder ID:', tempAiPlaceholderId);

            // Pass placeholder ID in context
            return { previousChatData, temporaryUserMessageId: temporaryUserMessage.id, tempAiPlaceholderId };
        },
        onSuccess: (data, variables, context) => {
             console.log("Stream initiated successfully. Header User Msg ID:", data.userMessageId);
             if (!context?.tempAiPlaceholderId) { // Check for placeholder ID
                  console.error("Missing temporary AI placeholder ID in mutation context!");
                  throw new Error("Mutation context missing tempAiPlaceholderId");
             }
             // Start processing the stream, passing the placeholder ID
             processStream(data.stream, context.temporaryUserMessageId, data.userMessageId, context.tempAiPlaceholderId)
                 .catch(streamError => {
                     console.error("Caught error from processStream in onSuccess, letting mutation handler take over:", streamError);
                     throw streamError;
                 });
        },
        onError: (error, newMessageText, context) => {
            console.error("Mutation failed (Initiation or Stream):", error);
            if (context?.previousChatData && activeSessionId && activeChatId) {
                 queryClient.setQueryData(['chat', activeSessionId, activeChatId], context.previousChatData);
                 console.log("[Mutation Error] Reverted optimistic user message.");
            }
            // Clear AI placeholder state
            setStreamingAiPlaceholderId(null);
            setStreamingAiContent('');
            // TODO: Show error toast to user
        },
        onSettled: () => {
            console.log("[Mutation Settled] Clearing input.");
            setCurrentQuery(''); // Clear input
             // Invalidate Ollama Status Query after message interaction
             console.log('[ChatInterface Settled] Invalidating ollamaStatus query.');
             queryClient.invalidateQueries({ queryKey: ['ollamaStatus'] });
        },
    });
    // --- End Mutation ---


    const chatMessages = chatData?.messages || [];
    const combinedIsLoading = isLoadingSessionMeta || (isLoadingMessages && !chatData);


     // Scroll logic remains mostly the same
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
     // Scroll to bottom effect - modify to include streaming message
    useEffect(() => {
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current && !combinedIsLoading) {
             if (chatContentRef.current) {
                 // Scroll when messages list updates OR when streaming placeholder appears/disappears
                 const shouldScroll = chatMessages.length > 0 || streamingAiPlaceholderId !== null;
                 if (shouldScroll) {
                     const lastElement = chatContentRef.current.lastElementChild;
                     if (lastElement) {
                         requestAnimationFrame(() => { lastElement.scrollIntoView({ behavior: "smooth", block: "end" }); });
                     }
                 }
             }
         }
     }, [chatMessages.length, combinedIsLoading, isTabActive, streamingAiPlaceholderId]); // Watch placeholder ID


    // Determine if AI is responding (mutation pending OR streaming placeholder active)
    const isAiResponding = addMessageMutation.isPending || streamingAiPlaceholderId !== null;

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0, border: '1px solid var(--gray-a6)', borderRadius: 'var(--radius-3)', overflow: 'hidden' }}>
            {/* --- Render ChatPanelHeader Component --- */}
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
                    {/* Pass streaming message state to ChatMessages */}
                    <ChatMessages
                        messages={chatMessages}
                        activeChatId={activeChatId}
                        // Pass the placeholder ID and its current content
                        streamingMessage={streamingAiPlaceholderId ? { id: streamingAiPlaceholderId, content: streamingAiContent } : null}
                    />
                </Box>
            </ScrollArea>

            <Box
                px="4" pt="4" pb="2"
                style={{ flexShrink: 0, borderTop: '1px solid var(--gray-a6)', backgroundColor: 'var(--color-panel-solid)', opacity: combinedIsLoading ? 0.6 : 1, transition: 'opacity 0.2s ease-in-out' }} >
                {/* Pass mutation to ChatInput */}
                <ChatInput
                    // Disable if loading, no active chat, or AI is responding
                    disabled={combinedIsLoading || !activeChatId || isAiResponding}
                    addMessageMutation={addMessageMutation}
                />
            </Box>
        </Flex>
    );
}
