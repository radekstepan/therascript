/* packages/ui/src/components/StandaloneChatView/StandaloneChatSidebarList.tsx */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Flex, Box } from '@radix-ui/themes';
import type { StandaloneChatListItem } from '../../types';
// Import the generic component
import { ChatSidebarListItem } from '../Shared/ChatSidebarListItem';

interface StandaloneChatSidebarListProps {
  chats: StandaloneChatListItem[];
  onEditChatRequest: (chat: StandaloneChatListItem) => void;
  onDeleteChatRequest: (chat: StandaloneChatListItem) => void;
  activeChatId?: number | null;
}

export function StandaloneChatSidebarList({
  chats,
  onEditChatRequest,
  onDeleteChatRequest,
  activeChatId,
}: StandaloneChatSidebarListProps) {
  const navigate = useNavigate();

  const handleChatSelect = (chatId: number) => {
    navigate(`/chats/${chatId}`);
  };

  return (
    <nav aria-label="Standalone Chats" className="flex-grow overflow-y-auto">
      <Flex direction="column" gap="1" p="1">
        {chats.map((chat) => (
          // Provide the specific type as the generic argument
          <ChatSidebarListItem<StandaloneChatListItem>
            key={chat.id}
            item={chat}
            isActive={activeChatId === chat.id}
            onSelect={handleChatSelect}
            onEditRequest={onEditChatRequest} // Callback type now matches T (StandaloneChatListItem)
            onDeleteRequest={onDeleteChatRequest} // Callback type now matches T (StandaloneChatListItem)
            editLabel="Edit Details"
          />
        ))}
      </Flex>
    </nav>
  );
}
