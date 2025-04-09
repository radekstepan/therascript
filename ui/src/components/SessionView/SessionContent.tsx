/*
Modified File: src/components/SessionView/SessionContent.tsx
*/
import React from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';
import type { Session } from '../../types';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';

interface SessionContentProps {
    session: Session;
    onEditDetailsClick: () => void;
    editTranscriptContent: string;
    onTranscriptContentChange: (newContent: string) => void;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
}

export function SessionContent({
    session,
    onEditDetailsClick,
    editTranscriptContent,
    onTranscriptContentChange,
    activeChatId,
    hasChats,
    onStartFirstChat
}: SessionContentProps) {

    return (
        // *** MODIFICATION HERE ***
        // Main Flex container: Takes FULL HEIGHT of its parent (the Box in SessionView)
        <Flex
            direction={{ initial: 'column', lg: 'row' }}
            gap={{ initial: '4', lg: '6' }}
            p={{ initial: '4', md: '6', lg: '8' }}
            style={{ height: '100%', minHeight: 0 }} // Ensure it fills parent height
        >
            {/* Chat Panel: Takes half width on large screens, full height of the row */}
            {/* minHeight: 0 is crucial for flex children that need to scroll */}
            <Flex direction="column" className="lg:w-1/2 h-full" style={{ minHeight: 0 }}>
                {activeChatId !== null ? (
                    <ChatInterface /> // ChatInterface should fill this container
                ) : hasChats ? (
                    <Box className="flex flex-grow items-center justify-center h-full" style={{ border: '2px dashed var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                        <Text color="gray" align="center">Select a chat from the sidebar to view it.</Text>
                    </Box>
                ) : (
                    // Ensure StartChatPrompt fills height if it should occupy the full panel
                    <Box className="flex flex-grow items-center justify-center h-full">
                        <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                    </Box>
                )}
            </Flex>

            {/* Transcription Panel: Takes half width on large screens, full height of the row */}
            {/* minHeight: 0 is crucial */}
            <Flex direction="column" className="lg:w-1/2 h-full" style={{ minHeight: 0 }}>
                <Transcription // Transcription should fill this container
                    session={session}
                    onEditDetailsClick={onEditDetailsClick}
                    editTranscriptContent={editTranscriptContent}
                    onContentChange={onTranscriptContentChange}
                />
            </Flex>
        </Flex>
        // *** END MODIFICATION ***
    );
}
