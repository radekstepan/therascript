// Path: packages/ui/src/components/SessionView/SessionContent.tsx
import React, { useState, useCallback } from 'react';
import { Box, Flex, Text, Tabs, ScrollArea } from '@radix-ui/themes';
import type { Session, StructuredTranscript, OllamaStatus } from '../../types'; // Add OllamaStatus
import { Transcription } from './Transcription/Transcription';
import { ChatInterface } from './Chat/ChatInterface';
import { StartChatPrompt } from './Chat/StartChatPrompt';
import { SessionSidebar } from './Sidebar/SessionSidebar';

interface SessionContentProps {
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
  ollamaStatus: OllamaStatus | undefined;
  isLoadingOllamaStatus: boolean;
  onOpenLlmModal: () => void;
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
  ollamaStatus,
  isLoadingOllamaStatus,
  onOpenLlmModal,
}: SessionContentProps) {
  const [activeTab, setActiveTab] = useState<
    'chats' | 'chat' | 'transcription'
  >(activeChatId === null ? 'chats' : 'chat');

  // Removed scroll position state as scrolling is now fully managed by child components

  const activeChatIdRef = React.useRef(activeChatId);
  React.useEffect(() => {
    const wasChatPreviouslyNull =
      activeChatId !== null && !activeChatIdRef.current;
    if (wasChatPreviouslyNull) {
      setActiveTab('chat');
    }
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  return (
    <Flex direction="column" style={{ height: '100%', minHeight: 0 }}>
      {' '}
      {/* Ensure this fills parent */}
      {/* --- Side-by-side Layout (Large Screens) --- */}
      <Flex
        className="hidden lg:flex flex-grow" // flex-grow to take available space
        gap="4"
        px={{ initial: '4', md: '6' }}
        pt="3"
        pb="3"
        style={{ minHeight: 0 }} // Crucial for flex children
      >
        {/* Chat Panel - needs to be flex column to allow ChatInterface to fill */}
        <Flex
          direction="column"
          className="w-1/2 h-full" // h-full works because parent Flex has defined height context
          style={{ minHeight: 0 }} // Crucial for flex children
        >
          {activeChatId !== null ? (
            <ChatInterface
              session={session}
              activeChatId={activeChatId}
              isStandalone={false}
              isLoadingSessionMeta={isLoadingSessionMeta}
              ollamaStatus={ollamaStatus}
              isLoadingOllamaStatus={isLoadingOllamaStatus}
              onOpenLlmModal={onOpenLlmModal}
            />
          ) : hasChats ? (
            <Box
              className="flex flex-grow items-center justify-center h-full"
              style={{
                border: '1px dashed var(--gray-a6)',
                borderRadius: 'var(--radius-3)',
              }}
            >
              <Text color="gray" align="center">
                Select a chat from the sidebar.
              </Text>
            </Box>
          ) : (
            <Box className="flex flex-grow items-center justify-center h-full">
              <StartChatPrompt
                onStartFirstChat={onStartFirstChat}
                isLoading={isLoadingSessionMeta}
              />
            </Box>
          )}
        </Flex>

        {/* Transcription Panel - needs to be flex column */}
        <Flex
          direction="column"
          className="w-1/2 h-full" // h-full works
          style={{ minHeight: 0 }} // Crucial for flex children
        >
          <Transcription
            session={session}
            transcriptContent={transcriptContent}
            onEditDetailsClick={onEditDetailsClick}
            isLoadingTranscript={isLoadingTranscript}
            transcriptError={transcriptError}
          />
        </Flex>
      </Flex>
      {/* --- Tabbed Layout (Small Screens) --- */}
      <Flex
        className="flex lg:hidden flex-grow flex-col" // flex-grow to take available space
        style={{ minHeight: 0 }} // Crucial
      >
        <Tabs.Root
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as 'chats' | 'chat' | 'transcription');
          }}
          // className="flex flex-col flex-grow"
          // style={{ minHeight: 0 }}
          // Make Tabs.Root itself a flex container that fills height
          className="flex flex-col h-full"
        >
          <Box px={{ initial: '4', md: '6' }} pt="2" flexShrink="0">
            {' '}
            {/* TabList is fixed height */}
            <Tabs.List>
              <Tabs.Trigger value="chats">Chats</Tabs.Trigger>
              <Tabs.Trigger
                value="chat"
                disabled={!hasChats && activeChatId === null}
              >
                Chat
              </Tabs.Trigger>
              <Tabs.Trigger value="transcription">Transcript</Tabs.Trigger>
            </Tabs.List>
          </Box>

          {/* Each Tabs.Content needs to manage its own height and allow children to fill it */}
          {/* Removing the outer ScrollArea here */}
          <Tabs.Content
            value="chats"
            className="flex-grow overflow-hidden" // flex-grow to take space, overflow-hidden
            style={{
              outline: 'none',
              minHeight: 0,
              display: activeTab === 'chats' ? 'flex' : 'none',
              flexDirection: 'column',
            }} // Use display:flex for active tab
          >
            <Box
              px={{ initial: '4', md: '6' }}
              pb={{ initial: '4', md: '6' }}
              pt="3"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <SessionSidebar // SessionSidebar needs to be adaptable to this flex context
                session={session}
                isLoading={isLoadingSessionMeta}
                error={sessionMetaError}
                hideHeader={true}
              />
            </Box>
          </Tabs.Content>
          <Tabs.Content
            value="chat"
            className="flex-grow overflow-hidden" // flex-grow to take space, overflow-hidden
            style={{
              outline: 'none',
              minHeight: 0,
              display: activeTab === 'chat' ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <Box
              px={{ initial: '4', md: '6' }}
              pb={{ initial: '4', md: '6' }}
              pt="3"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              {activeChatId !== null ? (
                <ChatInterface
                  session={session}
                  activeChatId={activeChatId}
                  isStandalone={false}
                  isLoadingSessionMeta={isLoadingSessionMeta}
                  ollamaStatus={ollamaStatus}
                  isLoadingOllamaStatus={isLoadingOllamaStatus}
                  onOpenLlmModal={onOpenLlmModal}
                  isTabActive={activeTab === 'chat'}
                />
              ) : hasChats ? (
                <Flex align="center" justify="center" className="h-full">
                  <Text color="gray" align="center">
                    Select a chat from the "Chats" tab.
                  </Text>
                </Flex>
              ) : (
                <StartChatPrompt
                  onStartFirstChat={onStartFirstChat}
                  isLoading={isLoadingSessionMeta}
                />
              )}
            </Box>
          </Tabs.Content>
          <Tabs.Content
            value="transcription"
            className="flex-grow overflow-hidden" // flex-grow to take space, overflow-hidden
            style={{
              outline: 'none',
              minHeight: 0,
              display: activeTab === 'transcription' ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <Box
              px={{ initial: '4', md: '6' }}
              pb={{ initial: '4', md: '6' }}
              pt="3"
              style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Transcription
                session={session}
                transcriptContent={transcriptContent}
                onEditDetailsClick={onEditDetailsClick}
                isLoadingTranscript={isLoadingTranscript}
                transcriptError={transcriptError}
                isTabActive={activeTab === 'transcription'}
              />
            </Box>
          </Tabs.Content>
        </Tabs.Root>
      </Flex>
    </Flex>
  );
}
