import React, { useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Flex, Separator, Spinner, Text } from '@radix-ui/themes';
import { ChatHeader, ChatInput, ChatMessages } from './';
import {
    activeSessionAtom,
    startNewChatAtom,
    chatErrorAtom,
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store';
import { cn } from '../../utils';

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
            requestAnimationFrame(() => {
               if (chatScrollRef.current) {
                  chatScrollRef.current.scrollTo({
                      top: chatScrollRef.current.scrollHeight,
                      behavior: 'auto'
                  });
               }
            });
        }
    }, [chatMessages, isChatting]);

    if (activeChatId === null && !session) {
      return (
        <Flex flexGrow="1" align="center" justify="center" p="4">
          <Spinner size="3"/>
          <Text ml="2" color="gray">Loading chat...</Text>
        </Flex>
      );
    }

    return (
        <Flex direction="column" flexGrow="1" height="100%" style={{ minHeight: 0 }}>
            <ChatHeader activeChatId={activeChatId} onNewChatClick={handleNewChatClick} />
            <Separator size="4" />

            <Box ref={chatScrollRef} flexGrow="1" style={{ overflowY: 'auto', minHeight: 0 }} p="4">
                <ChatMessages activeChatId={activeChatId} />
            </Box>

            <Box
               p="4"
               flexShrink="0"
               className="border-t"
               style={{
                   backgroundColor: 'var(--card-background)',
                   zIndex: 10 // Changed from number 10 to string "10" - although zIndex often works with numbers, let's be consistent
                }}
            >
                <ChatInput />
            </Box>
        </Flex>
    );
}
