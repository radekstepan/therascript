// packages/ui/src/components/SessionView/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { SessionContent } from './SessionContent';
import { EditDetailsModal } from './Modals/EditDetailsModal';
import { SelectActiveModelModal } from './Modals/SelectActiveModelModal';
import {
  fetchSession,
  fetchTranscript,
  startSessionChat,
  fetchSessionChatDetails,
} from '../../api/api';
import { fetchVllmStatus } from '../../api/vllm';
import type {
  Session,
  SessionMetadata,
  ChatSession,
  StructuredTranscript,
  OllamaStatus,
} from '../../types';
import {
  activeSessionIdAtom,
  activeChatIdAtom,
  toastMessageAtom,
} from '../../store';

export function SessionView() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{
    sessionId: string;
    chatId?: string;
  }>();
  const navigate = useNavigate();
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setActiveChatId = useSetAtom(activeChatIdAtom);
  const activeChatIdAtomValue = useAtomValue(activeChatIdAtom);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);
  const setToast = useSetAtom(toastMessageAtom);

  const previousSessionIdRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

  const {
    data: sessionMetadata,
    isLoading: isLoadingSessionMeta,
    error: sessionMetaError,
    isFetching: isFetchingSessionMeta,
  } = useQuery<Session, Error>({
    queryKey: ['sessionMeta', sessionIdNum],
    queryFn: () => {
      if (!sessionIdNum) return Promise.reject(new Error('Invalid Session ID'));
      return fetchSession(sessionIdNum);
    },
    enabled: !!sessionIdNum,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: transcriptContent,
    isLoading: isLoadingTranscript,
    error: transcriptError,
  } = useQuery<StructuredTranscript, Error>({
    queryKey: ['transcript', sessionIdNum],
    queryFn: () => {
      if (!sessionIdNum) return Promise.reject(new Error('Invalid Session ID'));
      return fetchTranscript(sessionIdNum);
    },
    enabled: !!sessionIdNum,
    staleTime: Infinity,
  });

  const {
    data: ollamaStatus,
    isLoading: isLoadingOllamaStatus,
    error: ollamaError,
  } = useQuery<OllamaStatus, Error>({
    queryKey: ['vllmStatus'],
    queryFn: () => fetchVllmStatus(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  });

  const startChatMutation = useMutation<ChatSession, Error>({
    mutationFn: () => {
      if (!sessionIdNum) throw new Error('Session ID is missing');
      return startSessionChat(sessionIdNum);
    },
    onSuccess: (newChat) => {
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionIdNum],
        (oldData) => {
          if (!oldData) return oldData;
          return { ...oldData, chats: [...(oldData.chats || []), newChat] };
        }
      );
      if (sessionIdNum !== null) {
        queryClient.prefetchQuery({
          queryKey: ['chat', sessionIdNum, newChat.id],
          queryFn: () => fetchSessionChatDetails(sessionIdNum!, newChat.id),
        });
        navigate(`/sessions/${sessionIdNum}/chats/${newChat.id}`);
      } else {
        console.error('Cannot prefetch or navigate: sessionIdNum is null');
      }
    },
    onError: (error) => {
      console.error('Failed to start new chat:', error);
      setToast(`Error starting chat: ${error.message}`);
    },
  });

  useEffect(() => {
    const currentSessionIdNum = sessionIdParam
      ? parseInt(sessionIdParam, 10)
      : null;
    if (!currentSessionIdNum || isNaN(currentSessionIdNum)) {
      navigate('/', { replace: true });
      setActiveSessionId(null);
      setActiveChatId(null);
      return;
    }
    setActiveSessionId(currentSessionIdNum);
    const isNewSession = previousSessionIdRef.current !== currentSessionIdNum;
    if (sessionMetadata) {
      if (isNewSession) {
        previousSessionIdRef.current = currentSessionIdNum;
      }
      const chats = sessionMetadata.chats || [];
      let targetChatId: number | null = null;
      let shouldNavigate = false;
      let navigateTo: string | null = null;
      const urlChatId = chatIdParam ? parseInt(chatIdParam, 10) : null;
      const chatExistsInSession =
        urlChatId !== null &&
        !isNaN(urlChatId) &&
        chats.some((c) => c.id === urlChatId);

      if (chatExistsInSession && urlChatId !== null) {
        targetChatId = urlChatId;
      } else if (chats.length > 0) {
        const sortedChats = [...chats].sort(
          (a, b) => b.timestamp - a.timestamp
        );
        targetChatId = sortedChats[0].id;
        if (!chatIdParam || !chatExistsInSession) {
          shouldNavigate = true;
          navigateTo = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
        }
      } else if (chatIdParam) {
        shouldNavigate = true;
        navigateTo = `/sessions/${currentSessionIdNum}`;
      }

      if (targetChatId !== activeChatIdAtomValue) {
        setActiveChatId(targetChatId);
      }
      if (shouldNavigate && navigateTo) {
        navigate(navigateTo, { replace: true });
      }
    } else {
      if (isNewSession) {
        setActiveChatId(null);
        previousSessionIdRef.current = currentSessionIdNum;
      }
    }
  }, [
    sessionIdParam,
    chatIdParam,
    sessionMetadata,
    activeChatIdAtomValue,
    navigate,
    setActiveSessionId,
    setActiveChatId,
  ]);

  const handleStartFirstChat = useCallback(async () => {
    if (startChatMutation.isPending) return;
    startChatMutation.mutate();
  }, [startChatMutation]);

  const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
  const handleOpenConfigureLlmModal = () => setIsSelectModelModalOpen(true);
  const handleNavigateBack = () => navigate('/sessions-list');
  const handleMetadataSaveSuccess = (
    updatedMetadata: Partial<SessionMetadata>
  ) => {
    setToast('Session details updated successfully.');
  };
  const handleModelSuccessfullySet = () => {
    console.log(
      '[SessionView] Model successfully set via SelectActiveModelModal.'
    );
    setToast('AI Model configured successfully.');
  };

  if (isLoadingSessionMeta && !sessionMetadata) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ height: '100%', backgroundColor: 'var(--color-panel-solid)' }}
      >
        <Spinner size="3" />{' '}
        <Text ml="2" color="gray">
          Loading session data...
        </Text>
      </Flex>
    );
  }
  if (sessionMetaError || !sessionMetadata) {
    return (
      <Flex
        direction="column"
        justify="center"
        align="center"
        style={{ height: '100%', backgroundColor: 'var(--color-panel-solid)' }}
      >
        <Text color="red" mb="4">
          {sessionMetaError?.message || 'Session data could not be loaded.'}
        </Text>
        <Button onClick={handleNavigateBack} variant="soft" color="gray">
          <ArrowLeftIcon /> Go back to Sessions
        </Button>
      </Flex>
    );
  }
  if (ollamaError) console.error('Ollama status check failed:', ollamaError);

  const displayTitle = sessionMetadata.sessionName || sessionMetadata.fileName;
  const hasChats = sessionMetadata.chats && sessionMetadata.chats.length > 0;
  const currentActiveChatId = chatIdParam
    ? parseInt(chatIdParam, 10)
    : (activeChatIdAtomValue ?? null);

  const transcriptTokenCount = sessionMetadata.transcriptTokenCount;
  const activeModelDefaultContextSize =
    ollamaStatus?.details?.name === ollamaStatus?.activeModel
      ? ollamaStatus?.details?.defaultContextSize
      : null;

  return (
    <Flex
      direction="column"
      style={{ height: '100%', overflow: 'hidden', minHeight: 0 }}
    >
      <Box
        px={{ initial: '6' }}
        py="3"
        flexShrink="0"
        style={{
          backgroundColor: 'var(--color-panel-solid)',
          borderBottom: '1px solid var(--gray-a6)',
        }}
      >
        <Flex justify="between" align="center">
          <Flex align="center" gap="2" style={{ minWidth: 0 }}>
            <Text
              size="2"
              weight="bold"
              truncate
              title={displayTitle}
              style={{ flexShrink: 1 }}
              className="text-gray-800 dark:text-gray-200"
            >
              {displayTitle}
            </Text>
          </Flex>
        </Flex>
      </Box>

      <Box
        flexGrow="1"
        style={{
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <SessionContent
          session={sessionMetadata}
          transcriptContent={transcriptContent}
          onEditDetailsClick={handleOpenEditMetadataModal}
          activeChatId={currentActiveChatId}
          hasChats={hasChats}
          onStartFirstChat={handleStartFirstChat}
          isLoadingSessionMeta={isLoadingSessionMeta || isFetchingSessionMeta}
          sessionMetaError={sessionMetaError}
          isLoadingTranscript={isLoadingTranscript}
          transcriptError={transcriptError}
          ollamaStatus={ollamaStatus}
          isLoadingOllamaStatus={isLoadingOllamaStatus}
          onOpenLlmModal={handleOpenConfigureLlmModal}
          transcriptTokenCount={transcriptTokenCount}
          activeModelDefaultContextSize={activeModelDefaultContextSize}
        />
      </Box>

      <EditDetailsModal
        isOpen={isEditingMetadata}
        onOpenChange={setIsEditingMetadata}
        session={sessionMetadata}
        onSaveSuccess={handleMetadataSaveSuccess}
      />

      <SelectActiveModelModal
        isOpen={isSelectModelModalOpen}
        onOpenChange={setIsSelectModelModalOpen}
        onModelSuccessfullySet={handleModelSuccessfullySet}
        currentActiveModelName={ollamaStatus?.activeModel}
        currentConfiguredContextSize={ollamaStatus?.configuredContextSize}
        activeTranscriptTokens={transcriptTokenCount}
        ollamaStatus={ollamaStatus}
      />
    </Flex>
  );
}
