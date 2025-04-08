import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { Button, TextInput, Title, Flex, Text } from '@tremor/react'; // Import Tremor components
import { MessageSquare, PlusCircle, Edit, Check, X } from '../icons/Icons'; // Keep existing icons
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

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSaveRename();
        if (e.key === 'Escape') handleCancelRename();
    };


    return (
        // Use Flex for layout within the chat interface header area
        <Flex className="flex-shrink-0 py-3 px-4 gap-2" justifyContent="between" alignItems="center">
            {/* Title/Rename Section */}
            <Flex className="flex-grow min-w-0 gap-2" alignItems='center'>
                <MessageSquare className="h-5 w-5 text-tremor-brand flex-shrink-0" aria-hidden="true" />
                {renamingChatId === activeChatId && activeChat ? (
                    // Rename Mode
                    <Flex className="flex-grow min-w-0 gap-1">
                        <TextInput
                            value={editChatName}
                            onValueChange={setEditChatName} // Use onValueChange for Tremor TextInput
                            placeholder="Enter new chat name"
                            className="h-9 text-sm flex-grow" autoFocus
                            onKeyDown={handleKeyDown}
                            aria-label="New chat name"
                        />
                        <Button onClick={handleSaveRename} variant="light" icon={Check} tooltip="Save Name" color="emerald" className="h-9 w-9 p-0" />
                        <Button onClick={handleCancelRename} variant="light" icon={X} tooltip="Cancel Rename" color="rose" className="h-9 w-9 p-0" />
                    </Flex>
                ) : (
                    // Display Mode
                    <Flex className="items-center gap-1 min-w-0">
                        {/* Use Text instead of Title if you need smaller heading, or keep Title */}
                        {/* <Title className="truncate font-semibold" title={activeChatTitle}> */}
                        <Text className="truncate font-semibold text-tremor-content-strong" title={activeChatTitle}>
                            {activeChatTitle}
                        </Text>
                        {/* </Title> */}
                        {activeChat && (
                            <Button onClick={() => handleRenameClick(activeChat)} variant="light" icon={Edit} tooltip="Rename Chat" className="h-6 w-6 ml-1 text-tremor-content-subtle hover:text-tremor-brand p-0" />
                        )}
                    </Flex>
                )}
            </Flex>
            {/* New Chat Button */}
            <Button onClick={onNewChatClick} variant="secondary" icon={PlusCircle} className="flex-shrink-0">
                 New Chat
            </Button>
        </Flex>
    );
}
