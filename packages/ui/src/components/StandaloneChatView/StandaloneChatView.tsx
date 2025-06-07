// packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Text, Spinner } from '@radix-ui/themes'; // Removed Button and ArrowLeftIcon
import { ChatInterface } from '../SessionView/Chat/ChatInterface';
import { SelectActiveModelModal } from '../SessionView/Modals/SelectActiveModelModal';
import { StandaloneChatHeader } from './StandaloneChatHeader';
import { fetchOllamaStatus } from '../../api/api';
import type { OllamaStatus } from '../../types';
import { activeChatIdAtom, toastMessageAtom } from '../../store';

export function StandaloneChatView() {
  const { chatId: chatIdParam } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeChatIdState, setActiveChatIdState] = useAtom(activeChatIdAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);

  const previousChatIdRef = useRef<number | null>(null);

  const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

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

  const handleOpenConfigureLlmModal = () => setIsSelectModelModalOpen(true);
  const handleModelSuccessfullySet = () => {
    console.log(
      '[StandaloneChatView] Model successfully set via SelectActiveModelModal.'
    );
    setToast('AI Model configured successfully.');
  };

  const currentActiveChatId = activeChatIdState;

  return (
    <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
      <Flex
        direction="column"
        flexGrow="1"
        style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}
      >
        {/* Top bar within the view - REMOVED the backlink and container */}
        {/* The "All Chats" link is now part of PersistentSidebar */}

        <StandaloneChatHeader activeChatId={currentActiveChatId} />

        <Box
          flexGrow="1"
          style={{
            minHeight: 0,
            overflow: 'hidden',
            padding: 'var(--space-3)',
          }}
        >
          {currentActiveChatId ? (
            <ChatInterface
              activeChatId={currentActiveChatId}
              isStandalone={true}
              ollamaStatus={ollamaStatus}
              isLoadingOllamaStatus={isLoadingOllamaStatus}
              onOpenLlmModal={handleOpenConfigureLlmModal}
            />
          ) : (
            <Flex align="center" justify="center" style={{ height: '100%' }}>
              <Text color="gray" size="3">
                Select a chat to view or start a new one.
              </Text>
            </Flex>
          )}
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
