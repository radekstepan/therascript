// packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
// import { UserThemeDropdown } from '../User/UserThemeDropdown'; // REMOVED
import { ChatInterface } from '../SessionView/Chat/ChatInterface';
import { SelectActiveModelModal } from '../SessionView/Modals/SelectActiveModelModal';
import { StandaloneChatSidebar } from './StandaloneChatSidebar';
import { fetchStandaloneChatDetails, fetchOllamaStatus } from '../../api/api';
import type { ChatSession, OllamaStatus } from '../../types';
import {
  activeChatIdAtom,
  toastMessageAtom,
  clampedSidebarWidthAtom,
  sidebarWidthAtom,
} from '../../store';
import { formatTimestamp } from '../../helpers';

export function StandaloneChatView() {
  const { chatId: chatIdParam } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeChatIdState, setActiveChatIdState] = useAtom(activeChatIdAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const clampedSidebarWidth = useAtomValue(clampedSidebarWidthAtom);
  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const previousChatIdRef = useRef<number | null>(null);

  const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

  const {
    data: chatData,
    isLoading: isLoadingChat,
    error: chatError,
    isFetching: isFetchingChat,
  } = useQuery<ChatSession | null, Error>({
    queryKey: ['standaloneChat', chatIdNum],
    queryFn: () => {
      if (!chatIdNum) return Promise.resolve(null);
      return fetchStandaloneChatDetails(chatIdNum);
    },
    enabled: !!chatIdNum,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: ollamaStatus,
    isLoading: isLoadingOllamaStatus,
    error: ollamaError,
  } = useQuery<OllamaStatus, Error>({
    queryKey: ['ollamaStatus'],
    queryFn: () => fetchOllamaStatus(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });

  useEffect(() => {
    const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;
    if (!currentChatIdNum || isNaN(currentChatIdNum)) {
      navigate('/', { replace: true });
      setActiveChatIdState(null);
      return;
    }
    if (currentChatIdNum !== activeChatIdState) {
      setActiveChatIdState(currentChatIdNum);
      previousChatIdRef.current = currentChatIdNum;
    }
  }, [chatIdParam, activeChatIdState, navigate, setActiveChatIdState]);

  useEffect(() => {
    if (!isLoadingChat && !isFetchingChat && !chatData && chatIdNum) {
      setToast(`Error: Standalone chat ${chatIdNum} not found.`);
      navigate('/', { replace: true });
    }
  }, [isLoadingChat, isFetchingChat, chatData, chatIdNum, navigate, setToast]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing.current || !sidebarRef.current) return;
      const containerRect =
        sidebarRef.current.parentElement?.getBoundingClientRect();
      if (!containerRect) return;
      let newWidth = e.clientX - containerRect.left;
      setSidebarWidth(newWidth);
    },
    [setSidebarWidth]
  );
  const handleMouseUp = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [handleMouseMove]);
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      isResizing.current = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [handleMouseMove, handleMouseUp]
  );
  useEffect(() => {
    return () => {
      if (isResizing.current) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        isResizing.current = false;
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleOpenConfigureLlmModal = () => setIsSelectModelModalOpen(true);
  const handleNavigateBack = () => navigate('/');
  const handleModelSuccessfullySet = () => {
    console.log(
      '[StandaloneChatView] Model successfully set via SelectActiveModelModal.'
    );
    setToast('AI Model configured successfully.');
  };

  if (isLoadingChat && !chatData) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}
      >
        <Spinner size="3" />{' '}
        <Text ml="2" color="gray">
          Loading chat...
        </Text>
      </Flex>
    );
  }

  const displayTitle =
    chatData?.name ||
    (chatData
      ? `Chat (${formatTimestamp(chatData.timestamp)})`
      : 'Standalone Chat');

  return (
    <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
      <Box
        ref={sidebarRef}
        className="relative flex-shrink-0 hidden lg:flex flex-col"
        style={{
          width: `${clampedSidebarWidth}px`,
          backgroundColor: 'var(--color-panel-solid)', // Radix slate
          borderRight: '1px solid var(--gray-a6)', // Radix slate border
        }}
      >
        <StandaloneChatSidebar
          isLoading={isLoadingChat || isFetchingChat}
          error={chatError}
        />
      </Box>
      <Box
        className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[var(--gray-a4)]" // Radix hover
        onMouseDown={handleMouseDown}
        title="Resize sidebar"
      >
        <Box className="h-full w-[1px] bg-[var(--gray-a5)] group-hover:bg-[var(--accent-9)] mx-auto" />{' '}
        {/* Radix accent */}
      </Box>
      <Flex
        direction="column"
        flexGrow="1"
        style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}
      >
        <Box
          px={{ initial: '5', md: '7', lg: '8' }}
          py="3"
          flexShrink="0"
          style={{
            backgroundColor: 'var(--color-panel-solid)', // Radix slate
            borderBottom: '1px solid var(--gray-a6)', // Radix slate border
          }}
        >
          <Flex justify="between" align="center">
            <Flex align="center" gap="2" style={{ minWidth: 0 }}>
              <Button
                onClick={handleNavigateBack}
                variant="ghost"
                color="gray"
                size="2"
                style={{ flexShrink: 0 }}
              >
                <ArrowLeftIcon /> Home
              </Button>
              <Text color="gray" size="2" style={{ flexShrink: 0 }}>
                {' / '}
              </Text>
              <Text
                size="2"
                weight="bold"
                truncate
                title={displayTitle}
                style={{ flexShrink: 1 }}
                className="text-slate-800 dark:text-slate-200"
              >
                {displayTitle}
              </Text>
            </Flex>
            {/* UserThemeDropdown removed */}
          </Flex>
        </Box>
        <Box
          flexGrow="1"
          style={{
            minHeight: 0,
            overflow: 'hidden',
            padding: 'var(--space-3)', // Radix space variable
          }}
        >
          <ChatInterface
            activeChatId={chatIdNum}
            isStandalone={true}
            isLoadingSessionMeta={false}
            ollamaStatus={ollamaStatus}
            isLoadingOllamaStatus={isLoadingOllamaStatus}
            onOpenLlmModal={handleOpenConfigureLlmModal}
          />
        </Box>
      </Flex>

      <SelectActiveModelModal
        isOpen={isSelectModelModalOpen}
        onOpenChange={setIsSelectModelModalOpen}
        onModelSuccessfullySet={handleModelSuccessfullySet}
        currentActiveModelName={ollamaStatus?.activeModel}
        currentConfiguredContextSize={ollamaStatus?.configuredContextSize}
      />
    </Flex>
  );
}
