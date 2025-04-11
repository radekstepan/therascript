import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs } from '@radix-ui/themes';
import type { Session } from '../../types'; // Adjusted path
import { Transcription } from './Transcription/Transcription'; // Adjusted path
import { ChatInterface } from './Chat/ChatInterface'; // Adjusted path
import { StartChatPrompt } from './Chat/StartChatPrompt'; // Adjusted path

// --- Interface Update: Remove unused props ---
interface SessionContentProps {
    session: Session;
    onEditDetailsClick: () => void;
    // REMOVED: editTranscriptContent: string;
    // REMOVED: onTranscriptContentChange: (newContent: string) => void;
    onSaveTranscriptParagraph: (index: number, text: string) => Promise<void>; // Still needed by Transcription
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
    isLoadingChat: boolean;
}
// --- End Interface Update ---

export function SessionContent({
    session,
    onEditDetailsClick,
    // --- Destructuring Update: Remove unused props ---
    // REMOVED: editTranscriptContent,
    // REMOVED: onTranscriptContentChange,
    // --- End Destructuring Update ---
    onSaveTranscriptParagraph, // Keep this one
    activeChatId,
    hasChats,
    onStartFirstChat,
    isLoadingChat
 }: SessionContentProps) {
    const [activeTab, setActiveTab] = useState<'chat' | 'transcription'>('chat');
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

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
                        <ChatInterface
                            isLoadingChat={isLoadingChat || !messagesAvailable}
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
                    {/* No changes needed here, Transcription component receives the props it needs */}
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
                                isLoadingChat={isLoadingChat || !messagesAvailable}
                                isTabActive={activeTab === 'chat'}
                                initialScrollTop={chatScrollPosition}
                                onScrollUpdate={handleChatScroll}
                             /> :
                             hasChats ? <Box className="flex flex-grow items-center justify-center h-full"><Text color="gray" align="center">Select a chat from the sidebar.</Text></Box> :
                             <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                            }
                        </Tabs.Content>

                        <Tabs.Content value="transcription" className="h-full" style={{ outline: 'none' }}>
                             {/* No changes needed here, Transcription component receives the props it needs */}
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
