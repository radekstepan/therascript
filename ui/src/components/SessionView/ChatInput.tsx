// src/components/SessionView/ChatInput.tsx
import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarredTemplatesList } from '../StarredTemplates';
import { addChatMessage } from '../../api/api';
// Ensure atoms are correctly imported
import {
    currentQueryAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    chatErrorAtom,
    toastMessageAtom,
    isChattingAtom, // Import isChattingAtom for AI response status
    pastSessionsAtom, // Import to update state after adding message
} from '../../store';
import type { ChatSession } from '../../types'; // Import necessary types if needed

interface ChatInputProps {
    disabled?: boolean; // Add optional disabled prop (for when messages are loading)
}

// Add disabled prop to component signature
export function ChatInput({ disabled = false }: ChatInputProps) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    const [isToastVisible, setIsToastVisible] = useState(false);
    // Use isChattingAtom directly for AI response status
    const [isAiResponding, setIsAiResponding] = useAtom(isChattingAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom); // Setter to update session state

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    // Focus input when chat becomes active (and not disabled)
    useEffect(() => {
        if (activeChatId !== null && !disabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, disabled]);

    // Clear specific errors when query changes
    useEffect(() => {
        if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery !== '') {
            setChatError('');
        }
    }, [currentQuery, chatError, setChatError]);

    // Control toast visibility based on atom
    useEffect(() => {
        setIsToastVisible(!!toastMessageContent);
    }, [toastMessageContent]);

    // Handler for selecting a starred template
    const handleSelectTemplate = (text: string) => {
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!disabled) {
            inputRef.current?.focus();
        }
    };

    // Attempt to submit the chat message
    const trySubmit = async () => {
        // Prevent submission if component is disabled (e.g., messages loading)
        if (disabled) {
             console.log("Submit prevented: ChatInput is disabled.");
             return false;
        }
        // Prevent submission if AI is already responding
        if (isAiResponding) {
            setToastMessageAtom("Please wait for the AI to finish responding.");
            return false;
        }
        // Validate query isn't empty
        if (!currentQuery.trim()) {
            setChatError("Cannot send an empty message.");
            return false;
        }
        // Validate session and chat IDs
        if (activeSessionId === null || activeChatId === null) {
            setChatError("Please select a chat first.");
             console.error("Submit failed: No active session or chat ID.");
            return false;
        }

        try {
            setIsAiResponding(true); // Set AI responding state
            setChatError(''); // Clear previous errors
            const queryToSend = currentQuery; // Capture query before clearing
            setCurrentQuery(''); // Clear input immediately

            const { userMessage, aiMessage } = await addChatMessage(activeSessionId, activeChatId, queryToSend);

            // Update global state by adding messages to the correct chat in the correct session
            setPastSessions(prevSessions =>
                prevSessions.map(session => {
                    if (session.id === activeSessionId) {
                        return {
                            ...session,
                            chats: (session.chats || []).map(chat => {
                                if (chat.id === activeChatId) {
                                    return {
                                        ...chat,
                                        // Ensure messages array exists before spreading
                                        messages: [...(chat.messages || []), userMessage, aiMessage]
                                    };
                                }
                                return chat;
                            })
                        };
                    }
                    return session;
                })
            );

            if (!disabled) { // Refocus only if not disabled
               inputRef.current?.focus();
            }
        } catch (err) {
            console.error("Failed to send message:", err);
            setChatError('Failed to send message. Please try again.');
            // Restore query if sending failed? Optional.
            // setCurrentQuery(queryToSend);
        } finally {
            setIsAiResponding(false); // Reset AI responding state
        }
        return true;
    };

    // Handle Enter key for submission
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            trySubmit();
        }
    };

    // Handle button click for submission
    const handleSubmitClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        trySubmit();
    };

    // Handle cancel click (placeholder)
    const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        // TODO: Implement actual cancellation logic if backend supports it
        setToastMessageAtom("Cancellation not supported by backend yet.");
        if (!disabled) {
           inputRef.current?.focus();
        }
    };

    // Handle toast open/close state
    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open);
        if (!open) setToastMessageAtom(null); // Clear message when toast closes
    };

    // Determine button states based on props and internal state
    const showCancelButton = isAiResponding && !disabled; // Show cancel only if AI is responding and not generally disabled
    // Disable send if: component disabled OR no query OR no active chat OR AI responding
    const sendButtonDisabled = disabled || !currentQuery.trim() || activeChatId === null || isAiResponding;
    // Disable starred if: component disabled OR no active chat
    const starredButtonDisabled = disabled || activeChatId === null;
    // Disable main input if: component disabled OR no active chat OR AI responding
    const inputFieldDisabled = disabled || activeChatId === null || isAiResponding;


    return (
        <>
            <Flex direction="column" gap="1">
                <Flex align="start" gap="2" width="100%">
                    {/* Starred Templates Button */}
                    <Box position="relative" flexShrink="0">
                        <IconButton
                            type="button"
                            variant="soft"
                            size="2"
                            title="Show Starred Templates"
                            onClick={() => setShowTemplates((prev) => !prev)}
                            aria-label="Show starred templates"
                            disabled={starredButtonDisabled} // Use combined disabled state
                        >
                            <StarIcon width={16} height={16} />
                        </IconButton>
                        {/* Templates Popover */}
                        {showTemplates && <StarredTemplatesList onSelectTemplate={handleSelectTemplate} onClose={() => setShowTemplates(false)} />}
                    </Box>
                    {/* Main Text Input */}
                    <TextField.Root
                        ref={inputRef}
                        size="2"
                        style={{ flexGrow: 1 }}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentQuery(e.target.value)}
                        disabled={inputFieldDisabled} // Use combined disabled state
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                    />
                    {/* Send / Cancel Button */}
                    {showCancelButton ? (
                        <IconButton
                           type="button"
                           color="red"
                           variant="solid"
                           size="2"
                           onClick={handleCancelClick}
                           title="Cancel response (Not Implemented)"
                           aria-label="Cancel AI response"
                           // Cancel button isn't typically disabled by the general 'disabled' prop, only by AI state
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
                            disabled={sendButtonDisabled} // Use combined disabled state
                            title="Send message"
                            aria-label="Send message"
                        >
                            <PaperPlaneIcon />
                        </IconButton>
                    )}
                </Flex>
                {/* Error Message Display */}
                {chatError && <Text size="1" color="red" align="center" mt="1">{chatError}</Text>}
            </Flex>
            {/* Toast Notification Area */}
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
