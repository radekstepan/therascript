import React from 'react';
import { useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { ChatBubbleIcon } from '@radix-ui/react-icons';
import { Flex, Text } from '@radix-ui/themes';
import { useQuery } from '@tanstack/react-query';
import { activeChatIdAtom, activeSessionIdAtom } from '../../../store'; // Need ID
import { formatTimestamp } from '../../../helpers';
import { fetchSession } from '../../../api/api'; // To get chat metadata if needed
import type { ChatSession, Session } from '../../../types';

export function ChatHeader() {
  const activeChatId = useAtomValue(activeChatIdAtom);
  const activeSessionId = useAtomValue(activeSessionIdAtom);

  // Fetch session meta to get the chat list
  const { data: session } = useQuery<Session, Error>({
      queryKey: ['sessionMeta', activeSessionId],
      enabled: !!activeSessionId, // Only fetch if session ID exists
      staleTime: 5 * 60 * 1000, // Cache metadata
  });

  const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
    if (!chat) return 'No Chat Selected';
    // TODO: Consider showing loading state if session is loading?
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  const activeChat = activeChatId !== null
    ? (session?.chats || []).find(c => c.id === activeChatId)
    : null;

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
