// packages/ui/src/components/Shared/ChatSidebarListItem.tsx
import React from 'react';
import { Flex, Text, IconButton, DropdownMenu, Box } from '@radix-ui/themes';
import {
  ChatBubbleIcon,
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../utils';
import { formatTimestamp } from '../../helpers';

// Define a base interface for common properties (constraint for the generic)
interface BaseChatItem {
  id: number;
  timestamp: number;
  name?: string | null;
}

// Make the component generic with type T extending BaseChatItem
interface ChatSidebarListItemProps<T extends BaseChatItem> {
  item: T; // Use the generic type T for the item
  isActive: boolean;
  onSelect: (itemId: number) => void;
  onEditRequest: (item: T) => void; // Callback expects the specific type T
  onDeleteRequest: (item: T) => void; // Callback expects the specific type T
  editLabel: string;
}

/**
 * Reusable generic component to render a single chat item in a sidebar list.
 * Handles display, active state, selection, and action menus.
 */
export function ChatSidebarListItem<T extends BaseChatItem>({
  // Use the generic type parameter
  item,
  isActive,
  onSelect,
  onEditRequest,
  onDeleteRequest,
  editLabel,
}: ChatSidebarListItemProps<T>) {
  // Use the generic prop type
  // Helper to get the display title (works with BaseChatItem)
  const getChatDisplayTitle = (chatItem: T): string => {
    return chatItem.name || `Chat (${formatTimestamp(chatItem.timestamp)})`;
  };

  // Handlers remain the same conceptually, but will work with type T
  const handleItemClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button[aria-label="Chat item options"], [role="menuitem"]'
      )
    ) {
      return;
    }
    onSelect(item.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLElement;
      if (!target.closest('button[aria-label="Chat item options"]')) {
        onSelect(item.id);
      }
    }
  };

  return (
    // Rest of the JSX remains the same, using `item` which is now of type T
    <Flex
      key={item.id}
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
      onClick={handleItemClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-current={isActive ? 'page' : undefined}
      title={getChatDisplayTitle(item)}
    >
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
          {getChatDisplayTitle(item)}
        </Text>
      </Flex>
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
            aria-label="Chat item options"
            title="Chat item options"
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
          <DropdownMenu.Item onSelect={() => onEditRequest(item)}>
            <Pencil1Icon width="14" height="14" className="mr-2" /> {editLabel}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item color="red" onSelect={() => onDeleteRequest(item)}>
            <TrashIcon width="14" height="14" className="mr-2" /> Delete Chat
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Flex>
  );
}
