import React from 'react';
import { Text } from '@radix-ui/themes';

interface ChatMessagesEmptyProps {
    hasActiveChat: boolean;
}

export function ChatMessagesEmpty({ hasActiveChat }: ChatMessagesEmptyProps) {
    const message = hasActiveChat
        ? "No messages yet. Start typing below."
        : "Start a new chat or select one.";

    return (
        <Text color="gray" size="2" align="center" my="4" style={{ fontStyle: 'italic' }}>
            {message}
        </Text>
    );
}
