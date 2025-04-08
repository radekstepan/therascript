import React from 'react';
import { ListBulletIcon } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'; // Import new Card components
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
        // Use new Card component
        <Card className="flex-shrink-0 mt-4">
             {/* Use CardHeader */}
             <CardHeader className="flex-row items-center space-y-0 px-4 pt-3 pb-2"> {/* Adjust padding & layout */}
                 <ListBulletIcon className="mr-2 h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden="true"/>
                 {/* Use CardTitle or simple span */}
                 <span className="font-semibold text-gray-800 dark:text-gray-200 text-sm">Past Chats</span>
             </CardHeader>
             {/* Use hr for divider */}
             <hr className="my-0 border-gray-200 dark:border-gray-700" />
             {/* Container for scrollable list */}
             {/* Use CardContent for padding */}
             <CardContent className="p-2 max-h-36 overflow-y-auto">
                 <div className="space-y-1">
                    {otherChats.map(chat => (
                        <div // Use div, style like a button item
                            key={chat.id}
                            className="flex items-center justify-between p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
                            onClick={() => onSelectChatHistory(chat.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onSelectChatHistory(chat.id);
                                }
                            }}
                            title={`Switch to: ${getChatDisplayTitle(chat)}`}
                        >
                            {/* Use span for text */}
                            <span className="truncate mr-2 pointer-events-none text-sm text-gray-700 dark:text-gray-300">
                                {getChatDisplayTitle(chat)}
                            </span>
                            {/* Optionally add an indicator icon */}
                        </div>
                    ))}
                 </div>
            </CardContent>
        </Card>
    );
}
