/*
Modified File: src/components/SessionView/SessionContent.tsx
+ Restored top padding. Fix for padding below input is in ChatInterface.tsx.
*/
import React, { useState } from 'react';
import { Box, Flex, Text, Tabs } from '@radix-ui/themes'; // Import Tabs
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
    // State for managing the active tab on smaller screens
    const [activeTab, setActiveTab] = useState<'chat' | 'transcription'>('chat');

    return (
        // Main Flex container: Takes FULL HEIGHT of its parent (the Box in SessionView)
        <Flex
            direction="column" // Always column now, layout handled internally
            style={{ height: '100%', minHeight: 0 }} // Ensure it fills parent height
        >
            {/* --- Side-by-side Layout (Large Screens - lg and up) --- */}
            <Flex
                className="hidden lg:flex flex-grow" // Show only on lg+
                gap="6"
                // --- RESTORED top padding ---
                px={{ initial: '4', md: '6', lg: '8' }} // Keep horizontal padding
                pt="3" // RESTORED top padding (e.g., to size 3 consistently)
                pb={{ initial: '2', md: '2', lg: '2' }} // Keep bottom padding
                // --- END RESTORATION ---
                style={{ minHeight: 0 }}
            >
                {/* Chat Panel */}
                <Flex direction="column" className="w-1/2 h-full" style={{ minHeight: 0 }}>
                    {activeChatId !== null ? (
                        <ChatInterface />
                    ) : hasChats ? (
                        <Box className="flex flex-grow items-center justify-center h-full" style={{ border: '2px dashed var(--gray-a6)', borderRadius: 'var(--radius-3)' }}>
                            <Text color="gray" align="center">Select a chat from the sidebar.</Text>
                        </Box>
                    ) : (
                        <Box className="flex flex-grow items-center justify-center h-full">
                            <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                        </Box>
                    )}
                </Flex>

                {/* Transcription Panel */}
                <Flex direction="column" className="w-1/2 h-full" style={{ minHeight: 0 }}>
                    <Transcription
                        session={session}
                        onEditDetailsClick={onEditDetailsClick}
                        editTranscriptContent={editTranscriptContent}
                        onContentChange={onTranscriptContentChange}
                    />
                </Flex>
            </Flex>

            {/* --- Tabbed Layout (Small Screens - below lg) --- */}
            <Flex className="flex lg:hidden flex-grow flex-col" style={{ minHeight: 0 }}>
                <Tabs.Root
                    value={activeTab}
                    onValueChange={(value) => setActiveTab(value as 'chat' | 'transcription')}
                    className="flex flex-col flex-grow"
                    style={{ minHeight: 0 }}
                >
                    {/* --- RESTORED top padding for Tab List wrapper --- */}
                    <Box px={{ initial: '4', md: '6' }} pt="2"> {/* RESTORED pt="2" */}
                        <Tabs.List>
                            <Tabs.Trigger value="chat">Chat</Tabs.Trigger>
                            <Tabs.Trigger value="transcription">Transcription</Tabs.Trigger>
                        </Tabs.List>
                    </Box>
                    {/* --- END RESTORATION --- */}

                    {/* --- RESTORED top padding for Tab Content wrapper --- */}
                    <Box px={{ initial: '4', md: '6' }} pb={{ initial: '4', md: '6' }} pt="2" className="flex-grow" style={{ minHeight: 0, overflow: 'hidden' }}> {/* RESTORED pt="2" */}
                        {/* --- END RESTORATION --- */}
                        <Tabs.Content value="chat" className="h-full">
                            {activeChatId !== null ? <ChatInterface /> :
                             hasChats ? <Box className="flex flex-grow items-center justify-center h-full"><Text color="gray" align="center">Select a chat from the sidebar.</Text></Box> :
                             <StartChatPrompt onStartFirstChat={onStartFirstChat} />}
                        </Tabs.Content>

                        <Tabs.Content value="transcription" className="h-full">
                             <Transcription session={session} onEditDetailsClick={onEditDetailsClick} editTranscriptContent={editTranscriptContent} onContentChange={onTranscriptContentChange} />
                        </Tabs.Content>
                    </Box>
                </Tabs.Root>
            </Flex>
        </Flex>
    );
}
