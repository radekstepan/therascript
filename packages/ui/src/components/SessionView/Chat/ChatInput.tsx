import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon } from '@radix-ui/react-icons';
// Removed: useMutation, useQueryClient, addChatMessage API call
import { UseMutationResult } from '@tanstack/react-query'; // Import mutation type
import { TextField, Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplates';
import {
    currentQueryAtom,
    activeSessionIdAtom, // Keep these for context checks
    activeChatIdAtom,
    toastMessageAtom,
} from '../../../store';
import type { ChatMessage } from '../../../types'; // Keep ChatMessage type

interface ChatInputProps {
    disabled?: boolean;
    // --- Accept Mutation as Prop ---
    addMessageMutation: UseMutationResult<
        { userMessage: ChatMessage; aiMessage: ChatMessage }, // Success data type
        Error, // Error type
        string, // Variables type (the text message)
        unknown // Context type (adjust if you use context)
    >;
    // --- End Prop ---
}

export function ChatInput({ disabled = false, addMessageMutation }: ChatInputProps) { // Destructure prop
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [inputError, setInputError] = useState('');
    const setToastMessageAtom = useSetAtom(toastMessageAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    // Removed: queryClient

    // Removed: Internal addMessageMutation hook

    // Use the passed mutation's state
    const isAiResponding = addMessageMutation.isPending;
    // Input is disabled if the base disabled prop is true, OR if the mutation is pending (AI is responding)
    const isEffectivelyDisabled = disabled || isAiResponding || !activeChatId;

    useEffect(() => { // Focus effect remains the same
        if (activeChatId !== null && !isEffectivelyDisabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, isEffectivelyDisabled]);

    useEffect(() => { // Error clearing effect remains the same
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        if (inputError.startsWith("Failed to get response:") && currentQuery !== '') {
             setInputError('');
        }
    }, [currentQuery, inputError]);

     // Clear input error if mutation resets or succeeds
     useEffect(() => {
        if (!addMessageMutation.isError && inputError.startsWith("Failed to get response:")) {
            setInputError('');
        }
     }, [addMessageMutation.isError, inputError]);


    const handleSelectTemplate = (text: string) => { // Remains the same
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isEffectivelyDisabled && inputRef.current) {
            inputRef.current.focus();
        }
    };

    const trySubmit = async () => {
        // Use the passed mutation's state
        if (disabled || addMessageMutation.isPending) {
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
            // setCurrentQuery(''); // Clear input immediately - MOVED to parent's onSuccess
            // Use the passed mutate function
            addMessageMutation.mutate(queryToSend);
        } catch (err) {
            console.error("Error during mutation initiation:", err);
            setInputError('An unexpected error occurred.');
            // Error handling is primarily done in the parent component's onError now
        }
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { // Remains the same
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            trySubmit();
        }
    };

    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => { // Remains the same
        e.preventDefault();
        trySubmit();
    };

    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => { // Remains the same
        e.preventDefault();
        setToastMessageAtom("❗ Cancellation not supported by backend yet.");
        console.warn("Cancellation attempt - not implemented.");
        // TODO: Implement cancellation if the API supports it (AbortController)
        // addMessageMutation.reset(); // Reset client state?
        if (!isEffectivelyDisabled && inputRef.current) {
           inputRef.current.focus();
        }
    };

    const showCancelButton = isAiResponding && !disabled; // Uses passed mutation state
    const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim(); // Uses passed mutation state
    const starredButtonDisabled = isEffectivelyDisabled; // Uses passed mutation state
    const inputFieldDisabled = isEffectivelyDisabled; // Uses passed mutation state

    return (
        <Flex direction="column" gap="1">
            <Flex align="start" gap="2" width="100%">
                {/* Starred Templates Button */}
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
                {/* Input Field */}
                <TextField.Root
                    ref={inputRef} size="2" style={{ flexGrow: 1 }}
                    placeholder={isAiResponding ? "AI is responding..." : "Ask about the session..."} // Uses passed mutation state
                    value={currentQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                    disabled={inputFieldDisabled}
                    aria-label="Chat input message"
                    onKeyDown={handleKeyDown}
                />
                {/* Submit/Cancel Button */}
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
                        title={isAiResponding ? "AI is responding..." : "Send message"} // Uses passed mutation state
                        aria-label={isAiResponding ? "AI is responding" : "Send message"} // Uses passed mutation state
                    >
                        {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
                    </IconButton>
                )}
            </Flex>
            {/* Input Error Display */}
            {inputError && <Text size="1" color="red" align="center" mt="1">{inputError}</Text>}
            {/* Display mutation error if present */}
            {addMessageMutation.isError && !inputError && (
                 <Text size="1" color="red" align="center" mt="1">Error: {addMessageMutation.error.message}</Text>
            )}
        </Flex>
    );
}
