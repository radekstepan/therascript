// Purpose: Displays a list of past chat sessions associated with the current therapy session,
//          excluding the currently active chat. Allows switching between these past chats.
// NOTE: This component might be integrated directly into SessionSidebar.tsx or potentially deprecated.
import React from 'react';
import { ListBulletIcon } from '@radix-ui/react-icons'; // Icon for the list header
import { Flex, Text, Separator, Box, ScrollArea } from '@radix-ui/themes'; // Radix UI components
import { formatTimestamp } from '../../../helpers'; // Helper for formatting timestamps
import type { ChatSession, Session } from '../../../types'; // Type definitions

interface PastChatsListProps {
  session: Session | null; // The current therapy session data
  activeChatId: number | null; // The ID of the currently viewed chat
  onSelectChatHistory: (chatId: number) => void; // Callback function when a past chat is selected
}

/**
 * Renders a scrollable list of past chats for the current session.
 */
export function PastChatsList({
  session,
  activeChatId,
  onSelectChatHistory,
}: PastChatsListProps) {
  // Don't render if no session, no chats, or only one chat exists
  if (!session || !session.chats || session.chats.length <= 1) {
    return null;
  }

  // Sort chats by timestamp (most recent first)
  const sortedChats = [...session.chats].sort(
    (a, b) => b.timestamp - a.timestamp
  );
  // Filter out the currently active chat to only show "past" chats relative to the active one
  const otherChats = sortedChats.filter((chat) => chat.id !== activeChatId);

  // Don't render if there are no *other* chats to display
  if (otherChats.length === 0) {
    return null;
  }

  /**
   * Generates a display title for a chat session.
   * Uses the chat's name if available, otherwise defaults to "Chat (Timestamp)".
   */
  const getChatDisplayTitle = (chat: ChatSession): string => {
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  return (
    <Box mt="4" style={{ maxHeight: '100%' }}>
      {' '}
      {/* Allow vertical expansion */}
      {/* Header for the Past Chats section */}
      <Flex align="center" gap="2" px="3" pt="2" pb="1">
        <ListBulletIcon className="text-[--gray-a10]" />
        <Text size="1" weight="medium" color="gray">
          Past Chats
        </Text>
      </Flex>
      <Separator size="4" /> {/* Visual separator */}
      {/* Scrollable area for the chat list */}
      <ScrollArea
        type="auto"
        scrollbars="vertical"
        style={{ maxHeight: '12rem' }}
      >
        {' '}
        {/* Limit max height */}
        <Box p="1">
          {/* Iterate over the other (non-active) chats */}
          {otherChats.map((chat) => (
            <Box
              key={chat.id}
              // Call the selection handler on click
              onClick={() => onSelectChatHistory(chat.id)}
              // Allow selection via keyboard (Enter or Space)
              onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectChatHistory(chat.id);
                }
              }}
              tabIndex={0} // Make it focusable
              role="button" // Indicate interactivity
              aria-label={`Switch to: ${getChatDisplayTitle(chat)}`} // Accessibility label
              // Styling for interactive list items
              className="block w-full p-2 rounded hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7] cursor-pointer"
              title={`Switch to: ${getChatDisplayTitle(chat)}`} // Tooltip
            >
              {/* Display the chat title (truncated if necessary) */}
              <Text size="2" truncate>
                {getChatDisplayTitle(chat)}
              </Text>
            </Box>
          ))}
        </Box>
      </ScrollArea>
    </Box>
  );
}
