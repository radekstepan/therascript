import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MessageSquare, PlusCircle, Edit, Check, X } from '../icons/Icons';
import { Button } from '../ui/Button'; // Import new Button
import { Input } from '../ui/Input'; // Import new Input
import { activeChatAtom, renameChatAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils'; // Import cn utility

interface ChatHeaderProps {
    activeChatId: number | null;
    onNewChatClick: () => void;
}

export function ChatHeader({ activeChatId, onNewChatClick }: ChatHeaderProps) {
    const activeChat = useAtomValue(activeChatAtom);
    const renameChatAction = useSetAtom(renameChatAtom);

    const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
    const [editChatName, setEditChatName] = useState('');

    const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
        if (!chat) return 'No Chat Selected';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };
    const activeChatTitle = getChatDisplayTitle(activeChat);

    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChatId(chat.id);
        setEditChatName(chat.name || '');
    };

    const handleCancelRename = () => {
        setRenamingChatId(null);
        setEditChatName('');
    };

    const handleSaveRename = () => {
        if (renamingChatId !== null) {
            const trimmedName = editChatName.trim();
            if (trimmedName || activeChat?.name) {
                renameChatAction({ chatId: renamingChatId, newName: trimmedName });
            }
        }
        setRenamingChatId(null);
        setEditChatName('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSaveRename();
        if (e.key === 'Escape') handleCancelRename();
    };

    return (
        <div className="flex flex-shrink-0 items-center justify-between py-3 px-4 gap-2">
            {/* Title/Rename Section */}
            <div className={cn("flex flex-grow items-center min-w-0 gap-2")}>
                <MessageSquare className="h-5 w-5 text-brand-DEFAULT flex-shrink-0" aria-hidden="true" />
                {renamingChatId === activeChatId && activeChat ? (
                    // Rename Mode
                    <div className="flex flex-grow items-center min-w-0 gap-1">
                        <Input
                            value={editChatName}
                            onChange={(e) => setEditChatName(e.target.value)} // Use standard onChange
                            placeholder="Enter new chat name"
                            className="h-9 text-sm flex-grow"
                            autoFocus
                            onKeyDown={handleKeyDown}
                            aria-label="New chat name"
                        />
                        {/* Use new Button component */}
                        <Button onClick={handleSaveRename} variant="ghost" size="iconSm" title="Save Name" className="text-success-600 hover:text-success-700"> <Check size={16}/> </Button>
                        <Button onClick={handleCancelRename} variant="ghost" size="iconSm" title="Cancel Rename" className="text-danger-600 hover:text-danger-700"> <X size={16}/> </Button>
                    </div>
                ) : (
                    // Display Mode
                    <div className="flex items-center gap-1 min-w-0">
                        {/* Use standard HTML element for text */}
                        <span className="truncate font-semibold text-gray-800 dark:text-gray-200" title={activeChatTitle}>
                            {activeChatTitle}
                        </span>
                        {activeChat && (
                            <Button onClick={() => handleRenameClick(activeChat)} variant="ghost" size="iconXs" title="Rename Chat" className="ml-1 text-gray-400 hover:text-brand-DEFAULT p-0"> <Edit size={14}/> </Button>
                        )}
                    </div>
                )}
            </div>
            {/* New Chat Button */}
            <Button onClick={onNewChatClick} variant="secondary" size="sm" icon={PlusCircle}>
                 New Chat
            </Button>
        </div>
    );
}
