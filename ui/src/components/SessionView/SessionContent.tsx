// src/components/SessionView/SessionContent.tsx
import React from 'react'; // Removed refs, useCallback, useEffect if not used
// Removed useAtom, clampedSidebarWidthAtom
import { Box, Flex, Text } from '@radix-ui/themes';
import type { Session } from '../../types';
// Removed SessionSidebar import
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';
// Removed cn import if no longer needed

interface SessionContentProps {
    session: Session;
    onEditDetailsClick: () => void; // Still needs this for Transcription
    editTranscriptContent: string;
    onTranscriptContentChange: (newContent: string) => void;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
}

export function SessionContent({
    session,
    onEditDetailsClick, // Still receive handler
    editTranscriptContent,
    onTranscriptContentChange,
    activeChatId,
    hasChats,
    onStartFirstChat
}: SessionContentProps) {

    // Removed sidebar width state and resizing logic

    return (
        // Main Flex container for the two panels ONLY
        // Takes full width available from parent, applies padding
        // Takes full height available from parent (via flexGrow in parent Box)
        <Flex
            flexGrow="1" // Ensures it tries to fill height from parent Box
            direction={{ initial: 'column', lg: 'row' }}
            gap={{ initial: '4', lg: '6' }}
            p={{ initial: '4', md: '6', lg: '8' }} // Padding for the content panels
            style={{ minHeight: 0 }} // Important for scroll context
        >
            {/* Chat Panel */}
            <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                {activeChatId !== null ? (
                    <ChatInterface />
                ) : hasChats ? (
                    <Box className="flex flex-grow items-center justify-center" style={{ border: '2px dashed var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                        <Text color="gray" align="center">Select a chat from the sidebar to view it.</Text>
                    </Box>
                ) : (
                    <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                )}
            </Flex>

            {/* Transcription Panel */}
            <Flex direction="column" className="lg:w-1/2" style={{ minHeight: 0 }}>
                <Transcription
                    session={session}
                    onEditDetailsClick={onEditDetailsClick} // Pass handler down
                    editTranscriptContent={editTranscriptContent}
                    onContentChange={onTranscriptContentChange}
                />
            </Flex>
        </Flex>
    );
}
