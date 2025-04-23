// Path: packages/ui/src/components/SessionView/Chat/ChatInput.tsx
/* packages/ui/src/components/SessionView/Chat/ChatInput.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon } from '@radix-ui/react-icons';
import { UseMutationResult } from '@tanstack/react-query';
import { TextField, Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplates';
import {
    currentQueryAtom,
    activeChatIdAtom, // Keep only activeChatIdAtom
    toastMessageAtom,
} from '../../../store';
import type { ChatMessage } from '../../../types'; // Keep ChatMessage type

// Define expected props for the mutation
interface AddMessageStreamMutationResult {
    userMessageId: number;
    stream: ReadableStream<Uint8Array>;
}

interface ChatInputProps {
    isStandalone: boolean; // Add this prop
    disabled?: boolean;
    addMessageMutation: UseMutationResult<
        AddMessageStreamMutationResult,
        Error,
        string,
        unknown // Keep context unknown or define if needed by onMutate return
    >;
}

export function ChatInput({ isStandalone, disabled = false, addMessageMutation }: ChatInputProps) { // Destructure props
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Still needed
    const [inputError, setInputError] = useState('');
    const setToastMessageAtom = useSetAtom(toastMessageAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    const isAiResponding = addMessageMutation.isPending;
    const isEffectivelyDisabled = disabled || isAiResponding || !activeChatId;

    useEffect(() => { /* ... (Focus effect unchanged) ... */
        if (activeChatId !== null && !isEffectivelyDisabled) {
            inputRef.current?.focus();
        }
     }, [activeChatId, isEffectivelyDisabled]);

    useEffect(() => { /* ... (Error clearing effect unchanged) ... */
        if ((inputError === "Cannot send an empty message." || inputError === "Please select a chat first.") && currentQuery !== '') {
            setInputError('');
        }
        if (addMessageMutation.isError && currentQuery !== '') {
            addMessageMutation.reset();
        }
     }, [currentQuery, inputError, addMessageMutation]);


    const handleSelectTemplate = (text: string) => { /* ... (unchanged) ... */
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!isEffectivelyDisabled && inputRef.current) {
            inputRef.current.focus();
        }
    };

    const trySubmit = () => {
        if (isEffectivelyDisabled) {
             console.log("Submit prevented: ChatInput is disabled or AI is responding.");
             return false;
        }
        if (!currentQuery.trim()) {
            setInputError("Cannot send an empty message.");
            return false;
        }
        // Only check for activeChatId now
        if (activeChatId === null) {
            setInputError("Please select a chat first.");
             console.error("Submit failed: No active chat ID.");
            return false;
        }

        try {
            setInputError('');
            const queryToSend = currentQuery;
            addMessageMutation.mutate(queryToSend);
        } catch (err) {
            console.error("Error initiating mutation:", err);
            setInputError('An unexpected error occurred.');
        }
        return true;
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { /* ... (unchanged) ... */
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            trySubmit();
        }
     };

    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => { /* ... (unchanged) ... */
        e.preventDefault();
        trySubmit();
    };

    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => { /* ... (unchanged) ... */
        e.preventDefault();
        setToastMessageAtom("❗ Cancellation not supported yet.");
        console.warn("Cancellation attempt - not implemented.");
        if (!isEffectivelyDisabled && inputRef.current) {
           inputRef.current.focus();
        }
    };

    // Use mutation's pending state
    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = isEffectivelyDisabled || !currentQuery.trim();
    const starredButtonDisabled = isEffectivelyDisabled;
    const inputFieldDisabled = isEffectivelyDisabled;

    // Update placeholder based on context
    const placeholderText = isStandalone
        ? "Ask anything..."
        : "Ask about the session...";

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
                    placeholder={isAiResponding ? "AI is responding..." : placeholderText} // Use dynamic placeholder
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
