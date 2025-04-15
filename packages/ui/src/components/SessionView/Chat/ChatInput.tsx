import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Toast from '@radix-ui/react-toast';
import { TextField, Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes'; // Added Spinner
import { StarredTemplatesList } from './StarredTemplates';
import { addChatMessage } from '../../../api/api';
import {
    currentQueryAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    toastMessageAtom,
} from '../../../store';
import type { ChatSession } from '../../../types';

interface ChatInputProps {
    disabled?: boolean;
}

export function ChatInput({ disabled = false }: ChatInputProps) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    // Use local state for input-specific errors
    const [inputError, setInputError] = useState('');
    const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    const [isToastVisible, setIsToastVisible] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    const queryClient = useQueryClient();

    // Mutation for sending a message
    const addMessageMutation = useMutation({
        mutationFn: (text: string) => {
            if (!activeSessionId || !activeChatId) {
                throw new Error("Session ID or Chat ID missing");
            }
            return addChatMessage(activeSessionId, activeChatId, text);
        },
        onSuccess: (data, variables) => {
            // Update the cache directly for instant feedback
            const queryKey = ['chat', activeSessionId, activeChatId];
            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
                if (!oldData) {
                    // If cache is empty (e.g., first message after starting chat),
                    // it's better to invalidate and let the query refetch the full chat.
                    console.warn("Chat cache was empty or incomplete, invalidating instead of setting.");
                    queryClient.invalidateQueries({ queryKey });
                    return undefined; // Let invalidation handle refetch
                }
                const currentMessages = Array.isArray(oldData.messages) ? oldData.messages : [];
                return { ...oldData, messages: [...currentMessages, data.userMessage, data.aiMessage] };
            });
            setInputError(''); // Clear any previous submission error

             // Focus input after successful send, unless disabled prop is true
            const isDisabled = disabled || !activeChatId;
            if (!isDisabled && inputRef.current) {
                inputRef.current.focus();
            }
        },
        onError: (error) => {
            console.error("Failed to send message:", error);
            setInputError(`Failed to get response: ${error.message}`);
             // Optionally, re-add the user's message to the input field if desired on error?
             // setCurrentQuery(variables); // `variables` is the `text` sent
        },
    });

    const isAiResponding = addMessageMutation.isPending;
    const isDisabled = disabled || isAiResponding || !activeChatId; // Combined disabled check

    useEffect(() => {
        if (activeChatId !== null && !isDisabled) { // Check combined disabled state
            inputRef.current?.focus();
        }
    }, [activeChatId, isDisabled]); // Depend on combined state

    useEffect(() => {
        // Clear input-specific errors when user types
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        // Clear API errors when user types again
        if (inputError.startsWith("Failed to get response:") && currentQuery !== '') {
             setInputError('');
        }
    }, [currentQuery, inputError]);

    useEffect(() => {
        setIsToastVisible(!!toastMessageContent);
    }, [toastMessageContent]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isDisabled && inputRef.current) { // Check combined disabled state
            inputRef.current.focus();
        }
    };

    const trySubmit = async () => {
        if (isDisabled) {
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
            setInputError(''); // Clear previous errors
            const queryToSend = currentQuery;
            setCurrentQuery(''); // Clear input immediately
            addMessageMutation.mutate(queryToSend); // Trigger the mutation
        } catch (err) {
            // Should be caught by mutation's onError
            console.error("Error during mutation initiation:", err);
            setInputError('An unexpected error occurred.');
        }
        return true; // Indicate submission attempt was made
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
        // TODO: Implement cancellation if the API supports it (e.g., via AbortController)
        // For now, just show a toast or log.
        setToastMessageAtom("Cancellation not supported by backend yet.");
        console.warn("Cancellation attempt - not implemented.");
        if (!isDisabled && inputRef.current) { // Check combined disabled state
           inputRef.current.focus();
        }
        // addMessageMutation.reset(); // Or potentially try to cancel the underlying fetch
    };

    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open);
        if (!open) setToastMessageAtom(null);
    };

    const showCancelButton = isAiResponding && !disabled; // Show cancel only if base disabled prop is false
    const sendButtonDisabled = isDisabled || !currentQuery.trim(); // Simplified disabled logic
    const starredButtonDisabled = isDisabled;
    const inputFieldDisabled = isDisabled;

    return (
        <>
            <Flex direction="column" gap="1">
                <Flex align="start" gap="2" width="100%">
                    <Box position="relative" flexShrink="0">
                        <IconButton
                            type="button"
                            variant="soft"
                            size="2"
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
                        ref={inputRef}
                        size="2"
                        style={{ flexGrow: 1 }}
                        placeholder={isAiResponding ? "AI is responding..." : "Ask about the session..."}
                        value={currentQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                        disabled={inputFieldDisabled}
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                    />
                    {showCancelButton ? (
                        <IconButton
                           type="button"
                           color="red"
                           variant="solid"
                           size="2"
                           onClick={handleCancelClick}
                           title="Cancel response (Not Implemented)"
                           aria-label="Cancel AI response"
                           disabled={!isAiResponding} // Disable if not actually responding
                           >
                            <StopIcon />
                        </IconButton>
                    ) : (
                        <IconButton
                            type="button"
                            variant="solid"
                            size="2"
                            onClick={handleSubmitClick}
                            disabled={sendButtonDisabled}
                            title={isAiResponding ? "AI is responding..." : "Send message"}
                            aria-label={isAiResponding ? "AI is responding" : "Send message"}
                        >
                            {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
                        </IconButton>
                    )}
                </Flex>
                {inputError && <Text size="1" color="red" align="center" mt="1">{inputError}</Text>}
            </Flex>
            <Toast.Root
                open={isToastVisible}
                onOpenChange={handleToastOpenChange}
                duration={5000}
                className="bg-[--color-panel-solid] rounded-md shadow-[hsl(206_22%_7%_/_35%)_0px_10px_38px_-10px,_hsl(206_22%_7%_/_20%)_0px_10px_20px_-15px] p-[15px] grid [grid-template-areas:_'title_action'_'description_action'] grid-cols-[auto_max-content] gap-x-[15px] items-center data-[state=open]:animate-slideIn data-[state=closed]:animate-hide data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-[transform_200ms_ease-out] data-[swipe=end]:animate-swipeOut"
            >
                <Toast.Description className="[grid-area:_description] m-0 text-[--gray-a11] text-[13px] leading-[1.3]">{toastMessageContent}</Toast.Description>
                <Toast.Close className="[grid-area:_action]" asChild>
                    <IconButton variant="ghost" color="gray" size="1" aria-label="Close">
                        <Cross2Icon />
                    </IconButton>
                </Toast.Close>
            </Toast.Root>
        </>
    );
}
