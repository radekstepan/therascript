import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon, PaperPlaneIcon, StopIcon, Cross2Icon } from '@radix-ui/react-icons';
import * as Toast from '@radix-ui/react-toast';
import { Button, TextField, Flex, Box, Text, IconButton } from '@radix-ui/themes';
import { StarredTemplatesList } from './StarredTemplates'; // Adjusted path
import { addChatMessage } from '../../../api/api'; // Adjusted path
import {
    currentQueryAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    chatErrorAtom,
    toastMessageAtom,
    isChattingAtom,
    pastSessionsAtom,
} from '../../../store'; // Adjusted path
import type { ChatSession } from '../../../types'; // Adjusted path

interface ChatInputProps {
    disabled?: boolean;
}

export function ChatInput({ disabled = false }: ChatInputProps) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const toastMessageContent = useAtomValue(toastMessageAtom);
    const setToastMessageAtom = useSetAtom(toastMessageAtom);
    const [isToastVisible, setIsToastVisible] = useState(false);
    const [isAiResponding, setIsAiResponding] = useAtom(isChattingAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    useEffect(() => {
        if (activeChatId !== null && !disabled) {
            inputRef.current?.focus();
        }
    }, [activeChatId, disabled]);

    useEffect(() => {
        if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery !== '') {
            setChatError('');
        }
    }, [currentQuery, chatError, setChatError]);

    useEffect(() => {
        setIsToastVisible(!!toastMessageContent);
    }, [toastMessageContent]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery((prev) => (prev ? `${prev} ${text}` : text));
        setShowTemplates(false);
        if (!disabled) {
            inputRef.current?.focus();
        }
    };

    const trySubmit = async () => {
        if (disabled) {
             console.log("Submit prevented: ChatInput is disabled.");
             return false;
        }
        if (isAiResponding) {
            setToastMessageAtom("Please wait for the AI to finish responding.");
            return false;
        }
        if (!currentQuery.trim()) {
            setChatError("Cannot send an empty message.");
            return false;
        }
        if (activeSessionId === null || activeChatId === null) {
            setChatError("Please select a chat first.");
             console.error("Submit failed: No active session or chat ID.");
            return false;
        }

        try {
            setIsAiResponding(true);
            setChatError('');
            const queryToSend = currentQuery;
            setCurrentQuery('');

            const { userMessage, aiMessage } = await addChatMessage(activeSessionId, activeChatId, queryToSend);

            setPastSessions(prevSessions =>
                prevSessions.map(session => {
                    if (session.id === activeSessionId) {
                        return {
                            ...session,
                            chats: (session.chats || []).map(chat => {
                                if (chat.id === activeChatId) {
                                    return {
                                        ...chat,
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

            if (!disabled) {
               inputRef.current?.focus();
            }
        } catch (err) {
            console.error("Failed to send message:", err);
            setChatError('Failed to send message. Please try again.');
        } finally {
            setIsAiResponding(false);
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
        setToastMessageAtom("Cancellation not supported by backend yet.");
        if (!disabled) {
           inputRef.current?.focus();
        }
    };

    const handleToastOpenChange = (open: boolean) => {
        setIsToastVisible(open);
        if (!open) setToastMessageAtom(null);
    };

    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = disabled || !currentQuery.trim() || activeChatId === null || isAiResponding;
    const starredButtonDisabled = disabled || activeChatId === null;
    const inputFieldDisabled = disabled || activeChatId === null || isAiResponding;

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
                        placeholder="Ask about the session..."
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
                            title="Send message"
                            aria-label="Send message"
                        >
                            <PaperPlaneIcon />
                        </IconButton>
                    )}
                </Flex>
                {chatError && <Text size="1" color="red" align="center" mt="1">{chatError}</Text>}
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
