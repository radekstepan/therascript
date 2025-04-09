import React, { useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Flex, Separator } from '@radix-ui/themes';
import { ChatHeader, ChatInput, ChatMessages } from './';
import {
    activeSessionAtom,
    startNewChatAtom,
    chatErrorAtom,
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store';

export function ChatInterface() {
    const { chatId } = useParams<{ chatId?: string }>();
    const navigate = useNavigate();
    const session = useAtomValue(activeSessionAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);

    const handleNewChatClick = async () => {
        const currentSessionId = session?.id;
        if (currentSessionId) {
            const result = await startNewChatAction({ sessionId: currentSessionId });
            if (result.success) {
                navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
            } else {
                setChatError(result.error);
            }
        } else {
            setChatError("Cannot start new chat: Session context is missing.");
        }
    };

    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages, isChatting]);

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            <ChatHeader activeChatId={activeChatId} onNewChatClick={handleNewChatClick} />
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
                    backgroundColor: 'var(--card-background)',
                    position: 'sticky',
                    bottom: 0,
                    zIndex: 10
                }}
            >
                <ChatInput />
            </Box>
        </Flex>
    );
}
