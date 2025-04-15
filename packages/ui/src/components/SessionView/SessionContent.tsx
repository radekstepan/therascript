import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs } from '@radix-ui/themes';
import type { Session, SessionMetadata } from '../../types';
import { Transcription } from './Transcription/Transcription';
import { ChatInterface } from './Chat/ChatInterface';
import { StartChatPrompt } from './Chat/StartChatPrompt';
// Removed the circular import: import { SessionContent } from './SessionContent';

interface SessionContentProps {
    session: Session; // Keep full session for metadata display? Or pass specific metadata
    onEditDetailsClick: () => void;
    // onSaveTranscriptParagraph: (index: number, text: string) => Promise<void>; // Handled internally now
    transcriptContent: string | undefined;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
    // Pass the loading state for the session metadata
    isLoadingSessionMeta: boolean;
    isLoadingTranscript: boolean;
    transcriptError?: Error | null;
}

export function SessionContent({ // Ensure this component is exported
    session,
    onEditDetailsClick,
    // onSaveTranscriptParagraph, // Removed
    transcriptContent,
    activeChatId,
    hasChats,
    onStartFirstChat,
    // Receive session meta loading state
    isLoadingSessionMeta,
    isLoadingTranscript,
    transcriptError,
 }: SessionContentProps) {
    const [activeTab, setActiveTab] = useState<'chat' | 'transcription'>('chat');
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

    // Messages are now handled by the ChatInterface's useQuery
    // const activeChatData = activeChatId !== null
    //     ? (session?.chats || []).find(c => c.id === activeChatId)
    //     : null;
    // const messagesAvailable = activeChatData?.messages !== undefined; // isLoadingChat now covers this

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
                            // Pass session down
                            session={session}
                            activeChatId={activeChatId} // Pass activeChatId
                            isLoadingSessionMeta={isLoadingSessionMeta} // Pass down session meta loading state
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
                    {/* Pass only needed metadata + transcript content */}
                    <Transcription
                        // Provide the necessary metadata fields + ID
                        session={{
                            id: session.id,
                            clientName: session.clientName,
                            sessionName: session.sessionName,
                            date: session.date,
                            sessionType: session.sessionType,
                            therapy: session.therapy
                        }}
                        transcriptContent={transcriptContent}
                        onEditDetailsClick={onEditDetailsClick}
                        isLoadingTranscript={isLoadingTranscript}
                        transcriptError={transcriptError}
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
                            <Tabs.Trigger value="transcription">Transcript</Tabs.Trigger>
                        </Tabs.List>
                    </Box>
                    <Box px={{ initial: '4', md: '6' }} pb={{ initial: '4', md: '6' }} pt="2" className="flex-grow" style={{ minHeight: 0 }}>
                        <Tabs.Content value="chat" className="h-full" style={{ outline: 'none' }}>
                            {activeChatId !== null ?
                             <ChatInterface // Use the same ChatInterface component
                                // Pass session down
                                session={session}
                                activeChatId={activeChatId} // Pass activeChatId
                                isLoadingSessionMeta={isLoadingSessionMeta} // Pass down session meta loading state
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
                                // Provide the necessary metadata fields + ID
                                session={{
                                    id: session.id,
                                    clientName: session.clientName,
                                    sessionName: session.sessionName,
                                    date: session.date,
                                    sessionType: session.sessionType,
                                    therapy: session.therapy
                                }}
                                transcriptContent={transcriptContent}
                                onEditDetailsClick={onEditDetailsClick}
                                isLoadingTranscript={isLoadingTranscript}
                                transcriptError={transcriptError}
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
