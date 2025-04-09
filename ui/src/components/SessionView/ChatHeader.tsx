import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    ChatBubbleIcon, PlusCircledIcon, Pencil1Icon, CheckIcon, Cross1Icon
} from '@radix-ui/react-icons';
import { Button, Flex, TextField, Text, IconButton } from '@radix-ui/themes';
import { activeChatAtom, renameChatAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

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
            renameChatAction({ chatId: renamingChatId, newName: trimmedName });
        }
        setRenamingChatId(null);
        setEditChatName('');
    };
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { // Added type
        if (e.key === 'Enter') handleSaveRename();
        if (e.key === 'Escape') handleCancelRename();
    };

    return (
        <Flex align="center" justify="between" py="3" px="4" gap="3">
            <Flex align="center" gap="2" style={{ minWidth: 0, flexGrow: 1 }}>
                <ChatBubbleIcon className="text-[--accent-9] flex-shrink-0" width="20" height="20" />
                <Flex align="center" gap="1" style={{ minWidth: 0 }} >
                    <Text weight="medium" truncate title={activeChatTitle}> {activeChatTitle} </Text>
                </Flex>
            </Flex>
            <Button onClick={onNewChatClick} variant="soft" size="2">
                 <PlusCircledIcon width="16" height="16" /> <Text ml="2">New Chat</Text> {/* ml="2" is fine on Text */}
            </Button>
        </Flex>
    );
}
