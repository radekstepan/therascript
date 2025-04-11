// src/components/SessionView/SessionContent.tsx
import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs } from '@radix-ui/themes';
import type { Session } from '../../types';
import { Transcription } from './Transcription';
import { ChatInterface } from './ChatInterface';
import { StartChatPrompt } from './StartChatPrompt';

// Update Props Interface
interface SessionContentProps {
    session: Session;
    onEditDetailsClick: () => void;
    // REMOVED: editTranscriptContent, onTranscriptContentChange
    onSaveTranscriptParagraph: (index: number, text: string) => Promise<void>;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void; // Check if this needs to be async based on hook
    isLoadingChat: boolean;
}

export function SessionContent({
    session,
    onEditDetailsClick,
    // Remove from destructuring
    onSaveTranscriptParagraph,
    activeChatId,
    hasChats,
    onStartFirstChat,
    isLoadingChat
 }: SessionContentProps) { // Props updated here
    const [activeTab, setActiveTab] = useState<'chat' | 'transcription'>('chat');
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

    const activeChatData = activeChatId !== null ? session.chats.find(c => c.id === activeChatId) : null;
    const messagesAvailable = activeChatData?.messages !== undefined; // Checks if messages array *exists*

    return (
        <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
            {/* Large Screens Layout */}
            <Flex className="hidden lg:flex flex-grow" gap="6" px={{ initial: '4', md: '6', lg: '8' }} pt="3" pb="2" style={{ minHeight: 0 }}>
                {/* Chat Panel */}
                <Flex direction="column" className="w-1/2 h-full" style={{ minHeight: 0 }}>
                    {activeChatId !== null ? (
                        <ChatInterface isLoadingChat={isLoadingChat || !messagesAvailable} /> // Update loading condition
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
                        // Add scroll props if Transcription component needs them
                        // isTabActive={true} // Always active in side-by-side
                        // initialScrollTop={transcriptScrollPosition}
                        // onScrollUpdate={handleTranscriptScroll}
                    />
                </Flex>
            </Flex>

            {/* Small Screens Layout (Tabs) */}
            <Flex className="flex lg:hidden flex-grow flex-col" style={{ minHeight: 0 }}>
                <Tabs.Root value={activeTab} onValueChange={(value) => setActiveTab(value as 'chat' | 'transcription')} className="flex flex-col flex-grow" style={{ minHeight: 0 }}>
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
                                isLoadingChat={isLoadingChat || !messagesAvailable} // Update loading condition
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
