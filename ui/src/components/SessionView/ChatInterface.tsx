/*
Modified File: src/components/SessionView/ChatInterface.tsx
Using @radix-ui/themes ScrollArea
*/
import React, { useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
// Import ScrollArea from Radix UI Themes
import { Box, Flex, Separator, ScrollArea } from '@radix-ui/themes';
import { ChatHeader, ChatInput, ChatMessages } from './';
import {
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store';

export function ChatInterface() {
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatContentRef = useRef<HTMLDivElement | null>(null); // Ref for inner Box
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);

    useEffect(() => {
        // Scroll the inner Box content using scrollIntoView on last element
        if (chatContentRef.current) {
            chatContentRef.current.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" });
        }
    }, [chatMessages, isChatting]);

    return (
        // Flex column taking full height from parent (SessionContent panel)
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Themes ScrollArea taking remaining space */}
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{ flexGrow: 1, minHeight: 0 }} // Takes available space
            >
                {/* Inner Box for padding and content ref */}
                <Box p="4" ref={chatContentRef}>
                    <ChatMessages activeChatId={activeChatId} />
                </Box>
            </ScrollArea>

            {/* Input area fixed */}
            <Box
                p="4"
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--card-background)',
                }}
            >
                <ChatInput />
            </Box>
        </Flex>
    );
}
