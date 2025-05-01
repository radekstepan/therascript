import React from 'react';
import { ChatBubbleIcon } from '@radix-ui/react-icons';
import { Flex, Text, Spinner } from '@radix-ui/themes'; // Import Spinner
// Removed useQuery and related imports
import { formatTimestamp } from '../../../helpers';
import type { ChatSession, Session } from '../../../types';

interface ChatHeaderProps {
  session: Session | null; // Receive session data
  activeChatId: number | null; // Receive active chat ID
  isLoadingSessionMeta?: boolean; // Add loading state prop
}

// Accept props
export function ChatHeader({
  session,
  activeChatId,
  isLoadingSessionMeta,
}: ChatHeaderProps) {
  // REMOVED the useQuery hook for sessionMeta here
  // REMOVED useAtomValue for activeSessionId if it was only for the query

  const getChatDisplayTitle = (
    chat: ChatSession | undefined | null
  ): string => {
    if (isLoadingSessionMeta) return 'Loading Chat...'; // Show loading state
    if (!chat) return 'No Chat Selected';
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  // Use the session prop directly to find the active chat
  const activeChat =
    activeChatId !== null
      ? (session?.chats || []).find((c) => c.id === activeChatId)
      : null;

  const activeChatTitle = getChatDisplayTitle(activeChat);

  return (
    <Flex align="center" justify="between" py="3" px="4" gap="3">
      <Flex align="center" gap="2" style={{ minWidth: 0, flexGrow: 1 }}>
        {isLoadingSessionMeta ? (
          <Spinner size="2" />
        ) : (
          <ChatBubbleIcon
            className="text-[--accent-9] flex-shrink-0"
            width="20"
            height="20"
          />
        )}
        <Flex align="center" gap="1" style={{ minWidth: 0 }}>
          <Text weight="medium" truncate title={activeChatTitle}>
            {activeChatTitle}
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
}
