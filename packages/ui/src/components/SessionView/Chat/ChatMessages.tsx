import React from 'react';
import { Box, Flex, Spinner, Text } from '@radix-ui/themes';
import type { ChatMessage } from '../../../types';

interface ChatMessagesProps {
  messages: ChatMessage[];
  activeChatId: number | null;
  isStandalone: boolean;
  streamingMessageId: number | null;
}

export function ChatMessages({
  messages,
  activeChatId,
  isStandalone,
  streamingMessageId,
}: ChatMessagesProps) {
  return (
    <Flex direction="column" gap="3">
      {messages.map((message) => (
        <Box
          key={message.id}
          p="3"
          style={{
            backgroundColor:
              message.sender === 'user' ? 'var(--gray-3)' : 'var(--gray-5)',
            borderRadius: 'var(--radius-2)',
            maxWidth: '80%',
            alignSelf: message.sender === 'user' ? 'flex-end' : 'flex-start',
          }}
        >
          {message.id === streamingMessageId && message.text === '' ? (
            <Flex align="center" gap="2">
              <Spinner size="2" />
              <Text color="gray">Waiting for response...</Text>
            </Flex>
          ) : (
            <Text>{message.text || '...'}</Text>
          )}
        </Box>
      ))}
    </Flex>
  );
}
