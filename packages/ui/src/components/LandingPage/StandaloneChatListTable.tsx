// File: packages/ui/src/components/LandingPage/StandaloneChatListTable.tsx
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
import { cn } from '../../utils'; // Import cn

interface StandaloneChatListTableProps {
    chats: StandaloneChatListItem[];
    onRenameChatRequest: (chat: StandaloneChatListItem) => void;
    onDeleteChatRequest: (chat: StandaloneChatListItem) => void;
    activeChatId?: number | null; // Optional: Pass activeChatId for highlighting
}

export function StandaloneChatListTable({ chats, onRenameChatRequest, onDeleteChatRequest, activeChatId }: StandaloneChatListTableProps) {
    const navigate = useNavigate();

    const handleChatClick = (e: React.MouseEvent<HTMLDivElement>, chatId: number) => { // Changed event type
        const target = e.target as HTMLElement;
        // Prevent navigation if clicking on the options button or inside the dropdown menu
        if (target.closest('button[aria-label="Standalone chat options"], [role="menu"]')) {
             return;
        }
        navigate(`/chats/${chatId}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, chatId: number) => { // Changed event type
        // Prevent navigation if Enter is pressed on the options button
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button[aria-label="Standalone chat options"]')) {
            navigate(`/chats/${chatId}`);
        }
        // Space/Enter on the button itself will trigger the dropdown via Radix Themes
    };

    const getChatDisplayTitle = (chat: StandaloneChatListItem): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };


    return (
        // Use nav element for semantic list of links
        <nav aria-label="Standalone Chats" className="flex-grow overflow-y-auto">
            {/* Remove Table structure */}
            <Flex direction="column" gap="1" p="1"> {/* Use Flex container */}
                {chats.map((chat) => {
                    const isActive = activeChatId === chat.id; // Check if this chat is active
                    return (
                        <Flex // Use Flex for each row item
                            key={chat.id}
                            align="center"
                            justify="between"
                            gap="1"
                            className={cn(
                                "w-full px-2 py-1.5 rounded-md group cursor-pointer", // Base styles
                                isActive
                                    ? "bg-[--accent-a4] text-[--accent-11] font-medium" // Active styles
                                    : "text-[--gray-a11] hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7]", // Inactive styles
                                "transition-colors duration-150"
                            )}
                            onClick={(e: React.MouseEvent<HTMLDivElement>) => handleChatClick(e, chat.id)} // Adapt click handler
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => handleKeyDown(e, chat.id)} // Adapt keydown handler
                            tabIndex={0}
                            role="link" // Treat as a link semantically
                            aria-current={isActive ? 'page' : undefined}
                            title={getChatDisplayTitle(chat)}
                        >
                            {/* Left side: Icon and Text */}
                            <Flex align="center" gap="2" className="flex-grow pr-1" style={{ minWidth: 0 }}>
                                <ChatBubbleIcon className={cn("text-[--gray-a10]", isActive && "text-[--accent-11]")} />
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
                                            "flex-shrink-0 p-1",
                                            // Always show if active, otherwise show on hover/focus
                                            isActive
                                                ? "opacity-100"
                                                : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                                            "data-[state=open]:opacity-100 data-[state=open]:bg-[--accent-a4] transition-opacity"
                                        )}
                                        aria-label="Standalone chat options"
                                        title="Standalone chat options"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }} // Prevent navigation when clicking button
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
                                    <DropdownMenu.Item onSelect={() => onRenameChatRequest(chat)}>
                                        <Pencil1Icon width="14" height="14" className="mr-2"/> Rename Chat
                                    </DropdownMenu.Item>
                                    <DropdownMenu.Separator />
                                    <DropdownMenu.Item color="red" onSelect={() => onDeleteChatRequest(chat)}>
                                        <TrashIcon width="14" height="14" className="mr-2"/> Delete Chat
                                    </DropdownMenu.Item>
                                </DropdownMenu.Content>
                            </DropdownMenu.Root>
                        </Flex>
                )})}
            </Flex>
        </nav>
    );
}

// TODO comments should not be removed
