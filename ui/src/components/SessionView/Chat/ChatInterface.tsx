import React, { useRef, useEffect, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { ChatInput } from './ChatInput'; // Adjusted path
import { ChatMessages } from './ChatMessages'; // Adjusted path
import {
    activeChatIdAtom,
    currentChatMessagesAtom,
    isChattingAtom
} from '../../../store'; // Adjusted path

interface ChatInterfaceProps {
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
    isLoadingChat: boolean;
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
    isLoadingChat
}: ChatInterfaceProps) {
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const isAiResponding = useAtomValue(isChattingAtom);
    const restoreScrollRef = useRef(false);

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

    useEffect(() => {
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
    }, [chatMessages, isAiResponding, isTabActive, isLoadingChat]);


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}
            >
                {isLoadingChat && (
                    <Flex
                       align="center"
                       justify="center"
                       style={{
                           position: 'absolute',
                           inset: 0,
                           backgroundColor: 'var(--color-panel-translucent)',
                           zIndex: 10,
                           borderRadius: 'var(--radius-3)',
                       }}
                       >
                        <Spinner size="3" />
                        <Text ml="2" color="gray">Loading messages...</Text>
                    </Flex>
                )}
                <Box p="4" ref={chatContentRef} style={{ opacity: isLoadingChat ? 0.5 : 1, transition: 'opacity 0.2s ease-in-out' }}>
                    <ChatMessages activeChatId={activeChatId} />
                </Box>
            </ScrollArea>
            <Box
                px="4"
                pt="4"
                pb="2"
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--card-background)',
                    opacity: isLoadingChat ? 0.6 : 1,
                    pointerEvents: isLoadingChat ? 'none' : 'auto',
                    transition: 'opacity 0.2s ease-in-out',
                }}
            >
                <ChatInput disabled={isLoadingChat} />
            </Box>
        </Flex>
    );
}
