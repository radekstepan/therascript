import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon } from '@radix-ui/react-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TextField, Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplates';
import { addChatMessage } from '../../../api/api';
import {
    currentQueryAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    toastMessageAtom,
} from '../../../store';
// Import ChatMessage type specifically
import type { ChatSession, ChatMessage } from '../../../types';

interface ChatInputProps {
    disabled?: boolean;
}

// Helper function to create a temporary message ID
const createTemporaryId = () => Date.now();

export function ChatInput({ disabled = false }: ChatInputProps) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [inputError, setInputError] = useState('');
    const setToastMessageAtom = useSetAtom(toastMessageAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    const queryClient = useQueryClient();

    // Mutation for sending a message with Optimistic Update
    const addMessageMutation = useMutation({
        mutationFn: (text: string) => {
            if (!activeSessionId || !activeChatId) {
                throw new Error("Session ID or Chat ID missing");
            }
            return addChatMessage(activeSessionId, activeChatId, text);
        },
        // --- Optimistic Update Logic ---
        onMutate: async (newMessageText) => {
            if (!activeSessionId || !activeChatId) return; // Should not happen if mutationFn check passes

            const queryKey = ['chat', activeSessionId, activeChatId];

            // 1. Cancel ongoing refetches
            await queryClient.cancelQueries({ queryKey });

            // 2. Get snapshot of previous data
            const previousChatData = queryClient.getQueryData<ChatSession>(queryKey);

            // 3. Create temporary user message
            const temporaryMessage: ChatMessage = {
                id: createTemporaryId(), // Use timestamp as temporary ID
                sender: 'user',
                text: newMessageText,
                // starred: false, // Default starred state
                // Add a temporary status if needed for UI differentiation
                // status: 'pending',
            };

            // 4. Optimistically update the cache
            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
                if (!oldData) {
                     // If cache is empty, create a minimal structure
                     return {
                         // Need id, sessionId, timestamp - but we might not have them readily here
                         // It's safer to invalidate and refetch in this edge case,
                         // so maybe don't update cache if oldData is null/undefined
                         // For now, let's assume oldData exists for simplicity of example
                         id: activeChatId,
                         sessionId: activeSessionId,
                         timestamp: Date.now(), // Placeholder timestamp
                         name: 'Unknown Chat', // Placeholder name
                         messages: [temporaryMessage]
                     };
                }
                const currentMessages = Array.isArray(oldData.messages) ? oldData.messages : [];
                return {
                    ...oldData,
                    messages: [...currentMessages, temporaryMessage],
                };
            });

             console.log('[Optimistic] Added temporary message ID:', temporaryMessage.id);


            // 5. Return context with previous data and temp ID
            return { previousChatData, temporaryMessageId: temporaryMessage.id };
        },
        // --- Error Handling ---
        onError: (error, newMessageText, context) => {
            console.error("Failed to send message (onError):", error);
            setInputError(`Failed to get response: ${error.message}`);

            // Rollback optimistic update
            if (context?.previousChatData && activeSessionId && activeChatId) {
                const queryKey = ['chat', activeSessionId, activeChatId];
                console.log('[Optimistic] Rolling back due to error. Restoring previous data.');
                queryClient.setQueryData(queryKey, context.previousChatData);
            }
            // Optionally set a toast message here too if needed
            setToastMessageAtom(`❌ Send failed: ${error.message}`);
             // Re-populate input field on error?
             // setCurrentQuery(newMessageText);
        },
        // --- Success Handling ---
        onSuccess: (data, newMessageText, context) => {
            // API call was successful, `data` contains { userMessage, aiMessage }
            // `userMessage` has the *real* ID from the backend.
            // `context` contains { previousChatData, temporaryMessageId }
            if (!activeSessionId || !activeChatId || !context?.temporaryMessageId) return;

            const queryKey = ['chat', activeSessionId, activeChatId];

             console.log('[Optimistic] onSuccess: Replacing temp msg', context.temporaryMessageId, 'with real msg', data.userMessage.id);


            // Update cache: Replace temp message with real one, add AI message
            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
                 if (!oldData) {
                      // Should ideally not happen if onMutate handled cache creation,
                      // but handle defensively.
                      console.warn('[Optimistic onSuccess] Cache data missing unexpectedly. Setting new data.');
                      return {
                         id: activeChatId,
                         sessionId: activeSessionId,
                         timestamp: Date.now(), // Placeholder
                         name: 'Unknown Chat', // Placeholder
                         messages: [data.userMessage, data.aiMessage]
                      };
                 }

                 const messagesWithRealUser = (oldData.messages || []).map(msg =>
                     msg.id === context.temporaryMessageId ? data.userMessage : msg
                 );

                return {
                    ...oldData,
                    messages: [...messagesWithRealUser, data.aiMessage],
                };
            });

            setInputError(''); // Clear any previous submission error

            // Focus input after successful send
            const isDisabled = disabled || !activeChatId;
            if (!isDisabled && inputRef.current) {
                inputRef.current.focus();
            }
        },
        // --- Cleanup (Optional but recommended) ---
         onSettled: (data, error, variables, context) => {
             // Runs after onSuccess or onError
             if (activeSessionId && activeChatId) {
                 // Always invalidate the query to ensure final consistency with backend,
                 // especially if there were intermediate updates not captured.
                 console.log('[Optimistic] onSettled: Invalidating chat query for final consistency.');
                 queryClient.invalidateQueries({ queryKey: ['chat', activeSessionId, activeChatId] });
             }
         },
    });

    const isAiResponding = addMessageMutation.isPending;
    // Input is disabled if the base disabled prop is true, OR if the mutation is pending (AI is responding)
    // We no longer disable *during* optimistic update of the user message itself.
    const isEffectivelyDisabled = disabled || isAiResponding || !activeChatId;

    useEffect(() => {
        if (activeChatId !== null && !isEffectivelyDisabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, isEffectivelyDisabled]);

    useEffect(() => {
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        if (inputError.startsWith("Failed to get response:") && currentQuery !== '') {
             setInputError('');
        }
    }, [currentQuery, inputError]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isEffectivelyDisabled && inputRef.current) {
            inputRef.current.focus();
        }
    };

    const trySubmit = async () => {
        // Prevent submission only if already responding or explicitly disabled by prop
        if (disabled || isAiResponding) {
             console.log("Submit prevented: ChatInput is disabled or AI is responding.");
             return false;
        }
        if (!currentQuery.trim()) {
            setInputError("Cannot send an empty message.");
            return false;
        }
        if (activeSessionId === null || activeChatId === null) {
            setInputError("Please select a chat first.");
             console.error("Submit failed: No active session or chat ID.");
            return false;
        }

        try {
            setInputError('');
            const queryToSend = currentQuery;
            setCurrentQuery(''); // Clear input immediately
            addMessageMutation.mutate(queryToSend); // Trigger the mutation (optimistic update happens in onMutate)
        } catch (err) {
            console.error("Error during mutation initiation:", err);
            setInputError('An unexpected error occurred.');
        }
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            trySubmit();
        }
    };

    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        trySubmit();
    };

    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        setToastMessageAtom("❗ Cancellation not supported by backend yet.");
        console.warn("Cancellation attempt - not implemented.");
         // TODO: Implement cancellation if the API supports it (AbortController)
         // addMessageMutation.reset(); // This might just reset client state, not cancel API
         // Need access to AbortController used in API call
        if (!isEffectivelyDisabled && inputRef.current) {
           inputRef.current.focus();
        }
    };

    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
    const starredButtonDisabled = isEffectivelyDisabled;
    const inputFieldDisabled = isEffectivelyDisabled;

    return (
        <Flex direction="column" gap="1">
            <Flex align="start" gap="2" width="100%">
                <Box position="relative" flexShrink="0">
                    <IconButton
                        type="button" variant="soft" size="2"
                        title="Show Starred Templates"
                        onClick={() => setShowTemplates((prev) => !prev)}
                        aria-label="Show starred templates"
                        disabled={starredButtonDisabled}
                    >
                        <StarIcon width={16} height={16} />
                    </IconButton>
                    {showTemplates && <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} />}
                </Box>
                <TextField.Root
                    ref={inputRef} size="2" style={{ flexGrow: 1 }}
                    placeholder={isAiResponding ? "AI is responding..." : "Ask about the session..."}
                    value={currentQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                    disabled={inputFieldDisabled}
                    aria-label="Chat input message"
                    onKeyDown={handleKeyDown}
                />
                {showCancelButton ? (
                    <IconButton
                       type="button" color="red" variant="solid" size="2"
                       onClick={handleCancelClick}
                       title="Cancel response (Not Implemented)"
                       aria-label="Cancel AI response"
                       disabled={!isAiResponding} // Should always be enabled if shown
                       >
                        <StopIcon />
                    </IconButton>
                ) : (
                    <IconButton
                        type="button" variant="solid" size="2"
                        onClick={handleSubmitClick}
                        disabled={sendButtonDisabled}
                        title={isAiResponding ? "AI is responding..." : "Send message"}
                        aria-label={isAiResponding ? "AI is responding" : "Send message"}
                    >
                        {/* Show spinner only when AI is actually responding, not during optimistic update */}
                        {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
                    </IconButton>
                )}
            </Flex>
            {inputError && <Text size="1" color="red" align="center" mt="1">{inputError}</Text>}
        </Flex>
    );
}
