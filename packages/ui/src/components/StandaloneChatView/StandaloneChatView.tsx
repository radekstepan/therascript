// packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react'; // Added useMemo
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Text, Spinner } from '@radix-ui/themes';
import { ChatInterface } from '../SessionView/Chat/ChatInterface';
import { SelectActiveModelModal } from '../SessionView/Modals/SelectActiveModelModal';
import { StandaloneChatHeader } from './StandaloneChatHeader';
import { fetchOllamaStatus, fetchStandaloneChatDetails } from '../../api/api'; // Added fetchStandaloneChatDetails
import type { OllamaStatus, ChatSession } from '../../types'; // Added ChatSession
import { activeChatIdAtom, toastMessageAtom } from '../../store';
import { cn } from '../../utils';

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
      navigate('/chats-list', { replace: true });
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

  // Fetch chatData to get messages for token calculation
  const chatQueryKey = ['standaloneChat', currentActiveChatId];
  const { data: chatData, isLoading: isLoadingChatData } = useQuery<
    ChatSession | null,
    Error
  >({
    queryKey: chatQueryKey,
    queryFn: () => {
      if (!currentActiveChatId) return Promise.resolve(null);
      return fetchStandaloneChatDetails(currentActiveChatId);
    },
    enabled: !!currentActiveChatId,
    staleTime: 5 * 60 * 1000, // Cache for a while
  });

  const lastAiMessageWithTokens = useMemo(() => {
    if (!chatData?.messages || chatData.messages.length === 0) {
      return null;
    }
    // Iterate in reverse to find the last AI message
    for (let i = chatData.messages.length - 1; i >= 0; i--) {
      if (chatData.messages[i].sender === 'ai') {
        return chatData.messages[i];
      }
    }
    return null; // No AI message found
  }, [chatData?.messages]);

  const latestPromptTokens = lastAiMessageWithTokens?.promptTokens ?? null;
  const latestCompletionTokens =
    lastAiMessageWithTokens?.completionTokens ?? null;

  return (
    <Flex
      direction="column"
      style={{ height: '100%', overflow: 'hidden', minHeight: 0 }}
    >
      <StandaloneChatHeader
        activeChatId={currentActiveChatId}
        ollamaStatus={ollamaStatus}
        isLoadingOllamaStatus={isLoadingOllamaStatus}
        onOpenLlmModal={handleOpenConfigureLlmModal}
        latestPromptTokens={latestPromptTokens} // <-- PASS PROP
        latestCompletionTokens={latestCompletionTokens} // <-- PASS PROP
      />
      <Box
        flexGrow="1"
        className={cn('px-4 md:px-6 lg:px-8', 'py-6')}
        style={{
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isLoadingChatData && currentActiveChatId ? ( // Show spinner if loading chat data
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Spinner size="3" /> <Text ml="2">Loading chat...</Text>
          </Flex>
        ) : currentActiveChatId ? (
          <ChatInterface
            activeChatId={currentActiveChatId}
            isStandalone={true}
            ollamaStatus={ollamaStatus}
            isLoadingOllamaStatus={isLoadingOllamaStatus}
            onOpenLlmModal={handleOpenConfigureLlmModal}
            // No transcriptTokenCount or activeModelDefaultContextSize for standalone
            // latestPromptTokens and latestCompletionTokens are managed internally by ChatInterface or its children for *its own* header
          />
        ) : (
          <Flex align="center" justify="center" style={{ height: '100%' }}>
            <Text color="gray" size="3">
              Select a chat to view or start a new one from the sidebar.
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
        ollamaStatus={ollamaStatus}
      />
    </Flex>
  );
}
