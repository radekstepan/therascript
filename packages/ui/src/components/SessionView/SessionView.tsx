import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { SessionSidebar } from './Sidebar/SessionSidebar';
import { SessionContent } from './SessionContent';
import { EditDetailsModal } from './Modals/EditDetailsModal';
import { LlmManagementModal } from './Modals/LlmManagementModal';
import {
  fetchSession,
  fetchTranscript,
  startSessionChat,
  fetchSessionChatDetails,
  fetchOllamaStatus,
} from '../../api/api';
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
  clampedSidebarWidthAtom,
  sidebarWidthAtom,
} from '../../store';

export function SessionView() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{
    sessionId: string;
    chatId?: string;
  }>();
  const navigate = useNavigate();
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setActiveChatId = useSetAtom(activeChatIdAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const clampedSidebarWidth = useAtomValue(clampedSidebarWidthAtom);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);
  const previousSessionIdRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

  // --- Tanstack Query Hooks ---

  // Fetch Session Metadata
  const {
    data: sessionMetadata,
    isLoading: isLoadingSessionMeta,
    error: sessionMetaError,
    isFetching: isFetchingSessionMeta,
  } = useQuery<Session, Error>({
    queryKey: ['sessionMeta', sessionIdNum],
    queryFn: () => {
      if (!sessionIdNum) return Promise.reject(new Error('Invalid Session ID'));
      console.log(`[SessionView] Fetching sessionMeta for ID: ${sessionIdNum}`);
      return fetchSession(sessionIdNum);
    },
    enabled: !!sessionIdNum,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch Transcript Content
  const {
    data: transcriptContent,
    isLoading: isLoadingTranscript,
    error: transcriptError,
  } = useQuery<StructuredTranscript, Error>({
    queryKey: ['transcript', sessionIdNum],
    queryFn: () => {
      if (!sessionIdNum) return Promise.reject(new Error('Invalid Session ID'));
      console.log(`[SessionView] Fetching transcript for ID: ${sessionIdNum}`);
      return fetchTranscript(sessionIdNum);
    },
    enabled: !!sessionIdNum,
    staleTime: Infinity,
  });

  // Fetch Ollama Status (Default model)
  const {
    data: ollamaStatus,
    isLoading: isLoadingOllamaStatus,
    error: ollamaError,
  } = useQuery<OllamaStatus, Error>({
    queryKey: ['ollamaStatus'],
    queryFn: () => fetchOllamaStatus(), // Call without args for default status
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchInterval: false,
  });

  // Start Chat Mutation
  const startChatMutation = useMutation<ChatSession, Error>({
    // Explicit types
    mutationFn: () => {
      if (!sessionIdNum) throw new Error('Session ID is missing');
      return startSessionChat(sessionIdNum);
    }, // Use correct API
    onSuccess: (newChat) => {
      // Type newChat
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionIdNum],
        (oldData) => {
          if (!oldData) return oldData;
          const existingChats = Array.isArray(oldData.chats)
            ? oldData.chats
            : [];
          const newChatMetadata: ChatSession = {
            id: newChat.id,
            sessionId: newChat.sessionId,
            timestamp: newChat.timestamp,
            name: newChat.name,
            messages: [],
          };
          return { ...oldData, chats: [...existingChats, newChatMetadata] };
        }
      );
      // FIX: Ensure sessionIdNum is not null before using it
      if (sessionIdNum !== null) {
        queryClient.prefetchQuery({
          queryKey: ['chat', sessionIdNum, newChat.id],
          queryFn: () => fetchSessionChatDetails(sessionIdNum!, newChat.id), // Assert non-null
        });
        navigate(`/sessions/${sessionIdNum}/chats/${newChat.id}`);
      } else {
        console.error('Cannot prefetch or navigate: sessionIdNum is null');
      }
    },
    onError: (error) => {
      console.error(
        'Failed to start new chat:',
        error
      ); /* TODO: add user feedback */
    },
  });

  // Resizing Logic (unchanged)
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

  // --- Effects ---

  // Effect to set active Session/Chat ID
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
      if (targetChatId !== activeChatId) {
        console.log(
          `[SessionView Effect] Setting activeChatId to ${targetChatId} (was ${activeChatId})`
        );
        setActiveChatId(targetChatId);
      }
      if (shouldNavigate && navigateTo) {
        console.log(`[SessionView Effect] Navigating to ${navigateTo}`);
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
    activeChatId,
    navigate,
    setActiveSessionId,
    setActiveChatId,
  ]);

  // Cleanup Resizer Listeners (unchanged)
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

  const handleStartFirstChat = useCallback(async () => {
    if (startChatMutation.isPending) return;
    startChatMutation.mutate();
  }, [startChatMutation]);
  const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
  const handleOpenLlmModal = () => setIsLlmModalOpen(true);
  const handleNavigateBack = () => navigate('/');
  const handleMetadataSaveSuccess = (
    updatedMetadata: Partial<SessionMetadata>
  ) => {
    console.log(
      '[SessionView] Metadata save successful (via callback):',
      updatedMetadata
    );
  };

  // --- Render Logic ---
  if (isLoadingSessionMeta && !sessionMetadata) {
    return (
      <Flex
        justify="center"
        align="center"
        style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}
      >
        <Spinner size="3" />
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
        style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}
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
  if (ollamaError) {
    console.error(
      'Ollama status check failed:',
      ollamaError
    ); /* TODO: Maybe show a non-blocking warning */
  }

  const displayTitle = sessionMetadata.sessionName || sessionMetadata.fileName;
  const hasChats = sessionMetadata.chats && sessionMetadata.chats.length > 0;
  // Use the ID derived from URL param first, then fallback to atom value
  const currentActiveChatId = chatIdParam
    ? parseInt(chatIdParam, 10)
    : (activeChatId ?? null);

  return (
    <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box
        ref={sidebarRef}
        className="relative flex-shrink-0 hidden lg:flex flex-col"
        style={{
          width: `${clampedSidebarWidth}px`,
          backgroundColor: 'var(--color-panel-solid)',
          borderRight: '1px solid var(--gray-a6)',
        }}
      >
        <SessionSidebar
          session={sessionMetadata ?? null}
          isLoading={isLoadingSessionMeta || isFetchingSessionMeta}
          error={sessionMetaError ?? null}
        />
      </Box>

      {/* Resizer */}
      <Box
        className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
        onMouseDown={handleMouseDown}
        title="Resize sidebar"
      >
        <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
      </Box>

      {/* Main Content Area */}
      <Flex
        direction="column"
        flexGrow="1"
        style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}
      >
        {/* Header */}
        <Box
          px={{ initial: '5', md: '7', lg: '8' }}
          py="3"
          flexShrink="0"
          style={{
            backgroundColor: 'var(--color-panel-solid)',
            borderBottom: '1px solid var(--gray-a6)',
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
                <ArrowLeftIcon /> Sessions
              </Button>
              <Text color="gray" size="2" style={{ flexShrink: 0 }}>
                {' '}
                /{' '}
              </Text>
              <Text
                size="2"
                weight="bold"
                truncate
                title={displayTitle}
                style={{ flexShrink: 1 }}
              >
                {displayTitle}
              </Text>
            </Flex>
            <UserThemeDropdown />
          </Flex>
        </Box>
        {/* Content Body */}
        <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
          <SessionContent
            session={sessionMetadata}
            transcriptContent={transcriptContent}
            onEditDetailsClick={handleOpenEditMetadataModal}
            activeChatId={currentActiveChatId} // Pass derived activeChatId
            hasChats={hasChats}
            onStartFirstChat={handleStartFirstChat}
            isLoadingSessionMeta={isLoadingSessionMeta || isFetchingSessionMeta}
            sessionMetaError={sessionMetaError}
            isLoadingTranscript={isLoadingTranscript}
            transcriptError={transcriptError}
            // --- Pass LLM props down ---
            ollamaStatus={ollamaStatus}
            isLoadingOllamaStatus={isLoadingOllamaStatus}
            onOpenLlmModal={handleOpenLlmModal}
            // --- End LLM props ---
          />
        </Box>
      </Flex>
      {/* Edit Metadata Modal */}
      <EditDetailsModal
        isOpen={isEditingMetadata}
        onOpenChange={setIsEditingMetadata}
        session={sessionMetadata}
        onSaveSuccess={handleMetadataSaveSuccess}
      />
      {/* --- LLM Management Modal --- */}
      <LlmManagementModal
        isOpen={isLlmModalOpen}
        onOpenChange={setIsLlmModalOpen}
      />
      {/* --- End LLM Modal --- */}
    </Flex>
  );
}
