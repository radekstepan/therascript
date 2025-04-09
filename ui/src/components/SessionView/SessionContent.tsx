// src/components/SessionView/SessionContent.tsx
import React, { useRef, useCallback, useEffect } from 'react';
import { useAtom } from 'jotai';
import { SessionSidebar } from './SessionSidebar';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';
import {
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
} from '../../store';
import type { Session } from '../../types';
import { cn } from '../../utils'; // Import cn

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
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // --- Resizing Handlers --- (Keep as they are)
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, []); // Removed setSidebarWidth dependency as it's stable

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleMouseMove]); // Keep handleMouseMove dependency

    // Cleanup listeners (Keep as is)
    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);

    return (
        // This main element needs to allow its child (the div containing sidebar + panels) to grow
        <main ref={scrollContainerRef} className="flex-grow flex flex-col min-h-0 bg-gray-50 dark:bg-gray-950">
            {/* This div holds the sidebar and the main panel area side-by-side */}
            {/* It needs to manage height and allow its children to stretch vertically */}
            <div className="flex flex-grow min-h-0 items-stretch overflow-hidden"> {/* Added overflow-hidden */}
                {/* Sidebar Container */}
                <div
                    ref={sidebarRef}
                    className="relative flex-shrink-0 hidden lg:flex flex-col" // Added flex-col
                    style={{ width: `${sidebarWidth}px` }}
                >
                    {/* Ensure SessionSidebar itself handles internal scrolling if needed */}
                    <SessionSidebar />
                </div>

                {/* Resizer Handle */}
                <div
                    className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group bg-gray-100 dark:bg-gray-950 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors duration-150"
                    onMouseDown={handleMouseDown}
                    title="Resize sidebar"
                >
                    <div className="h-full w-[1px] bg-gray-300 dark:bg-gray-700 group-hover:bg-blue-500 dark:group-hover:bg-blue-400 transition-colors duration-150 mx-auto"></div>
                </div>

                {/* Content Panels Wrapper - This takes remaining horizontal space */}
                {/* It needs flex-grow and min-w-0 horizontally. */}
                {/* Crucially, it needs flex, flex-col, and min-h-0 to manage the vertical stacking/scrolling of its children (the panels). */}
                <div className={cn(
                    "flex flex-col flex-grow min-h-0 min-w-0", // Core layout: vertical flex, grow, allow shrinking
                    "lg:flex-row lg:space-x-6 lg:space-y-0", // Horizontal layout on large screens
                    "space-y-6", // Vertical spacing on small screens
                    "p-4 md:p-6 lg:p-8" // Padding
                 )}>
                    {/* Left Panel: Transcript */}
                    {/* This container needs to allow the Card inside to define its height and scrolling */}
                    <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0"> {/* Added min-h-0 */}
                        <Card className="flex flex-col flex-grow h-full overflow-hidden"> {/* Added flex-grow and overflow-hidden */}
                            <CardHeader className="mb-0 pb-2 flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
                                <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Transcription</h3>
                            </CardHeader>
                            {/* CardContent needs overflow-y-auto */}
                            <CardContent className="flex-grow overflow-y-auto p-0">
                                <Transcription
                                    session={session}
                                    editTranscriptContent={editTranscriptContent}
                                    onContentChange={onTranscriptContentChange}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    {/* Right Panel: Chat */}
                     {/* This container needs to allow the Card inside to define its height and scrolling */}
                    <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0"> {/* Added min-h-0 */}
                        {activeChatId !== null ? (
                            // Card needs to manage its internal layout and scrolling
                            <Card className="flex flex-col flex-grow h-full p-0 overflow-hidden"> {/* Added flex-grow and overflow-hidden */}
                                {/* ChatInterface needs to be structured to allow ChatMessages to scroll */}
                                <ChatInterface />
                            </Card>
                        ) : hasChats ? (
                            <Card className="flex flex-grow items-center justify-center text-center italic h-full bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                                <p className="text-gray-500 dark:text-gray-400">Select a chat from the sidebar to view it.</p>
                            </Card>
                        ) : (
                            <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
