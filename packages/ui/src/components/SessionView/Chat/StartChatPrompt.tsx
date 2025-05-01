import React from 'react';
import { Button, Card, Flex, Text } from '@radix-ui/themes';
import { ChatBubbleIcon } from '@radix-ui/react-icons';

interface StartChatPromptProps {
  onStartFirstChat: () => void;
  isLoading?: boolean; // Add loading state prop
}

export function StartChatPrompt({
  onStartFirstChat,
  isLoading = false,
}: StartChatPromptProps) {
  return (
    <Card
      size="3"
      className="flex flex-col flex-grow items-center justify-center text-center h-full"
      style={{ borderStyle: 'dashed' }}
    >
      <Flex direction="column" align="center" gap="4">
        <ChatBubbleIcon className="w-12 h-12 text-[--gray-a7]" />
        <Text color="gray">
          No chats have been started for this session yet.
        </Text>
        <Button
          onClick={onStartFirstChat}
          variant="soft"
          size="2"
          disabled={isLoading} // Disable button while loading
        >
          <ChatBubbleIcon width="16" height="16" />
          <Text ml="2">{isLoading ? 'Starting...' : 'Start New Chat'}</Text>
        </Button>
      </Flex>
    </Card>
  );
}
