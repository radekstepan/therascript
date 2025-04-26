/*
 * packages/ui/src/components/LandingPage/StandaloneChatListTable.tsx
 *
 * This file contains the StandaloneChatListTable component, which displays a list of standalone chats
 * in a table format, similar to the session history table. It includes columns for the chat name,
 * creation date, tags, and actions like editing or deleting.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChatBubbleIcon,
    DotsHorizontalIcon,
    Pencil1Icon,
    TrashIcon,
} from '@radix-ui/react-icons';
import { Table, Text, Flex, IconButton, DropdownMenu, Badge } from '@radix-ui/themes';
import type { StandaloneChatListItem } from '../../api/api';
import { formatTimestamp } from '../../helpers';

interface StandaloneChatListTableProps {
    chats: StandaloneChatListItem[];
    onEditChatRequest: (chat: StandaloneChatListItem) => void; // Renamed prop
    onDeleteChatRequest: (chat: StandaloneChatListItem) => void;
    activeChatId?: number | null;
}

export function StandaloneChatListTable({ chats, onEditChatRequest, onDeleteChatRequest }: StandaloneChatListTableProps) {
    const navigate = useNavigate();

    const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>, chatId: number) => {
        const target = e.target as HTMLElement;
        if (target.closest('button[aria-label="Standalone chat options"]')) {
             return;
        }
        if (target.closest('[role="menu"]')) {
             return;
        }
        navigate(`/chats/${chatId}`);
    };
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, chatId: number) => {
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button[aria-label="Standalone chat options"]')) {
            navigate(`/chats/${chatId}`);
        }
    };

    const getChatDisplayTitle = (chat: StandaloneChatListItem): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };


    return (
        <div className="flex-grow overflow-y-auto">
            <Table.Root variant="surface" size="2">
                {/* Table Header */}
                <Table.Header style={{ backgroundColor: 'var(--gray-a2)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <Table.Row>
                        <Table.ColumnHeaderCell justify="start">Name</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Date</Table.ColumnHeaderCell>
                        {/* --- Changed Header Text --- */}
                        <Table.ColumnHeaderCell>Tags</Table.ColumnHeaderCell>
                        {/* --- End Change --- */}
                        <Table.ColumnHeaderCell align="right" style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</Table.ColumnHeaderCell>
                    </Table.Row>
                </Table.Header>

                {/* Table Body */}
                <Table.Body>
                    {chats.map((chat) => (
                        <Table.Row
                            key={chat.id}
                            onClick={(e) => handleRowClick(e, chat.id)}
                            onKeyDown={(e) => handleKeyDown(e, chat.id)}
                            className="cursor-pointer hover:bg-[--gray-a3] transition-colors duration-150 group" // Keep group for potential future use, though button is always visible now
                            aria-label={`Load chat: ${getChatDisplayTitle(chat)}`}
                            tabIndex={0}
                        >
                            {/* Name Cell (unchanged) */}
                            <Table.RowHeaderCell justify="start">
                                <Flex align="center" gap="2">
                                    <ChatBubbleIcon className="text-[--gray-a10]" />
                                    <Text weight="medium" truncate>{getChatDisplayTitle(chat)}</Text>
                                </Flex>
                            </Table.RowHeaderCell>

                            {/* Date Cell (unchanged) */}
                            <Table.Cell>
                                <Text color="gray">{formatTimestamp(chat.timestamp)}</Text>
                            </Table.Cell>

                            {/* Tags Cell - Render tags if available */}
                            <Table.Cell>
                                <Flex gap="1" wrap="wrap">
                                    {(chat.tags && chat.tags.length > 0) ? (
                                        chat.tags.slice(0, 3).map(tag => ( // Limit displayed tags
                                            <Badge key={tag} color="gray" variant="soft" radius="full" size="1">
                                                {tag}
                                            </Badge>
                                        ))
                                    ) : (
                                        <Text color="gray" style={{ fontStyle: 'italic', fontSize: 'var(--font-size-1)'}}></Text>
                                    )}
                                    {chat.tags && chat.tags.length > 3 && (
                                         <Badge color="gray" variant="soft" radius="full" size="1">...</Badge>
                                    )}
                                </Flex>
                            </Table.Cell>

                            {/* Actions Cell */}
                            <Table.Cell align="right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger>
                                        {/* --- Removed opacity/group-hover classes to make always visible --- */}
                                        <IconButton
                                            variant="ghost"
                                            color="gray"
                                            size="1"
                                            className="p-1 data-[state=open]:bg-[--accent-a4]" // Keep open state style
                                            aria-label="Standalone chat options"
                                            title="Standalone chat options"
                                        >
                                            <DotsHorizontalIcon />
                                        </IconButton>
                                        {/* --- End Change --- */}
                                    </DropdownMenu.Trigger>
                                    <DropdownMenu.Content
                                        align="end"
                                        size="1"
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                    >
                                        {/* Updated Edit Option */}
                                        <DropdownMenu.Item onSelect={() => onEditChatRequest(chat)}>
                                            <Pencil1Icon width="14" height="14" className="mr-2"/> Edit Details
                                        </DropdownMenu.Item>
                                        {/* Delete Option (unchanged) */}
                                        <DropdownMenu.Separator />
                                        <DropdownMenu.Item color="red" onSelect={() => onDeleteChatRequest(chat)}>
                                            <TrashIcon width="14" height="14" className="mr-2"/> Delete Chat
                                        </DropdownMenu.Item>
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

// TODO comments should not be removed
