// src/components/SessionView/ChatInterface.tsx
import React, { useRef, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes'; // Add Spinner, Text
import { ChatInput, ChatMessages } from './';
import {
    activeChatIdAtom,
    currentChatMessagesAtom, // This atom derives messages from the activeChatAtom
    isChattingAtom // Keep this for AI response loading
} from '../../store';

interface ChatInterfaceProps {
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
    isLoadingChat: boolean; // <-- Add prop for message loading state
}

// Simple debounce utility (Keep as is)
const debounce = <F extends (...args: any[]) => any>(func: F, waitFor: number) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<F>): void => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), waitFor);
    };
};


export function ChatInterface({
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
    isLoadingChat // <-- Destructure prop
}: ChatInterfaceProps) {
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom); // Reads messages from global state
    const isAiResponding = useAtomValue(isChattingAtom);
    const restoreScrollRef = useRef(false);

    // --- Scroll Saving & Restoration Logic (Unchanged) ---
     const debouncedScrollSave = useCallback(
         debounce((scrollTop: number) => {
             if (onScrollUpdate) {
                 onScrollUpdate(scrollTop);
             }
         }, 150),
     [onScrollUpdate]);

     const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
         if (!restoreScrollRef.current && event.currentTarget) {
             debouncedScrollSave(event.currentTarget.scrollTop);
         }
         if (restoreScrollRef.current) {
              restoreScrollRef.current = false;
         }
     };

     useEffect(() => {
         if (isTabActive) {
             restoreScrollRef.current = true;
         } else {
             restoreScrollRef.current = false;
         }
     }, [isTabActive]);

     useEffect(() => {
         if (restoreScrollRef.current && viewportRef.current) {
             requestAnimationFrame(() => {
                  if (restoreScrollRef.current && viewportRef.current) {
                     if (viewportRef.current.scrollTop !== initialScrollTop) {
                         viewportRef.current.scrollTop = initialScrollTop;
                     } else {
                         restoreScrollRef.current = false;
                     }
                 }
             });
         }
     }, [isTabActive, initialScrollTop]);
    // --- End Scroll Logic ---


    // --- Scroll to Bottom on New Messages (or initial load finish) ---
    useEffect(() => {
        // Only auto-scroll if tab is active (or large screen) AND not restoring scroll AND not loading chat messages
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current && !isLoadingChat) {
            if (chatContentRef.current) {
                const lastElement = chatContentRef.current.lastElementChild;
                if (lastElement) {
                    requestAnimationFrame(() => {
                        lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
                    });
                }
            }
        }
    // Run when messages change, AI stops responding, tab becomes active, OR chat loading finishes
    }, [chatMessages, isAiResponding, isTabActive, isLoadingChat]);


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0, position: 'relative' }} // Added relative positioning
            >
                {/* Conditionally render loading overlay */}
                {isLoadingChat && (
                    <Flex
                       align="center"
                       justify="center"
                       style={{
                           position: 'absolute',
                           inset: 0, // Cover the entire scroll area
                           backgroundColor: 'var(--color-panel-translucent)', // Semi-transparent overlay
                           zIndex: 10, // Ensure it's above messages
                           borderRadius: 'var(--radius-3)', // Optional: match container radius
                       }}
                       >
                        <Spinner size="3" />
                        <Text ml="2" color="gray">Loading messages...</Text>
                    </Flex>
                )}
                {/* Message content area */}
                <Box p="4" ref={chatContentRef} style={{ opacity: isLoadingChat ? 0.5 : 1, transition: 'opacity 0.2s ease-in-out' }}>
                    {/* ChatMessages reads from currentChatMessagesAtom, which gets updated when fetch completes */}
                    <ChatMessages activeChatId={activeChatId} />
                </Box>
            </ScrollArea>
             {/* Input Area */}
            <Box
                px="4"
                pt="4"
                pb="2"
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--card-background)',
                    opacity: isLoadingChat ? 0.6 : 1, // Dim input area while loading
                    pointerEvents: isLoadingChat ? 'none' : 'auto', // Disable interactions while loading
                    transition: 'opacity 0.2s ease-in-out',
                }}
            >
                {/* Pass disabled state to ChatInput */}
                <ChatInput disabled={isLoadingChat} />
            </Box>
        </Flex>
    );
}
