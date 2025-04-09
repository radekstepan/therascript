import React, { useRef, useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import { SessionSidebar } from './SessionSidebar';
import { Box, Flex } from '@radix-ui/themes';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';
import { clampedSidebarWidthAtom, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from '../../store';
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

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        setSidebarWidth(newWidth);
    }, [setSidebarWidth]);

    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
    }, [handleMouseMove]);

    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);

    return (
        <Flex flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col"
                style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
            >
                <SessionSidebar />
            </Box>
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>
            <Flex
                flexGrow="1"
                direction={{ initial: 'column', lg: 'row' }}
                gap={{ initial: '4', lg: '6' }}
                p={{ initial: '4', md: '6', lg: '8' }}
                style={{ minHeight: 0 }}
            >
                <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                    <Transcription
                        session={session}
                        editTranscriptContent={editTranscriptContent}
                        onContentChange={onTranscriptContentChange}
                    />
                </Flex>
                <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                    {activeChatId !== null ? (
                        <ChatInterface />
                    ) : hasChats ? (
                        <Box className="flex flex-grow items-center justify-center" style={{ border: '2px dashed var(--gray-a6)' }}>
                            <p className="text-[--gray-a11] text-center">Select a chat from the sidebar to view it.</p>
                        </Box>
                    ) : (
                        <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                    )}
                </Flex>
            </Flex>
        </Flex>
    );
}
