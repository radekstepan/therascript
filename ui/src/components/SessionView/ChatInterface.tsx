/*
Modified File: src/components/SessionView/ChatInterface.tsx
Using @radix-ui/themes ScrollArea
+ Reduced bottom padding AGAIN for the ChatInput area
*/
import React, { useRef, useEffect } from 'react';
import { useAtomValue } from 'jotai';
// Import ScrollArea from Radix UI Themes
import { Box, Flex, Separator, ScrollArea } from '@radix-ui/themes';
import { ChatHeader, ChatInput, ChatMessages } from './'; // ChatHeader is not used here currently, but keep import if needed elsewhere
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
            // Added check for lastElementChild existing
            const lastElement = chatContentRef.current.lastElementChild;
            if (lastElement) {
                 lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
            }
        }
    }, [chatMessages, isChatting]); // Dependencies seem correct

    return (
        // Flex column taking full height from parent (SessionContent panel)
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Themes ScrollArea taking remaining space */}
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{ flexGrow: 1, minHeight: 0 }} // Takes available space
            >
                {/* Inner Box for message padding and content ref */}
                <Box p="4" ref={chatContentRef}>
                    <ChatMessages activeChatId={activeChatId} />
                </Box>
            </ScrollArea>

            {/* --- MODIFICATION: Input area fixed, padding adjusted --- */}
            <Box
                // Changed pb="3" back to pb="2" (or adjust as needed)
                px="4" // Keep horizontal padding
                pt="4" // Keep top padding
                pb="2" // Reduce bottom padding (try size 2 = 8px)
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--card-background)', // Consider var(--color-panel-solid) for consistency? Or keep card background
                }}
            >
                <ChatInput />
            </Box>
            {/* --- END MODIFICATION --- */}
        </Flex>
    );
}
