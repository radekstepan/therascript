// src/components/SessionView/SessionSidebar.tsx
import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { activeSessionAtom } from '../../store';
import { Flex, Title, Text, Divider } from '@tremor/react'; // Import Tremor components
import { FileText, MessageSquare, User } from '../icons/Icons';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';

// Type for the scroll handler prop - REMOVED
// interface SessionSidebarProps {
//     scrollToSection: (section: 'details' | 'transcript' | 'chat') => void;
// }

// NavLink styling helper remains the same
const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    // Use Tremor/Tailwind classes for styling NavLink like a light button/nav item
    const base = "flex items-center w-full text-left px-3 py-1.5 rounded-tremor-small text-tremor-default transition-colors duration-150";
    const active = "bg-tremor-background-muted text-tremor-content-strong font-medium";
    const inactive = "text-tremor-content hover:bg-tremor-background-subtle hover:text-tremor-content-strong";
    return `${base} ${isActive ? active : inactive}`;
};


// export function SessionSidebar({ scrollToSection }: SessionSidebarProps) { // REMOVED prop
export function SessionSidebar() { // REMOVED prop
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
        <aside className="w-64 flex-shrink-0 border-r border-tremor-border bg-tremor-background flex flex-col p-4 space-y-4 hidden lg:flex"> {/* Hide sidebar on smaller screens, show on lg+ */}
            {/* Maybe add Session Title here */}
             {/* Use Text instead of Title if smaller heading preferred */}
             {/* <Title order={5} className="truncate">{session.sessionName || session.fileName}</Title> */}
             <Text className="font-semibold text-tremor-content-strong truncate">{session.sessionName || session.fileName}</Text>
             <Divider/>

            {/* Dynamic Chat Links - Still NavLinks */}
            <div className="flex-grow flex flex-col min-h-0">
                <h3 className="px-1 text-xs font-semibold text-tremor-content-subtle uppercase tracking-wider mb-2">Chats</h3>
                {sortedChats.length === 0 ? (
                     <Text className="px-1 text-tremor-content-subtle italic">No chats yet.</Text>
                 ) : (
                     <div className="flex-grow overflow-y-auto -mx-1"> {/* Container with overflow */}
                        <nav className="space-y-1 px-1">
                            {sortedChats.map(chat => (
                                <NavLink
                                    key={chat.id}
                                    to={`/sessions/${sessionId}/chats/${chat.id}`}
                                    // REMOVED scroll logic from onClick
                                    // onClick={(e) => {
                                    //     const currentUrlChatId = window.location.pathname.split('/chats/')[1];
                                    //     if (currentUrlChatId === String(chat.id)) {
                                    //          e.preventDefault();
                                    //          scrollToSection('chat');
                                    //     }
                                    // }}
                                    className={getNavLinkClass}
                                    title={getChatDisplayTitle(chat)}
                                    end // Ensure exact match for active class
                                >
                                    <MessageSquare size={16} className="mr-2 flex-shrink-0" />
                                    <span className="truncate flex-grow">{getChatDisplayTitle(chat)}</span>
                                </NavLink>
                            ))}
                         </nav>
                    </div>
                 )}
            </div>
        </aside>
    );
}
