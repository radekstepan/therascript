// packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Text, Spinner } from '@radix-ui/themes';
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
    <Flex
      direction="column"
      style={{ height: '100%', overflow: 'hidden', minHeight: 0 }} // Fill parent height, minHeight:0 for flex context
    >
      <StandaloneChatHeader activeChatId={currentActiveChatId} />{' '}
      {/* Fixed height child */}
      <Box // This Box will contain ChatInterface and handle its growth
        flexGrow="1" // Takes remaining vertical space
        style={{
          minHeight: 0, // Crucial for flex children that need to scroll internally
          overflow: 'hidden', // Ensure this Box itself doesn't cause page scroll
          padding: 'var(--space-3)', // Keep padding if desired for aesthetics
          display: 'flex', // Make it a flex container for ChatInterface
          flexDirection: 'column', // ChatInterface will be a column
        }}
      >
        {currentActiveChatId ? (
          <ChatInterface // ChatInterface should now be height: '100%' of this Box
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
