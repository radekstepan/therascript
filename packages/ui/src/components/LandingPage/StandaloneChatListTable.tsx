/* packages/ui/src/components/LandingPage/StandaloneChatListTable.tsx */
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChatBubbleIcon,
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon, // <-- Import TrashIcon
  ChevronUpIcon,
  ChevronDownIcon,
} from '@radix-ui/react-icons';
import {
  Table,
  Text,
  Flex,
  IconButton,
  DropdownMenu,
  Badge,
} from '@radix-ui/themes';
import type { StandaloneChatListItem } from '../../types';
import type { StandaloneChatSortCriteria, SortDirection } from '../../store';
import { formatTimestamp } from '../../helpers';

interface StandaloneChatListTableProps {
  chats: StandaloneChatListItem[];
  onEditChatRequest: (chat: StandaloneChatListItem) => void;
  onDeleteChatRequest: (chat: StandaloneChatListItem) => void; // <-- New prop
  activeChatId?: number | null;
  sortCriteria: StandaloneChatSortCriteria;
  sortDirection: SortDirection;
  onSort: (criteria: StandaloneChatSortCriteria) => void;
}

type AriaSort = 'none' | 'ascending' | 'descending' | 'other' | undefined;

export function StandaloneChatListTable({
  chats,
  onEditChatRequest,
  onDeleteChatRequest, // <-- Destructure new prop
  sortCriteria,
  sortDirection,
  onSort,
}: StandaloneChatListTableProps) {
  const navigate = useNavigate();

  const handleRowClick = (
    e: React.MouseEvent<HTMLTableRowElement>,
    chatId: number
  ) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button[aria-label="Standalone chat options"], th[aria-sort]'
      )
    ) {
      return;
    }
    if (target.closest('[role="menu"]')) {
      return;
    }
    navigate(`/chats/${chatId}`);
  };
  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    chatId: number
  ) => {
    if (
      e.key === 'Enter' &&
      !(e.target as HTMLElement).closest(
        'button[aria-label="Standalone chat options"], th[aria-sort]'
      )
    ) {
      navigate(`/chats/${chatId}`);
    }
  };

  const getChatDisplayTitle = (chat: StandaloneChatListItem): string => {
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  const renderSortIcon = useCallback(
    (criteria: StandaloneChatSortCriteria) => {
      if (sortCriteria !== criteria) {
        return (
          <ChevronDownIcon className="h-3 w-3 ml-1 text-[--gray-a9] opacity-0 group-hover:opacity-100 transition-opacity" />
        );
      }
      if (sortDirection === 'asc') {
        return <ChevronUpIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />;
      }
      return <ChevronDownIcon className="h-4 w-4 ml-1 text-[--gray-a11]" />;
    },
    [sortCriteria, sortDirection]
  );

  const getHeaderCellProps = useCallback(
    (
      criteria: StandaloneChatSortCriteria
    ): React.ThHTMLAttributes<HTMLTableHeaderCellElement> => {
      const isActiveSortColumn = sortCriteria === criteria;
      const sortValue: AriaSort = isActiveSortColumn
        ? sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none';

      return {
        onClick: () => onSort(criteria),
        'aria-sort': sortValue,
        style: { cursor: 'pointer', whiteSpace: 'nowrap' },
        className: 'group',
      };
    },
    [sortCriteria, sortDirection, onSort]
  );

  return (
    <div className="flex-grow overflow-y-auto">
      <Table.Root variant="surface" size="2">
        {/* Table Header */}
        <Table.Header
          style={{
            backgroundColor: 'var(--gray-a2)',
            position: 'sticky',
            top: 0,
            zIndex: 1,
          }}
        >
          <Table.Row>
            <Table.ColumnHeaderCell
              {...getHeaderCellProps('name')}
              justify="start"
            >
              <Flex align="center">Name {renderSortIcon('name')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('date')}>
              <Flex align="center">Date {renderSortIcon('date')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell {...getHeaderCellProps('tags')}>
              <Flex align="center">Tags {renderSortIcon('tags')}</Flex>
            </Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell
              align="right"
              style={{ width: '1%', whiteSpace: 'nowrap' }}
            >
              Actions
            </Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>

        {/* Table Body */}
        <Table.Body>
          {chats.map((chat) => (
            <Table.Row
              key={chat.id}
              onClick={(e) => handleRowClick(e, chat.id)}
              onKeyDown={(e) => handleKeyDown(e, chat.id)}
              className="cursor-pointer hover:bg-[--gray-a3] transition-colors duration-150"
              aria-label={`Load chat: ${getChatDisplayTitle(chat)}`}
              tabIndex={0}
            >
              {/* Name Cell */}
              <Table.RowHeaderCell justify="start">
                <Flex align="center" gap="2">
                  <ChatBubbleIcon className="text-[--gray-a10]" />
                  <Text weight="medium" truncate>
                    {getChatDisplayTitle(chat)}
                  </Text>
                </Flex>
              </Table.RowHeaderCell>

              {/* Date Cell */}
              <Table.Cell>
                <Text color="gray">{formatTimestamp(chat.timestamp)}</Text>
              </Table.Cell>

              {/* Tags Cell */}
              <Table.Cell>
                <Flex gap="1" wrap="wrap">
                  {chat.tags && chat.tags.length > 0 ? (
                    chat.tags.slice(0, 3).map((tag: string) => (
                      <Badge
                        key={tag}
                        color="gray"
                        variant="soft"
                        radius="full"
                        size="1"
                      >
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <Text
                      color="gray"
                      style={{
                        fontStyle: 'italic',
                        fontSize: 'var(--font-size-1)',
                      }}
                    ></Text>
                  )}
                  {chat.tags && chat.tags.length > 3 && (
                    <Badge color="gray" variant="soft" radius="full" size="1">
                      ...
                    </Badge>
                  )}
                </Flex>
              </Table.Cell>

              {/* Actions Cell */}
              <Table.Cell
                align="right"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton
                      variant="ghost"
                      color="gray"
                      size="1"
                      className="p-1 data-[state=open]:bg-[--accent-a4]"
                      aria-label="Standalone chat options"
                      title="Standalone chat options"
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
                    <DropdownMenu.Item onSelect={() => onEditChatRequest(chat)}>
                      <Pencil1Icon width="14" height="14" className="mr-2" />{' '}
                      Edit Details
                    </DropdownMenu.Item>
                    {/* --- ADDED DELETE OPTION --- */}
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      color="red"
                      onSelect={() => onDeleteChatRequest(chat)}
                    >
                      <TrashIcon width="14" height="14" className="mr-2" />{' '}
                      Delete Chat
                    </DropdownMenu.Item>
                    {/* --- END ADDED DELETE OPTION --- */}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </div>
  );
}
