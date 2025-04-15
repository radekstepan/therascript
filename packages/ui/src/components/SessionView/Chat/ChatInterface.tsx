import React, { useRef, useEffect, useCallback } from 'react';
// Removed useAtomValue if not needed elsewhere
import { Box, Flex, ScrollArea, Spinner, Text } from '@radix-ui/themes';
import { useQuery } from '@tanstack/react-query';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { ChatHeader } from './ChatHeader'; // Import ChatHeader
import { fetchChatDetails } from '../../../api/api';
import { debounce } from '../../../helpers'; // Import debounce
// Removed atoms if they are now props
// import {
//     activeSessionIdAtom,
//     activeChatIdAtom,
// } from '../../../store';
import type { ChatSession, Session } from '../../../types'; // Add Session type

interface ChatInterfaceProps {
    session: Session | null; // Accept session prop
    activeChatId: number | null; // Accept activeChatId prop
    isLoadingSessionMeta?: boolean; // Pass session meta loading state
    isTabActive?: boolean;
    initialScrollTop?: number;
    onScrollUpdate?: (scrollTop: number) => void;
}

export function ChatInterface({
    session, // Use prop
    activeChatId, // Use prop
    isLoadingSessionMeta, // Use prop
    isTabActive,
    initialScrollTop = 0,
    onScrollUpdate,
}: ChatInterfaceProps) {
    // REMOVE activeSessionId/activeChatId from useAtomValue if they are now props
    // const activeChatId = useAtomValue(activeChatIdAtom);
    const activeSessionId = session?.id ?? null; // Get session ID from prop if needed for query key

    const restoreScrollRef = useRef(false);
    const chatContentRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);

    // Fetch chat details using Tanstack Query
    const { data: chatData, isLoading: isLoadingMessages, error: chatError, isFetching } = useQuery<ChatSession | null, Error>({
        queryKey: ['chat', activeSessionId, activeChatId], // Use IDs from props/derived prop
        queryFn: () => {
            if (!activeSessionId || activeChatId === null) return Promise.resolve(null); // Return null if IDs aren't valid
            return fetchChatDetails(activeSessionId, activeChatId);
        },
        enabled: !!activeSessionId && activeChatId !== null, // Only run query if IDs are valid
        // staleTime: 60 * 1000, // Example: Consider messages stale after 1 minute
    });

    const chatMessages = chatData?.messages || [];
    // Combined loading state: consider initial prop, this query's loading, and background fetching
    const combinedIsLoading = isLoadingSessionMeta || isLoadingMessages || (isFetching && !chatData);

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

    // Scroll to bottom effect
    useEffect(() => {
        // Scroll only if the tab is active (or tabs aren't used), not restoring scroll, not loading, and there are messages
        if ((isTabActive === undefined || isTabActive) && !restoreScrollRef.current && !combinedIsLoading && chatMessages.length > 0) {
            if (chatContentRef.current) {
                const lastElement = chatContentRef.current.lastElementChild;
                if (lastElement) {
                    requestAnimationFrame(() => {
                        lastElement.scrollIntoView({ behavior: "smooth", block: "end" });
                    });
                }
            }
        }
    }, [chatMessages.length, combinedIsLoading, isTabActive]); // Depend on length for new messages


    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Add ChatHeader and pass props */}
            <Box style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0, backgroundColor: 'var(--color-panel-solid)' }}>
                <ChatHeader
                    session={session}
                    activeChatId={activeChatId}
                    isLoadingSessionMeta={isLoadingSessionMeta} // Pass loading state
                />
            </Box>
            <ScrollArea
                type="auto"
                scrollbars="vertical"
                ref={viewportRef}
                onScroll={handleScroll}
                style={{ flexGrow: 1, minHeight: 0, position: 'relative' }}
            >
                {combinedIsLoading && chatMessages.length === 0 && ( // Show spinner only if loading and no messages yet
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
                 {chatError && (
                     <Flex justify="center" p="4">
                        <Text color="red">Error loading chat: {chatError.message}</Text>
                     </Flex>
                 )}
                <Box p="4" ref={chatContentRef} style={{ opacity: combinedIsLoading ? 0.5 : 1, transition: 'opacity 0.2s ease-in-out' }}>
                    {/* Pass fetched messages down */}
                    <ChatMessages messages={chatMessages} activeChatId={activeChatId} />
                </Box>
            </ScrollArea>
            <Box
                px="4"
                pt="4"
                pb="2"
                style={{
                    flexShrink: 0,
                    borderTop: '1px solid var(--gray-a6)',
                    backgroundColor: 'var(--color-panel-solid)', // Match header/sidebar?
                    opacity: combinedIsLoading ? 0.6 : 1,
                    pointerEvents: combinedIsLoading ? 'none' : 'auto',
                    transition: 'opacity 0.2s ease-in-out',
                }}
            >
                <ChatInput disabled={combinedIsLoading || !activeChatId} /> {/* Also disable if no chat selected */}
            </Box>
        </Flex>
    );
}
