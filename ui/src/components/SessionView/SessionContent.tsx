/*
Modified File: src/components/SessionView/SessionContent.tsx
+ Added isLoadingChat prop
*/
import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs } from '@radix-ui/themes';
import type { Session } from '../../types';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';

interface SessionContentProps {
    session: Session;
    onEditDetailsClick: () => void;
    editTranscriptContent: string; // Current value being edited (controlled input)
    onTranscriptContentChange: (newContent: string) => void; // Handles live changes in edit mode
    onSaveTranscriptParagraph: (index: number, text: string) => Promise<void>; // Handles saving a paragraph
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
    isLoadingChat: boolean; // <-- Add prop
}

export function SessionContent({
    session,
    onEditDetailsClick,
    editTranscriptContent,
    onTranscriptContentChange,
    onSaveTranscriptParagraph,
    activeChatId,
    hasChats,
    onStartFirstChat,
    isLoadingChat // <-- Destructure prop
 }: SessionContentProps) {
    const [activeTab, setActiveTab] = useState<'chat' | 'transcription'>('chat');
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

    // Determine if the current active chat actually has messages loaded
    // This relies on the parent (SessionView) updating the session prop correctly
    const activeChatData = activeChatId !== null
        ? session.chats.find(c => c.id === activeChatId)
        : null;
    const messagesAvailable = activeChatData?.messages !== undefined;

    return (
        <Flex
            direction="column"
            style={{ height: '100%', minHeight: 0 }}
        >
            {/* --- Side-by-side Layout (Large Screens - lg and up) --- */}
            <Flex
                className="hidden lg:flex flex-grow"
                gap="6"
                px={{ initial: '4', md: '6', lg: '8' }}
                pt="3"
                pb={{ initial: '2', md: '2', lg: '2' }}
                style={{ minHeight: 0 }}
            >
                {/* Chat Panel */}
                <Flex direction="column" className="w-1/2 h-full" style={{ minHeight: 0 }}>
                    {activeChatId !== null ? (
                        // Pass isLoadingChat down
                        <ChatInterface
                            isLoadingChat={isLoadingChat || !messagesAvailable} // Show loading if fetching OR if messages aren't defined yet
                        />
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
                        onSaveParagraph={onSaveTranscriptParagraph}
                    />
                </Flex>
            </Flex>

            {/* --- Tabbed Layout (Small Screens - below lg) --- */}
            <Flex className="flex lg:hidden flex-grow flex-col" style={{ minHeight: 0 }}>
                <Tabs.Root
                    value={activeTab}
                    onValueChange={(value) => {
                        setActiveTab(value as 'chat' | 'transcription');
                    }}
                    className="flex flex-col flex-grow"
                    style={{ minHeight: 0 }}
                >
                    <Box px={{ initial: '4', md: '6' }} pt="2">
                        <Tabs.List>
                            <Tabs.Trigger value="chat">Chat</Tabs.Trigger>
                            <Tabs.Trigger value="transcription">Transcription</Tabs.Trigger>
                        </Tabs.List>
                    </Box>
                    <Box px={{ initial: '4', md: '6' }} pb={{ initial: '4', md: '6' }} pt="2" className="flex-grow" style={{ minHeight: 0 }}>
                        <Tabs.Content value="chat" className="h-full" style={{ outline: 'none' }}>
                            {activeChatId !== null ?
                             <ChatInterface
                                isLoadingChat={isLoadingChat || !messagesAvailable} // Show loading if fetching OR if messages aren't defined yet
                                isTabActive={activeTab === 'chat'}
                                initialScrollTop={chatScrollPosition}
                                onScrollUpdate={handleChatScroll}
                             /> :
                             hasChats ? <Box className="flex flex-grow items-center justify-center h-full"><Text color="gray" align="center">Select a chat from the sidebar.</Text></Box> :
                             <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                            }
                        </Tabs.Content>

                        <Tabs.Content value="transcription" className="h-full" style={{ outline: 'none' }}>
                             <Transcription
                                session={session}
                                onEditDetailsClick={onEditDetailsClick}
                                onSaveParagraph={onSaveTranscriptParagraph}
                                isTabActive={activeTab === 'transcription'}
                                initialScrollTop={transcriptScrollPosition}
                                onScrollUpdate={handleTranscriptScroll}
                             />
                        </Tabs.Content>
                    </Box>
                </Tabs.Root>
            </Flex>
        </Flex>
    );
}
