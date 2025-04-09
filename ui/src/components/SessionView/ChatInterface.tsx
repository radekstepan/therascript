import React, { useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Flex, Separator } from '@radix-ui/themes';
import { ChatHeader, ChatInput, ChatMessages } from './'; // Keep ChatHeader import
import {
    activeSessionAtom,
    startNewChatAtom, // Keep startNewChatAtom
    chatErrorAtom,
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store';

export function ChatInterface() {
    // Removed unused useParams and useNavigate here as new chat is handled in sidebar now
    // const { chatId } = useParams<{ chatId?: string }>();
    // const navigate = useNavigate();
    // const session = useAtomValue(activeSessionAtom);
    // const startNewChatAction = useSetAtom(startNewChatAtom);
    // const setChatError = useSetAtom(chatErrorAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);

    // REMOVED: handleNewChatClick logic is now in SessionSidebar

    // Scroll to bottom when messages change or AI starts/stops chatting
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages, isChatting]);

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Pass necessary props to ChatHeader */}
            <ChatHeader activeChatId={activeChatId} />
            <Separator size="4" />
            <Box
                ref={chatScrollRef}
                style={{ flexGrow: 1, overflowY: 'auto', minHeight: 0 }}
                p="4"
            >
                <ChatMessages activeChatId={activeChatId} />
            </Box>
            <Box
                p="4"
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--card-background)', // Use Radix variable if defined, else fallback
                    position: 'sticky', // Keep sticky positioning
                    bottom: 0,
                    zIndex: 10
                }}
            >
                <ChatInput />
            </Box>
        </Flex>
    );
}
