/* packages/ui/src/components/SessionView/Chat/ChatInput.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon } from '@radix-ui/react-icons';
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

// --- Define expected props for the mutation ---
interface AddMessageStreamMutationResult {
    userMessageId: number;
    stream: ReadableStream<Uint8Array>;
}
// --- End type definition ---

interface ChatInputProps {
    disabled?: boolean;
    // --- Update Mutation Prop Type ---
    addMessageMutation: UseMutationResult<
        AddMessageStreamMutationResult, // Success data type (stream info)
        Error, // Error type
        string, // Variables type (the text message)
        unknown // Context type (adjust if needed)
    >;
    // --- End Prop Update ---
}

export function ChatInput({ disabled = false, addMessageMutation }: ChatInputProps) { // Destructure prop
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [inputError, setInputError] = useState('');
    const setToastMessageAtom = useSetAtom(toastMessageAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    // Use the passed mutation's state
    const isAiResponding = addMessageMutation.isPending;
    // Input is disabled if the base disabled prop is true, OR if the mutation is pending (AI is responding)
    const isEffectivelyDisabled = disabled || isAiResponding || !activeChatId;

    useEffect(() => { // Focus effect
        if (activeChatId !== null && !isEffectivelyDisabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, isEffectivelyDisabled]);

    useEffect(() => { // Error clearing effect
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        // Clear API errors if user starts typing again
        if (addMessageMutation.isError && currentQuery !== '') {
            addMessageMutation.reset(); // Reset mutation error state
        }
    }, [currentQuery, inputError, addMessageMutation]);


    const handleSelectTemplate = (text: string) => { // Remains the same
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isEffectivelyDisabled && inputRef.current) {
            inputRef.current.focus();
        }
    };

    const trySubmit = () => { // Changed from async
        if (isEffectivelyDisabled) {
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
            // DO NOT clear input here, let the mutation's onSettled handle it
            // setCurrentQuery('');
            // Use the passed mutate function - this starts the stream initiation
            addMessageMutation.mutate(queryToSend);
            // The actual stream processing happens in ChatInterface's onSuccess
        } catch (err) {
            console.error("Error initiating mutation:", err);
            setInputError('An unexpected error occurred.');
            // Let mutation's onError handle detailed feedback
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
        setToastMessageAtom("❗ Cancellation not supported yet.");
        console.warn("Cancellation attempt - not implemented.");
        // TODO: Implement cancellation (AbortController needs to be passed through)
        // Maybe reset the mutation client-side?
        // addMessageMutation.reset();
        if (!isEffectivelyDisabled && inputRef.current) {
           inputRef.current.focus();
        }
    };

    // Use mutation's pending state
    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
    const starredButtonDisabled = isEffectivelyDisabled;
    const inputFieldDisabled = isEffectivelyDisabled;

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
                    placeholder={isAiResponding ? "AI is responding..." : "Ask about the session..."}
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
                       // Disable if mutation isn't actually pending (shouldn't happen if shown)
                       disabled={!isAiResponding}
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
                        {isAiResponding ? <Spinner size="1" /> : <PaperPlaneIcon />}
                    </IconButton>
                )}
            </Flex>
            {/* Input Error Display */}
            {inputError && <Text size="1" color="red" align="center" mt="1">{inputError}</Text>}
            {/* Display mutation error if present */}
            {addMessageMutation.isError && (
                 <Text size="1" color="red" align="center" mt="1">Error: {addMessageMutation.error.message}</Text>
            )}
        </Flex>
    );
}
