import React, { useRef, useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import { SessionSidebar } from './SessionSidebar';
// Import Box, Flex, AND Text from @radix-ui/themes
import { Box, Flex, Text } from '@radix-ui/themes';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';
import { clampedSidebarWidthAtom } from '../../store';
import type { Session } from '../../types';

interface SessionContentProps {
    session: Session;
    editTranscriptContent: string;
    onTranscriptContentChange: (newContent: string) => void;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
}

export function SessionContent({
    session,
    editTranscriptContent,
    onTranscriptContentChange,
    activeChatId,
    hasChats,
    onStartFirstChat
}: SessionContentProps) {
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const isResizing = useRef(false);
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    // Mouse drag handler for resizing the sidebar
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []); // Empty dependency array assuming handleMouseMove/Up are stable refs or defined outside

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        setSidebarWidth(newWidth); // Uses the derived writable atom setter
    }, [setSidebarWidth]); // Depends on setSidebarWidth

    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
    }, [handleMouseMove]); // Depends on handleMouseMove

    // Cleanup listeners on component unmount
    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);

    return (
        // Main flex container for the session view content
        <Flex flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
            {/* Sidebar Panel */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col"
                style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
            >
                <SessionSidebar />
            </Box>
            {/* Resizer Handle */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>
            {/* Main Content Area (Transcription & Chat) */}
            <Flex
                flexGrow="1"
                direction={{ initial: 'column', lg: 'row' }}
                gap={{ initial: '4', lg: '6' }}
                p={{ initial: '4', md: '6', lg: '8' }}
                style={{ minHeight: 0 }}
            >
                {/* --- Swapped Panels --- */}

                {/* Chat Panel (Right Side on Large Screens) */}
                <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                    {activeChatId !== null ? (
                        <ChatInterface /> // Renders the active chat interface
                    ) : hasChats ? (
                        // Shows placeholder if chats exist but none selected
                        <Box className="flex flex-grow items-center justify-center" style={{ border: '2px dashed var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                            {/* Use the correctly imported Text component */}
                            <Text color="gray" align="center">Select a chat from the sidebar to view it.</Text>
                        </Box>
                    ) : (
                         // Shows prompt to start the first chat if none exist
                        <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                    )}
                </Flex>

                {/* Transcription Panel (Left Side on Large Screens) */}
                <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                    <Transcription
                        session={session}
                        editTranscriptContent={editTranscriptContent}
                        onContentChange={onTranscriptContentChange}
                    />
                </Flex>

            </Flex>
        </Flex>
    );
}
