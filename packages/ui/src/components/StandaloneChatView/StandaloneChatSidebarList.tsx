// =========================================
// File: packages/ui/src/components/StandaloneChatView/StandaloneChatSidebarList.tsx
// =========================================
/*
 * packages/ui/src/components/StandaloneChatView/StandaloneChatSidebarList.tsx
 *
 * This file contains the StandaloneChatSidebarList component, specifically designed
 * for rendering a compact list of standalone chats within the sidebar.
 * It uses Flexbox for layout and provides options via a dropdown menu.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatBubbleIcon,
  DotsHorizontalIcon,
  Pencil1Icon, // Keep icon, change text
  TrashIcon,
} from '@radix-ui/react-icons';
import { Flex, Text, IconButton, DropdownMenu, Box } from '@radix-ui/themes';
import type { StandaloneChatListItem } from '../../types'; // <-- Import from types
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils';

interface StandaloneChatSidebarListProps {
  chats: StandaloneChatListItem[];
  onRenameChatRequest: (chat: StandaloneChatListItem) => void; // Renamed prop -> onEditChatRequest
  onDeleteChatRequest: (chat: StandaloneChatListItem) => void;
  activeChatId?: number | null;
}

// Renamed prop in function signature
export function StandaloneChatSidebarList({
  chats,
  onRenameChatRequest: onEditChatRequest,
  onDeleteChatRequest,
  activeChatId,
}: StandaloneChatSidebarListProps) {
  const navigate = useNavigate();

  // Click/Keydown handlers remain the same
  const handleChatClick = (
    e: React.MouseEvent<HTMLDivElement>,
    chatId: number
  ) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button[aria-label="Standalone chat options"], [role="menu"]'
      )
    ) {
      return;
    }
    navigate(`/chats/${chatId}`);
  };
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    chatId: number
  ) => {
    if (
      e.key === 'Enter' &&
      !(e.target as HTMLElement).closest(
        'button[aria-label="Standalone chat options"]'
      )
    ) {
      navigate(`/chats/${chatId}`);
    }
  };

  const getChatDisplayTitle = (chat: StandaloneChatListItem): string => {
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  return (
    <nav aria-label="Standalone Chats" className="flex-grow overflow-y-auto">
      <Flex direction="column" gap="1" p="1">
        {chats.map((chat) => {
          const isActive = activeChatId === chat.id;
          return (
            <Flex
              key={chat.id}
              align="center"
              justify="between"
              gap="1"
              className={cn(
                'w-full px-2 py-1.5 rounded-md group cursor-pointer',
                isActive
                  ? 'bg-[--accent-a4] text-[--accent-11] font-medium'
                  : 'text-[--gray-a11] hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7]',
                'transition-colors duration-150'
              )}
              onClick={(e: React.MouseEvent<HTMLDivElement>) =>
                handleChatClick(e, chat.id)
              }
              onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) =>
                handleKeyDown(e, chat.id)
              }
              tabIndex={0}
              role="link"
              aria-current={isActive ? 'page' : undefined}
              title={getChatDisplayTitle(chat)}
            >
              {/* Left side: Icon and Text (unchanged) */}
              <Flex
                align="center"
                gap="2"
                className="flex-grow pr-1"
                style={{ minWidth: 0 }}
              >
                <ChatBubbleIcon
                  className={cn(
                    'text-[--gray-a10] flex-shrink-0',
                    isActive && 'text-[--accent-11]'
                  )}
                />
                <Text size="2" truncate className="flex-grow">
                  {getChatDisplayTitle(chat)}
                </Text>
              </Flex>

              {/* Right side: Options Button/Menu */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    className={cn(
                      'flex-shrink-0 p-1',
                      isActive
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                      'data-[state=open]:opacity-100 data-[state=open]:bg-[--accent-a4] transition-opacity'
                    )}
                    aria-label="Standalone chat options"
                    title="Standalone chat options"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <DotsHorizontalIcon />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                  align="end"
                  size="1"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {/* Updated Edit Option */}
                  <DropdownMenu.Item onSelect={() => onEditChatRequest(chat)}>
                    <Pencil1Icon width="14" height="14" className="mr-2" /> Edit
                    Details
                  </DropdownMenu.Item>
                  {/* Delete Option (unchanged) */}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    color="red"
                    onSelect={() => onDeleteChatRequest(chat)}
                  >
                    <TrashIcon width="14" height="14" className="mr-2" /> Delete
                    Chat
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Flex>
          );
        })}
      </Flex>
    </nav>
  );
}

// TODO comments should not be removed
