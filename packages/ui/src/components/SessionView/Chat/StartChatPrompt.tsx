import React from 'react';
import { Button, Card, Flex, Text } from '@radix-ui/themes';
import { ChatBubbleIcon } from '@radix-ui/react-icons';

interface StartChatPromptProps {
    onStartFirstChat: () => void;
}

export function StartChatPrompt({ onStartFirstChat }: StartChatPromptProps) {
    return (
        <Card size="3" className="flex flex-col flex-grow items-center justify-center text-center h-full" style={{ borderStyle: 'dashed' }}>
            <Flex direction="column" align="center" gap="4">
                <ChatBubbleIcon className="w-12 h-12 text-[--gray-a7]" />
                <Text color="gray">
                    No chats have been started for this session yet.
                </Text>
                <Button
                    onClick={onStartFirstChat}
                    variant="soft"
                    size="2"
                >
                    <ChatBubbleIcon width="16" height="16" />
                    <Text ml="2">Start New Chat</Text>
                </Button>
            </Flex>
        </Card>
    );
}
