import React from 'react';
import { ListBulletIcon } from '@radix-ui/react-icons';
import { Flex, Text, Separator, Box, ScrollArea } from '@radix-ui/themes';
import { formatTimestamp } from '../../../helpers'; // Adjusted path
import type { ChatSession, Session } from '../../../types'; // Adjusted path

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
        <Box mt="4" style={{ maxHeight: '100%' }}>
            <Flex align="center" gap="2" px="3" pt="2" pb="1">
                <ListBulletIcon className="text-[--gray-a10]" />
                <Text size="1" weight="medium" color="gray">Past Chats</Text>
            </Flex>
            <Separator size="4" />
            <ScrollArea type="auto" scrollbars="vertical" style={{ maxHeight: '12rem' }}>
                <Box p="1">
                    {otherChats.map(chat => (
                        <Box
                            key={chat.id}
                            onClick={() => onSelectChatHistory(chat.id)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectChatHistory(chat.id);
                                }
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`Switch to: ${getChatDisplayTitle(chat)}`}
                            className="block w-full p-2 rounded hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7] cursor-pointer"
                            title={`Switch to: ${getChatDisplayTitle(chat)}`}
                        >
                            <Text size="2" truncate>{getChatDisplayTitle(chat)}</Text>
                        </Box>
                    ))}
                </Box>
            </ScrollArea>
        </Box>
    );
}
