import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs, ScrollArea } from '@radix-ui/themes'; // Added ScrollArea here
// Import new transcript types
import type { Session, StructuredTranscript } from '../../types';
import { Transcription } from './Transcription/Transcription';
import { ChatInterface } from './Chat/ChatInterface';
import { StartChatPrompt } from './Chat/StartChatPrompt';
import { SessionSidebar } from './Sidebar/SessionSidebar'; // Import SessionSidebar

interface SessionContentProps {
    session: Session; // Keep full session for metadata display? Or pass specific metadata
    onEditDetailsClick: () => void;
    // transcriptContent is now StructuredTranscript
    transcriptContent: StructuredTranscript | undefined;
    activeChatId: number | null;
    hasChats: boolean;
    onStartFirstChat: () => void;
    // Pass the loading/error states for session metadata needed by SessionSidebar in tabs
    isLoadingSessionMeta: boolean;
    sessionMetaError: Error | null;
    // Pass transcript loading/error states
    isLoadingTranscript: boolean;
    transcriptError?: Error | null;
}

export function SessionContent({ // Ensure this component is exported
    session,
    onEditDetailsClick,
    transcriptContent, // Now StructuredTranscript | undefined
    activeChatId,
    hasChats,
    onStartFirstChat,
    // Receive session meta loading/error states
    isLoadingSessionMeta,
    sessionMetaError,
    // Receive transcript loading/error states
    isLoadingTranscript,
    transcriptError,
 }: SessionContentProps) {
    // Default to 'chats' tab if no chat is active or no chats exist yet, otherwise default to 'chat'
    const [activeTab, setActiveTab] = useState<'chats' | 'chat' | 'transcription'>(
        activeChatId === null ? 'chats' : 'chat'
    );
    const [chatScrollPosition, setChatScrollPosition] = useState(0);
    const [transcriptScrollPosition, setTranscriptScrollPosition] = useState(0);

    const handleChatScroll = useCallback((scrollTop: number) => setChatScrollPosition(scrollTop), []);
    const handleTranscriptScroll = useCallback((scrollTop: number) => setTranscriptScrollPosition(scrollTop), []);

    // Effect to switch to 'chat' tab automatically *only* when a chat is first started
    // or selected *from* the 'chats' tab (i.e., activeChatId changes from null to non-null)
    React.useEffect(() => {
         // Check if activeChatId *became* non-null (previously was null)
         const wasChatPreviouslyNull = activeChatId !== null && !activeChatIdRef.current;
         if (wasChatPreviouslyNull) {
            setActiveTab('chat');
         }
         // Update the ref for the next render
         activeChatIdRef.current = activeChatId;
     }, [activeChatId]);

     // Ref to track the previous activeChatId state
     const activeChatIdRef = React.useRef(activeChatId);
     // Update ref whenever activeChatId changes *after* the render cycle completes
     React.useEffect(() => {
         activeChatIdRef.current = activeChatId;
     });


    return (
        <Flex
            direction="column"
            style={{ height: '100%', minHeight: 0 }}
        >
            {/* --- Side-by-side Layout (Large Screens - lg and up) --- */}
            {/* SessionSidebar is rendered directly in SessionView for lg+ screens */}
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
                            isLoadingSessionMeta={isLoadingSessionMeta} // For header loading state
                        />
                    ) : hasChats ? (
                        // Prompt to select chat only if sidebar is visible (lg+)
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
                        session={{
                            id: session.id,
                            clientName: session.clientName,
                            sessionName: session.sessionName,
                            date: session.date,
                            sessionType: session.sessionType,
                            therapy: session.therapy,
                            // Pass fileName and transcriptPath if needed by Transcription header (optional)
                             fileName: session.fileName,
                             transcriptPath: session.transcriptPath,
                        }}
                        // Pass the structured transcript
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
                        // Ensure type safety for tab values
                        setActiveTab(value as 'chats' | 'chat' | 'transcription');
                    }}
                    className="flex flex-col flex-grow"
                    style={{ minHeight: 0 }}
                >
                    <Box px={{ initial: '4', md: '6' }} pt="2">
                        <Tabs.List>
                            {/* Conditionally render Chats tab only if needed? Or always show? Always show for consistency */}
                            <Tabs.Trigger value="chats">Chats</Tabs.Trigger>
                            {/* Disable chat tab only if NO chats exist AND none is active */}
                            <Tabs.Trigger value="chat" disabled={!hasChats && activeChatId === null}>Chat</Tabs.Trigger>
                            <Tabs.Trigger value="transcription">Transcript</Tabs.Trigger>
                        </Tabs.List>
                    </Box>
                    {/* Use ScrollArea around the Tab Content for consistent padding and scroll */}
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, minHeight: 0 }}>
                         {/* Adjusted padding: Remove top padding from Box, let ScrollArea handle outer padding */}
                         <Box px={{ initial: '4', md: '6' }} pb={{ initial: '4', md: '6' }} className="h-full">
                            <Tabs.Content value="chats" className="h-full" style={{ outline: 'none' }}>
                                 {/* Render SessionSidebar inside the 'Chats' tab for small screens, passing hideHeader prop */}
                                <SessionSidebar
                                    session={session}
                                    isLoading={isLoadingSessionMeta} // Use session meta loading state
                                    error={sessionMetaError} // Pass error state
                                    hideHeader={true} // Hide the internal header
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
                                     // No active chat, but chats exist (prompt to select one in the 'Chats' tab)
                                     hasChats ? (
                                        <Flex align="center" justify="center" className="h-full">
                                            <Text color="gray" align="center">Select a chat from the "Chats" tab.</Text>
                                        </Flex>
                                    ) : (
                                         // No chats exist at all
                                        <StartChatPrompt onStartFirstChat={onStartFirstChat} />
                                    )
                                )}
                            </Tabs.Content>

                            <Tabs.Content value="transcription" className="h-full" style={{ outline: 'none' }}>
                                <Transcription
                                    session={{
                                        id: session.id,
                                        clientName: session.clientName,
                                        sessionName: session.sessionName,
                                        date: session.date,
                                        sessionType: session.sessionType,
                                        therapy: session.therapy,
                                        // Pass fileName and transcriptPath if needed by Transcription header (optional)
                                        fileName: session.fileName,
                                        transcriptPath: session.transcriptPath,
                                    }}
                                    // Pass the structured transcript
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
