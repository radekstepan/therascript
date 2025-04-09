// src/components/SessionView/ChatInterface.tsx
import React, { useRef, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Flex, Separator } from '@radix-ui/themes'; // Remove ScrollArea from themes
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'; // Import the standalone package
import { ChatHeader, ChatInput, ChatMessages } from './';
import {
    activeSessionAtom,
    startNewChatAtom, // Keep startNewChatAtom
    chatErrorAtom,
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store'; // Correct path if needed
import { cn } from '../../utils'; // Import cn for styling

export function ChatInterface() {
    // Removed unused useParams and useNavigate here as new chat is handled in sidebar now
    // const { chatId } = useParams<{ chatId?: string }>();
    // const navigate = useNavigate();
    // const session = useAtomValue(activeSessionAtom);
    // const startNewChatAction = useSetAtom(startNewChatAtom);
    // const setChatError = useSetAtom(chatErrorAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Keep this
    const chatScrollRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);

    // REMOVED: handleNewChatClick logic is now in SessionSidebar

    // Scroll to bottom when messages change or AI starts/stops chatting
    useEffect(() => {
        if (chatScrollRef.current) { // Ref is now on the Viewport
            // For Viewport, prefer setting scrollTop directly if scrollTo isn't working as expected
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
            // chatScrollRef.current.scrollTo({ top: chatScrollRef.current.scrollHeight }); // Use scrollTo for Viewport
        }
    }, [chatMessages, isChatting]);

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Pass necessary props to ChatHeader */}
            <ChatHeader activeChatId={activeChatId} />
            <Separator size="4" />
            {/* Use ScrollAreaPrimitive */}
            <ScrollAreaPrimitive.Root
                className="flex-grow overflow-hidden" // Use flex-grow and hide overflow on Root
                type="auto"
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                {/* Viewport handles the scrolling content */}
                <ScrollAreaPrimitive.Viewport
                    ref={chatScrollRef}
                    className="h-full w-full rounded-[inherit]" // Ensure viewport takes full size
                >
                    <Box p="4"> {/* Padding inside the viewport */}
                        <ChatMessages activeChatId={activeChatId} />
                    </Box>
                </ScrollAreaPrimitive.Viewport>

                {/* Add Scrollbar and Thumb for styling */}
                {/* Example styling - adjust classes as needed for your theme */}
                <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex select-none touch-none p-0.5 bg-[--gray-a3] transition-colors duration-[160ms] ease-out data-[orientation=vertical]:w-2.5">
                    <ScrollAreaPrimitive.Thumb className="flex-1 bg-[--gray-a7] rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px] hover:bg-[--gray-a8]" />
                </ScrollAreaPrimitive.Scrollbar>
                <ScrollAreaPrimitive.Corner className="bg-[--gray-a5]" />
            </ScrollAreaPrimitive.Root>

            {/* Input area remains the same */}
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
