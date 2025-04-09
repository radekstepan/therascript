import React, { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    ChatBubbleIcon, // Removed PlusCircledIcon
} from '@radix-ui/react-icons';
import { Button, Flex, TextField, Text, IconButton } from '@radix-ui/themes'; // Removed Button import
import { activeChatAtom, renameChatAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
// Removed cn import as it's not used here anymore

interface ChatHeaderProps {
    activeChatId: number | null;
    // Removed onNewChatClick prop
}

export function ChatHeader({ activeChatId }: ChatHeaderProps) {
    const activeChat = useAtomValue(activeChatAtom);
    const renameChatAction = useSetAtom(renameChatAtom);
    // Removed renaming state as it wasn't used
    // const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
    // const [editChatName, setEditChatName] = useState('');

    const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
        if (!chat) return 'No Chat Selected';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };
    const activeChatTitle = getChatDisplayTitle(activeChat);

    // Removed rename handlers as they weren't implemented via UI here
    // const handleRenameClick = (chat: ChatSession) => { ... };
    // const handleCancelRename = () => { ... };
    // const handleSaveRename = () => { ... };
    // const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { ... };

    return (
        <Flex align="center" justify="between" py="3" px="4" gap="3">
            {/* Chat Title */}
            <Flex align="center" gap="2" style={{ minWidth: 0, flexGrow: 1 }}>
                <ChatBubbleIcon className="text-[--accent-9] flex-shrink-0" width="20" height="20" />
                <Flex align="center" gap="1" style={{ minWidth: 0 }} >
                    <Text weight="medium" truncate title={activeChatTitle}> {activeChatTitle} </Text>
                </Flex>
            </Flex>
            {/* REMOVED: New Chat button */}
        </Flex>
    );
}
