/*
Modified File: src/components/SessionView/ChatInterface.tsx
* Using @radix-ui/themes ScrollArea
+ Reduced bottom padding AGAIN for the ChatInput area
+ Revised scroll restoration logic for reliability
*/
import React, { useRef, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Flex, ScrollArea } from '@radix-ui/themes';
import { ChatInput, ChatMessages } from './';
import {
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../store';

interface ChatInterfaceProps {
    isTabActive?: boolean; // Is this tab currently visible? (for small screens)
    initialScrollTop?: number; // Where to scroll when becoming active
    onScrollUpdate?: (scrollTop: number) => void; // Callback to report scroll position
}

// Simple debounce utility
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
    onScrollUpdate
}: ChatInterfaceProps) {
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isChatting = useAtomValue(isChattingAtom);
    // Ref to track if a scroll restoration is pending after activation
    const restoreScrollRef = useRef(false);

    // --- Scroll Saving ---
    const debouncedScrollSave = useCallback(
        debounce((scrollTop: number) => {
            // console.log("Chat Saving scroll:", scrollTop);
            if (onScrollUpdate) {
                onScrollUpdate(scrollTop);
            }
        }, 150), // Debounce time
    [onScrollUpdate]);

    const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
        // Prevent saving scroll position during programmatic restoration
        if (!restoreScrollRef.current && event.currentTarget) {
            debouncedScrollSave(event.currentTarget.scrollTop);
        }
        // Reset the flag after the user manually scrolls *after* a restoration
        // OR if the programmatic scroll event fires (which it should)
        if (restoreScrollRef.current) {
             restoreScrollRef.current = false;
             // console.log("Chat reset restoreScrollRef on scroll");
        }
    };

    // --- Scroll Restoration ---
    useEffect(() => {
        // When tab becomes active, mark that restoration is needed
        if (isTabActive) {
            restoreScrollRef.current = true;
            // console.log(`Chat marked for restoration to: ${initialScrollTop}`);
        } else {
            // Ensure flag is false if tab becomes inactive
            restoreScrollRef.current = false;
        }
    }, [isTabActive]); // Only depends on isTabActive changing

    useEffect(() => {
        // If restoration is marked and ref is available, perform the scroll
        if (restoreScrollRef.current && viewportRef.current) {
            requestAnimationFrame(() => {
                // Double-check the flag hasn't been reset by an intervening scroll event
                if (restoreScrollRef.current && viewportRef.current) {
                     // Check if the position actually needs changing
                    if (viewportRef.current.scrollTop !== initialScrollTop) {
                        viewportRef.current.scrollTop = initialScrollTop;
                        // console.log(`Chat RESTORED scroll to: ${initialScrollTop}`);
                        // Programmatic scroll WILL trigger handleScroll, which resets the ref.
                    } else {
                        // If already at the correct position, manually reset the flag
                        restoreScrollRef.current = false;
                        // console.log("Chat already at target, reset restoreScrollRef");
                    }
                }
            });
        }
        // This effect depends on initialScrollTop as well, in case the saved
        // position changes while the tab is inactive
    }, [isTabActive, initialScrollTop]);


    // --- Scroll to Bottom on New Messages ---
    useEffect(() => {
        // Only auto-scroll if:
        // 1. The tab is active (or large screen: isTabActive is undefined)
        // 2. Restoration is NOT currently pending (don't fight the restoration)
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current) {
            // console.log("Chat considering scroll to bottom");
            if (chatContentRef.current) {
                const lastElement = chatContentRef.current.lastElementChild;
                if (lastElement) {
                    requestAnimationFrame(() => {
                        // console.log("Chat scrolling to bottom");
                        lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
                    });
                }
            }
        }
    // Run when messages or chatting state change, or tab becomes active
    // (the restoreScrollRef check prevents immediate scroll on activation)
    }, [chatMessages, isChatting, isTabActive]);


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0 }}
            >
                <Box p="4" ref={chatContentRef}>
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
                }}
            >
                <ChatInput />
            </Box>
        </Flex>
    );
}
