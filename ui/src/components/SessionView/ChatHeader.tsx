import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { MessageSquare, PlusCircle, Edit, Check, X } from '../icons/Icons';
import { activeChatAtom, renameChatAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';

interface ChatHeaderProps {
    activeChatId: number | null; // Needed to match renamingChatId
    onNewChatClick: () => void; // Callback to trigger navigation etc.
}

export function ChatHeader({ activeChatId, onNewChatClick }: ChatHeaderProps) {
    const activeChat = useAtomValue(activeChatAtom);
    const renameChatAction = useSetAtom(renameChatAtom);

    // Local state for renaming UI
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


    return (
        // 6. Remove border-b
        <CardHeader className="flex-shrink-0 flex flex-row justify-between items-center gap-2">
            {/* Title/Rename Section */}
            <div className="flex items-center gap-2 flex-grow min-w-0">
                <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0" />
                {renamingChatId === activeChatId && activeChat ? (
                    // Rename Mode
                    <>
                        <Input
                            value={editChatName}
                            onChange={(e: any) => setEditChatName(e.target.value)}
                            placeholder="Enter new chat name"
                            className="h-8 text-sm flex-grow" autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                        />
                        <Button onClick={handleSaveRename} variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-100" title="Save Name"><Check size={18} /></Button>
                        <Button onClick={handleCancelRename} variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-100" title="Cancel Rename"><X size={18} /></Button>
                    </>
                ) : (
                    // Display Mode
                    <div className="flex items-center gap-1 min-w-0">
                        <CardTitle className="truncate" title={activeChatTitle}>
                            {activeChatTitle}
                        </CardTitle>
                        {activeChat && (
                            <Button onClick={() => handleRenameClick(activeChat)} variant="ghost" size="icon" className="h-6 w-6 ml-1 text-gray-500 hover:text-blue-600 flex-shrink-0" title="Rename Chat">
                                <Edit size={14} />
                            </Button>
                        )}
                    </div>
                )}
            </div>
            {/* New Chat Button */}
            <Button onClick={onNewChatClick} variant="outline" size="sm" className="flex-shrink-0">
                <PlusCircle className="mr-1 h-4 w-4" /> New Chat
            </Button>
        </CardHeader>
    );
}
