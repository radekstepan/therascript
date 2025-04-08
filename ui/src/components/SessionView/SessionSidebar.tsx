import React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { activeSessionAtom } from '../../store';
import { FileTextIcon, ChatBubbleIcon, PersonIcon } from '@radix-ui/react-icons';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils'; // Import cn

// Updated NavLink styling helper for pure Tailwind
const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = "flex items-center w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors duration-150 group"; // Added group
    const active = "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium";
    const inactive = "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-800 dark:hover:text-gray-200";
    return cn(base, isActive ? active : inactive);
};


export function SessionSidebar() {
    const { sessionId } = useParams<{ sessionId: string; chatId?: string }>();
    const session = useAtomValue(activeSessionAtom);

    if (!session || !sessionId) {
        return null;
    }

    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    const getChatDisplayTitle = (chat: ChatSession): string => {
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    // Note: The width is now controlled by the parent (`SessionView`) and applied via inline styles there.
    // Removed `w-64` and `hidden lg:flex` (visibility handled by parent now).
    // Added `h-full` to ensure it fills the height given by the parent container.
    return (
        <aside className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col p-4 space-y-4 h-full w-full overflow-hidden"> {/* Use standard bg/border colors, occupy full provided space */}
            {/* Dynamic Chat Links */}
            <div className="flex-grow flex flex-col min-h-0">
                <h3 className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex-shrink-0">Chats</h3>
                {sortedChats.length === 0 ? (
                     <p className="px-1 text-gray-500 dark:text-gray-400 italic text-sm">No chats yet.</p> // Use p
                 ) : (
                     <div className="flex-grow overflow-y-auto -mx-1 pr-1"> {/* Added padding-right for scrollbar */}
                        <nav className="space-y-1 px-1">
                            {sortedChats.map(chat => (
                                <NavLink
                                    key={chat.id}
                                    to={`/sessions/${sessionId}/chats/${chat.id}`}
                                    className={getNavLinkClass}
                                    title={getChatDisplayTitle(chat)}
                                    end // Ensure exact match for active class
                                >
                                    <ChatBubbleIcon className="mr-2 h-4 w-4 flex-shrink-0 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" /> {/* Icon color */}
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