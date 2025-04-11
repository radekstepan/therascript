import React from 'react';
import { Flex, Box, Text, IconButton, Spinner } from '@radix-ui/themes';
import { StarIcon, StarFilledIcon } from '@radix-ui/react-icons';
import type { ChatMessage } from '../../types';
import { cn } from '../../utils';

interface ChatMessageItemProps {
    msg: ChatMessage;
    onStarClick: (message: ChatMessage) => void; // Pass handler from parent
}

export function ChatMessageItem({ msg, onStarClick }: ChatMessageItemProps) {

    const handleIconClick = () => {
        onStarClick(msg);
    };

    const isUser = msg.sender === 'user';
    const bgColor = isUser ? 'bg-blue-600 dark:bg-blue-500' : 'bg-[--gray-a3]';
    const textColor = isUser ? 'text-white dark:text-white' : 'text-[--gray-a12]';

    return (
        <Flex
            key={msg.id} // Key should ideally be on the mapped element in the parent
            gap="2"
            align="start"
            className="group relative" // Keep group for hover effects
            justify={isUser ? 'end' : 'start'}
        >
            {/* AI Message */}
            {!isUser && (
                <Box
                    style={{ maxWidth: 'calc(100% - 1rem)' }} // Prevent overflow
                    className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', bgColor, textColor)}
                >
                    <Text size="2">{msg.text}</Text>
                    {/* Add spinner if needed for streaming responses later */}
                </Box>
            )}

            {/* User Message */}
            {isUser && (
                <>
                    {/* Star Icon Button */}
                    <Box className="flex-shrink-0 self-center mt-px">
                        <IconButton
                            variant="ghost"
                            color={msg.starred ? "yellow" : "gray"}
                            size="1"
                            className={cn(
                                "p-0 transition-opacity",
                                msg.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            )}
                            onClick={handleIconClick}
                            title={msg.starred ? "Unstar message" : "Star message as template"}
                            aria-label={msg.starred ? "Unstar message" : "Star message"}
                        >
                            {msg.starred ? <StarFilledIcon width="16" height="16" /> : <StarIcon width="14" height="14" />}
                        </IconButton>
                    </Box>
                    {/* Message Text Bubble */}
                    <Box
                        style={{ maxWidth: 'calc(100% - 2rem)' }} // Prevent overflow
                        className={cn('rounded-lg p-2 px-3 text-sm shadow-sm break-words', bgColor, textColor)}
                    >
                        <Text size="2">{msg.text}</Text>
                    </Box>
                </>
            )}
        </Flex>
    );
}
