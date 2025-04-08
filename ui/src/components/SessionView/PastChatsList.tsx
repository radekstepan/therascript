// src/components/SessionView/PastChatsList.tsx
import React from 'react';
import { Card, Title, Text, Button, Divider, Flex } from '@tremor/react'; // Import Tremor components
import { List } from '../icons/Icons'; // Keep icon
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

    // FIX: Corrected JSX syntax in the map function
    return (
        // This component might not be used if chats are listed in the sidebar
        // If kept, it should be styled with Tremor
        <Card className="flex-shrink-0 mt-4"> {/* Add margin if needed */}
             <Flex alignItems="center" className="px-4 pt-3 pb-2"> {/* Adjust padding */}
                 <List className="mr-2 h-4 w-4 text-tremor-content-subtle" aria-hidden="true"/>
                 {/* Use Text instead of Title if a smaller heading is desired */}
                 {/* <Title order={6}>Past Chats</Title> */}
                 <Text className="font-semibold text-tremor-content-strong">Past Chats</Text>
             </Flex>
             <Divider className="my-0" />
             {/* Container for scrollable list */}
             <div className="p-2 max-h-36 overflow-y-auto">
                 <div className="space-y-1"> {/* Use div instead of ul */}
                    {otherChats.map(chat => (
                        <div
                            key={chat.id}
                            className="flex items-center justify-between p-1.5 hover:bg-tremor-background-muted rounded-tremor-small cursor-pointer"
                            onClick={() => onSelectChatHistory(chat.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => { // Add type for event
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault(); // Prevent default space scroll
                                    onSelectChatHistory(chat.id);
                                }
                            }}
                            title={`Switch to: ${getChatDisplayTitle(chat)}`}
                        >
                            <Text className="truncate mr-2 pointer-events-none">
                                {getChatDisplayTitle(chat)}
                            </Text>
                             {/* Optionally add a visual indicator like an arrow? Or remove button. */}
                             {/* <ChevronRightIcon className="h-4 w-4 text-tremor-content-subtle" /> */}
                        </div>
                    ))}
                 </div>
            </div>
        </Card>
    );
}
