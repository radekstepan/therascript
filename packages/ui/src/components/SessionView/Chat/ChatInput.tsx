import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
// Remove Toast import if no longer needed here
// import * as Toast from '@radix-ui/react-toast';
import { TextField, Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes'; // Added Spinner
import { StarredTemplatesList } from './StarredTemplates';
import { addChatMessage } from '../../../api/api';
import {
    currentQueryAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    toastMessageAtom, // Keep toastMessageAtom for SETTING
} from '../../../store';
import type { ChatSession } from '../../../types';

interface ChatInputProps {
    disabled?: boolean;
}

export function ChatInput({ disabled = false }: ChatInputProps) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [inputError, setInputError] = useState('');
    // Remove toast visibility state, App.tsx will handle rendering
    // const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    // const [isToastVisible, setIsToastVisible] = useState(false);

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
            const queryKey = ['chat', activeSessionId, activeChatId];
            queryClient.setQueryData<ChatSession>(queryKey, (oldData) => {
                if (!oldData) {
                    console.warn("Chat cache was empty or incomplete, invalidating instead of setting.");
                    queryClient.invalidateQueries({ queryKey });
                    return undefined;
                }
                const currentMessages = Array.isArray(oldData.messages) ? oldData.messages : [];
                return { ...oldData, messages: [...currentMessages, data.userMessage, data.aiMessage] };
            });
            setInputError('');

            const isDisabled = disabled || !activeChatId;
            if (!isDisabled && inputRef.current) {
                inputRef.current.focus();
            }
        },
        onError: (error) => {
            console.error("Failed to send message:", error);
            setInputError(`Failed to get response: ${error.message}`);
             // Optionally set a toast message here too if needed for send errors
             // setToastMessageAtom(`❌ Failed to send: ${error.message}`);
        },
    });

    const isAiResponding = addMessageMutation.isPending;
    const isDisabled = disabled || isAiResponding || !activeChatId;

    useEffect(() => {
        if (activeChatId !== null && !isDisabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, isDisabled]);

    useEffect(() => {
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        if (inputError.startsWith("Failed to get response:") && currentQuery !== '') {
             setInputError('');
        }
    }, [currentQuery, inputError]);

    // Remove toast visibility effect
    // useEffect(() => {
    //     setIsToastVisible(!!toastMessageContent);
    // }, [toastMessageContent]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isDisabled && inputRef.current) {
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
            setInputError('');
            const queryToSend = currentQuery;
            setCurrentQuery('');
            addMessageMutation.mutate(queryToSend);
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
        // TODO: Implement cancellation if the API supports it
        // For now, use the global toast atom if needed
        setToastMessageAtom("❗ Cancellation not supported by backend yet.");
        console.warn("Cancellation attempt - not implemented.");
        if (!isDisabled && inputRef.current) {
           inputRef.current.focus();
        }
    };

    // Remove toast open change handler
    // const handleToastOpenChange = (open: boolean) => {
    //     setIsToastVisible(open);
    //     if (!open) setToastMessageAtom(null);
    // };

    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = isDisabled || !currentQuery.trim();
    const starredButtonDisabled = isDisabled;
    const inputFieldDisabled = isDisabled;

    return (
        // Remove the Toast.Root from here
        // <>
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
                           disabled={!isAiResponding}
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
        // </>
    );
}
