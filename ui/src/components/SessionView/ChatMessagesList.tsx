// src/components/SessionView/ChatMessagesList.tsx
import React from 'react';
import { Box, Flex, Spinner } from '@radix-ui/themes';
import { useAtomValue } from 'jotai';
import {
    // Import specific atoms from source files or main index
    currentChatMessagesAtom,   // From derivedAtoms.ts
    isChattingAtom             // From chatAtoms.ts
} from '../../store'; // Use main index
import { ChatMessageItem } from './ChatMessageItem';
import type { ChatMessage } from '../../types';

interface ChatMessagesListProps {
    onStarClick: (message: ChatMessage) => void;
}

export function ChatMessagesList({ onStarClick }: ChatMessagesListProps) {
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isAiThinking = useAtomValue(isChattingAtom); // Use correct atom

    return (
        <Box className="space-y-3 p-1">
            {chatMessages.map((msg) => (
                <ChatMessageItem key={msg.id} msg={msg} onStarClick={onStarClick} />
            ))}
            {isAiThinking && (
                <Flex align="start" gap="2" justify="start">
                    <Box className="rounded-lg p-2 px-3 text-sm bg-[--gray-a3] text-[--gray-a11] shadow-sm">
                        <Flex align="center" gap="1" style={{ fontStyle: 'italic' }}>
                            <Spinner size="1" /> Thinking...
                        </Flex>
                    </Box>
                </Flex>
            )}
        </Box>
    );
}
