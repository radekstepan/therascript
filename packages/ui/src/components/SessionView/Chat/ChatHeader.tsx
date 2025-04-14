import React from 'react';
import { useAtomValue } from 'jotai';
import { ChatBubbleIcon } from '@radix-ui/react-icons';
import { Flex, Text } from '@radix-ui/themes';
import { activeChatAtom } from '../../../store';
import { formatTimestamp } from '../../../helpers';
import type { ChatSession } from '../../../types';

export function ChatHeader() {
  const activeChat = useAtomValue(activeChatAtom);

  const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
    if (!chat) return 'No Chat Selected';
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };
  const activeChatTitle = getChatDisplayTitle(activeChat);

  return (
    <Flex align="center" justify="between" py="3" px="4" gap="3">
      <Flex align="center" gap="2" style={{ minWidth: 0, flexGrow: 1 }}>
        <ChatBubbleIcon className="text-[--accent-9] flex-shrink-0" width="20" height="20" />
        <Flex align="center" gap="1" style={{ minWidth: 0 }}>
          <Text weight="medium" truncate title={activeChatTitle}>
            {activeChatTitle}
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
}
