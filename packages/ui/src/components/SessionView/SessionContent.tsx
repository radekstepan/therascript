import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs, ScrollArea } from '@radix-ui/themes';
import type { Session, StructuredTranscript } from '../../types';
import { Transcription } from './Transcription/Transcription';
import { ChatInterface } from './Chat/ChatInterface';
import { StartChatPrompt } from './Chat/StartChatPrompt';
import { SessionSidebar } from './Sidebar/SessionSidebar';

interface SessionContentProps {
    // Session prop should already be the full Session type
    session: Session;
    onEditDetailsClick: () => void;
    transcriptContent: StructuredTranscript | undefined;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
    isLoadingSessionMeta: boolean;
    sessionMetaError: Error | null;
    isLoadingTranscript: boolean;
    transcriptError?: Error | null;
}

export function SessionContent({
    session,
    onEditDetailsClick,
    transcriptContent,
    activeChatId,
    hasChats,
    onStartFirstChat,
    isLoadingSessionMeta,
    sessionMetaError,
    isLoadingTranscript,
    transcriptError,
 }: SessionContentProps) {
    const [activeTab, setActiveTab] = useState<'chats' | 'chat' | 'transcription'>(
        activeChatId === null ? 'chats' : 'chat'
    );
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

    React.useEffect(() => {
         const wasChatPreviouslyNull = activeChatId !== null && !activeChatIdRef.current;
         if (wasChatPreviouslyNull) {
            setActiveTab('chat');
         }
         activeChatIdRef.current = activeChatId;
     }, [activeChatId]);

     const activeChatIdRef = React.useRef(activeChatId);
     React.useEffect(() => {
         activeChatIdRef.current = activeChatId;
     });


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
                            session={session}
                            activeChatId={activeChatId}
                            isLoadingSessionMeta={isLoadingSessionMeta}
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
                    {/* --- FIX 1: Pass the entire session object --- */}
                    <Transcription
                        session={session} // Pass the full session object
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
                        setActiveTab(value as 'chats' | 'chat' | 'transcription');
                    }}
                    className="flex flex-col flex-grow"
                    style={{ minHeight: 0 }}
                >
                    <Box px={{ initial: '4', md: '6' }} pt="2">
                        <Tabs.List>
                            <Tabs.Trigger value="chats">Chats</Tabs.Trigger>
                            <Tabs.Trigger value="chat" disabled={!hasChats && activeChatId === null}>Chat</Tabs.Trigger>
                            <Tabs.Trigger value="transcription">Transcript</Tabs.Trigger>
                        </Tabs.List>
                    </Box>
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, minHeight: 0 }}>
                         <Box px={{ initial: '4', md: '6' }} pb={{ initial: '4', md: '6' }} className="h-full">
                            <Tabs.Content value="chats" className="h-full" style={{ outline: 'none' }}>
                                <SessionSidebar
                                    session={session}
                                    isLoading={isLoadingSessionMeta}
                                    error={sessionMetaError}
                                    hideHeader={true}
                                />
                            </Tabs.Content>

                            <Tabs.Content value="chat" className="h-full" style={{ outline: 'none' }}>
                                {activeChatId !== null ? (
                                    <ChatInterface
                                        session={session}
                                        activeChatId={activeChatId}
                                        isLoadingSessionMeta={isLoadingSessionMeta}
                                        isTabActive={activeTab === 'chat'}
                                        initialScrollTop={chatScrollPosition}
                                        onScrollUpdate={handleChatScroll}
                                    />
                                ) : (
                                     hasChats ? (
                                        <Flex align="center" justify="center" className="h-full">
                                            <Text color="gray" align="center">Select a chat from the "Chats" tab.</Text>
                                        </Flex>
                                    ) : (
                                        <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                                    )
                                )}
                            </Tabs.Content>

                            <Tabs.Content value="transcription" className="h-full" style={{ outline: 'none' }}>
                                 {/* --- FIX 2: Pass the entire session object --- */}
                                <Transcription
                                    session={session} // Pass the full session object
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
                    </ScrollArea>
                </Tabs.Root>
            </Flex>
        </Flex>
    );
}
