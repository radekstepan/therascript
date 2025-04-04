// src/components/SessionView/PastChatsList.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { List } from '../icons/Icons';
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
        <Card className="flex-shrink-0">
            <CardHeader className="pb-2 pt-3 border-b">
                <CardTitle className="text-base flex items-center"><List className="mr-2 h-4 w-4 text-gray-500" /> Past Chats</CardTitle>
            </CardHeader>
            <CardContent className="p-2 max-h-36 overflow-y-auto">
                <ul className="space-y-1 list-none">
                    {otherChats.map(chat => (
                        // Correctly define the li element with its props
                        <li
                            key={chat.id}
                            className="flex items-center justify-between p-1.5 hover:bg-gray-100 rounded-md cursor-pointer"
                            onClick={() => onSelectChatHistory(chat.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e: React.KeyboardEvent<HTMLLIElement>) => { // Add type for event
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault(); // Prevent default space scroll
                                    onSelectChatHistory(chat.id);
                                }
                            }}
                            title={`Switch to: ${getChatDisplayTitle(chat)}`}
                        >
                            <span className="text-sm text-gray-700 truncate mr-2 pointer-events-none">
                                {getChatDisplayTitle(chat)}
                            </span>
                            <Button
                                variant="ghost" size="sm"
                                className="text-xs h-7 px-2 flex-shrink-0 pointer-events-none"
                                tabIndex={-1} // Make button non-focusable
                            >
                                Switch
                            </Button>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
