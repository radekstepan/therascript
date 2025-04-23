import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ChatBubbleIcon,
    DotsHorizontalIcon,
    Pencil1Icon,
    TrashIcon,
} from '@radix-ui/react-icons';
import { Table, Text, Flex, IconButton, DropdownMenu } from '@radix-ui/themes';
import type { StandaloneChatListItem } from '../../api/api'; // Use specific type
import { formatTimestamp } from '../../helpers';

interface StandaloneChatListTableProps {
    chats: StandaloneChatListItem[];
    onRenameChatRequest: (chat: StandaloneChatListItem) => void;
    onDeleteChatRequest: (chat: StandaloneChatListItem) => void;
}

export function StandaloneChatListTable({ chats, onRenameChatRequest, onDeleteChatRequest }: StandaloneChatListTableProps) {
    const navigate = useNavigate();

    const handleChatClick = (e: React.MouseEvent<HTMLTableRowElement>, chatId: number) => {
        const target = e.target as HTMLElement;
        if (target.closest('button[aria-label="Standalone chat options"]')) {
             return;
        }
        if (target.closest('[role="menu"]')) {
             return;
        }
        // TODO: Navigate to the dedicated standalone chat view route
        navigate(`/chats/${chatId}`); // Assuming this route exists
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, chatId: number) => {
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button[aria-label="Standalone chat options"]')) {
            // TODO: Navigate to the dedicated standalone chat view route
            navigate(`/chats/${chatId}`);
        }
    };

    const getChatDisplayTitle = (chat: StandaloneChatListItem): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };


    return (
        <div className="flex-grow overflow-y-auto">
             <Table.Root variant="surface" size="2">
                <Table.Header style={{ backgroundColor: 'var(--gray-a2)', position: 'sticky', top: 0, zIndex: 1 }}>
                    <Table.Row>
                        <Table.ColumnHeaderCell justify="start">
                             <Flex align="center" className="group">Chat Name</Flex>
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                             <Flex align="center" className="group">Started</Flex>
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell style={{ width: '1%', whiteSpace: 'nowrap' }} align="right">
                            Actions
                        </Table.ColumnHeaderCell>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {chats.map((chat) => (
                        <Table.Row
                            key={chat.id}
                            onClick={(e) => handleChatClick(e, chat.id)}
                            className="cursor-pointer hover:bg-[--gray-a3] transition-colors duration-150 group"
                            aria-label={`Open chat: ${getChatDisplayTitle(chat)}`}
                            tabIndex={0}
                            onKeyDown={(e) => handleKeyDown(e, chat.id)}
                        >
                            <Table.RowHeaderCell justify="start">
                                <Flex align="center" gap="2">
                                    <ChatBubbleIcon className="text-[--gray-a10]" />
                                    <Text weight="medium" truncate>{getChatDisplayTitle(chat)}</Text>
                                </Flex>
                            </Table.RowHeaderCell>
                            <Table.Cell>
                                <Text color="gray">{formatTimestamp(chat.timestamp)}</Text>
                            </Table.Cell>
                            {/* Actions Cell with Dropdown Menu */}
                            <Table.Cell align="right" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <DropdownMenu.Root>
                                    <DropdownMenu.Trigger>
                                        <IconButton
                                            variant="ghost"
                                            color="gray"
                                            size="1"
                                            className="p-1"
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
                                        <DropdownMenu.Item onSelect={() => onRenameChatRequest(chat)}>
                                            <Pencil1Icon width="14" height="14" className="mr-2"/> Rename Chat
                                        </DropdownMenu.Item>
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
