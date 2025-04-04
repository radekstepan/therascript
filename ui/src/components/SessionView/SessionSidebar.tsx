// src/components/SessionView/SessionSidebar.tsx
import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { activeSessionAtom } from '../../store';
import { FileText, MessageSquare, User } from '../icons/Icons';
import { ScrollArea } from '../ui/ScrollArea';
import { Button } from '../ui/Button'; // Use Button for scroll links
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';

// Type for the scroll handler prop
interface SessionSidebarProps {
    scrollToSection: (section: 'details' | 'transcript' | 'chat') => void;
}

// NavLink styling helper remains the same
const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = "flex items-center w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-150";
    const active = "bg-blue-100 text-blue-700 font-medium";
    const inactive = "text-gray-600 hover:bg-gray-100 hover:text-gray-900";
    return `${base} ${isActive ? active : inactive}`;
};

// Button styling helper for scroll links
const getScrollButtonClass = (): string => {
    return "flex items-center w-full text-left px-3 py-2 rounded-md text-sm transition-colors duration-150 text-gray-600 hover:bg-gray-100 hover:text-gray-900";
};


export function SessionSidebar({ scrollToSection }: SessionSidebarProps) {
    const { sessionId } = useParams<{ sessionId: string; chatId?: string }>();
    const session = useAtomValue(activeSessionAtom);

    if (!session || !sessionId) {
        return null;
    }

    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    const getChatDisplayTitle = (chat: ChatSession): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    return (
        <aside className="w-64 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col p-3 space-y-4">

            {/* Dynamic Chat Links - Still NavLinks */}
            <div className="flex-grow flex flex-col min-h-0">
                <h3 className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Chats</h3>
                {sortedChats.length === 0 ? (
                     <p className="px-3 text-sm text-gray-500 italic">No chats yet.</p>
                 ) : (
                     <ScrollArea className="flex-grow -mx-3">
                        <nav className="space-y-1 px-3">
                            {sortedChats.map(chat => (
                                <NavLink
                                    key={chat.id}
                                    to={`/sessions/${sessionId}/chats/${chat.id}`}
                                    // Optionally trigger scroll if already on the chat page
                                    onClick={(e) => {
                                        // Check if the target chat is already the active one (compare with URL or atom)
                                        // This comparison logic might need refinement based on how activeChatId atom is updated
                                        const currentUrlChatId = window.location.pathname.split('/chats/')[1];
                                        if (currentUrlChatId === String(chat.id)) {
                                            // Already on this chat, trigger scroll
                                             e.preventDefault(); // Prevent full navigation
                                             scrollToSection('chat');
                                        }
                                        // Otherwise, let NavLink handle navigation
                                    }}
                                    className={getNavLinkClass}
                                    title={getChatDisplayTitle(chat)}
                                >
                                    <MessageSquare size={16} className="mr-3 flex-shrink-0" />
                                    <span className="truncate flex-grow">{getChatDisplayTitle(chat)}</span>
                                </NavLink>
                            ))}
                        </nav>
                    </ScrollArea>
                 )}
            </div>
        </aside>
    );
}
