import React from 'react';
import { ListBulletIcon } from '@radix-ui/react-icons';
import { Card, Flex, Text, Separator, Box, ScrollArea } from '@radix-ui/themes'; // Use Themes components
import { formatTimestamp } from '../../helpers';
import type { ChatSession, Session } from '../../types';

interface PastChatsListProps {
    session: Session | null;
    activeChatId: number | null;
    onSelectChatHistory: (chatId: number) => void;
}

export function PastChatsList({ session, activeChatId, onSelectChatHistory }: PastChatsListProps) {
    if (!session || !session.chats || session.chats.length <= 1) {
        return null;
    }

    const sortedChats = [...session.chats].sort((a, b) => b.timestamp - a.timestamp);
    const otherChats = sortedChats.filter(chat => chat.id !== activeChatId);

    if (otherChats.length === 0) {
        return null;
    }

    const getChatDisplayTitle = (chat: ChatSession): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    return (
        // Use Themes Card
        <Card size="1" mt="4"> {/* Adjusted size and margin */}
             {/* Header using Flex */}
             <Flex align="center" gap="2" px="3" pt="2" pb="1">
                 <ListBulletIcon className="text-[--gray-a10]" /> {/* Themes color */}
                 <Text size="1" weight="medium" color="gray">Past Chats</Text>
             </Flex>
             <Separator size="4" /> {/* Use Themes Separator */}

             {/* Scrollable list container */}
             <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '9rem' }}> {/* Max height for scroll */}
                 <Box p="1">
                    {otherChats.map(chat => (
                        // Use Box or Flex, style like a button item
                        <Box
                            key={chat.id}
                            onClick={() => onSelectChatHistory(chat.id)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault(); onSelectChatHistory(chat.id);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Switch to: ${getChatDisplayTitle(chat)}`}
                            className="block w-full p-2 rounded hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7] cursor-pointer transition-colors" // Themes hover, focus ring
                            title={`Switch to: ${getChatDisplayTitle(chat)}`} // Keep title
                        >
                            <Text size="2" truncate> {/* Themes Text with truncate */}
                                {getChatDisplayTitle(chat)}
                            </Text>
                        </Box>
                    ))}
                 </Box>
            </ScrollArea>
        </Card>
    );
}
