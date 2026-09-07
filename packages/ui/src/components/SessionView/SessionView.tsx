// packages/ui/src/components/SessionView/SessionView.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
} from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Flex,
  Box,
  Button,
  IconButton,
  Text,
  Spinner,
  Tooltip,
} from '@radix-ui/themes';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@radix-ui/react-icons';
import { SessionContent } from './SessionContent';
import { AppTooltip } from '../Shared/AppTooltip';
import { SelectActiveModelModal } from './Modals/SelectActiveModelModal';
import {
  fetchSession,
  fetchSessions,
  fetchTranscript,
  startSessionChat,
  fetchSessionChatDetails,
  fetchLlmStatus,
} from '../../api/api';
import {
  resolveSessionOrder,
  getSessionNeighbors,
  type SessionNeighbor,
} from '../../utils/sortSessions';
import type {
  Session,
  SessionMetadata,
  ChatSession,
  StructuredTranscript,
  LlmStatus,
} from '../../types';
import {
  activeSessionIdAtom,
  activeChatIdAtom,
  sessionSortCriteriaAtom,
  sessionSortDirectionAtom,
  toastMessageAtom,
  sidebarWidthAtom,
  clampedSidebarWidthAtom,
  isPersistentSidebarOpenAtom,
} from '../../store';
import { SessionSidebar } from './Sidebar/SessionSidebar';

/**
 * Prev/next session button with a Radix tooltip naming the target session.
 * The span wrapper keeps the tooltip working while the button is disabled
 * (disabled buttons don't emit pointer events, so Radix would never open
 * the tooltip on them directly).
 */
function SessionNavButton({
  direction,
  neighbor,
  onNavigate,
}: {
  direction: 'prev' | 'next';
  neighbor: SessionNeighbor;
  onNavigate: (sessionId: number) => void;
}) {
  const isPrev = direction === 'prev';
  const Icon = isPrev ? ChevronLeftIcon : ChevronRightIcon;
  const label = isPrev ? 'Previous session' : 'Next session';
  const tooltipContent = neighbor.id
    ? neighbor.name
      ? `${label}: ${neighbor.name}`
      : label
    : isPrev
      ? 'No previous session'
      : 'No next session';
  return (
    <Tooltip content={tooltipContent}>
      <span style={{ display: 'inline-flex' }}>
        <IconButton
          variant="ghost"
          color="gray"
          size="1"
          aria-label={
            neighbor.id && neighbor.name
              ? `${label}: ${neighbor.name}`
              : tooltipContent
          }
          data-testid={`session-${direction}-button`}
          disabled={!neighbor.id}
          onClick={() => {
            if (neighbor.id) onNavigate(neighbor.id);
          }}
        >
          <Icon />
        </IconButton>
      </span>
    </Tooltip>
  );
}

export function SessionView() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{
    sessionId: string;
    chatId?: string;
  }>();
  const navigate = useNavigate();
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setActiveChatId = useSetAtom(activeChatIdAtom);
  const activeChatIdAtomValue = useAtomValue(activeChatIdAtom);
  const [isSelectModelModalOpen, setIsSelectModelModalOpen] = useState(false);
  const setToast = useSetAtom(toastMessageAtom);

  const previousSessionIdRef = useRef<number | null>(null);
  const queryClient = useQueryClient();

  const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
  const location = useLocation();
  const sortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const sortDirection = useAtomValue(sessionSortDirectionAtom);

  // Full session list (shared cache with the tables) for prev/next order.
  const { data: allSessions } = useQuery<Session[], Error>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    staleTime: 60 * 1000,
  });

  // Ordered session list for prev/next navigation — exact table order
  // when arriving from SessionListTable (via router state), global sort
  // otherwise. See resolveSessionOrder.
  const orderedSessions = useMemo<Session[]>(() => {
    if (!allSessions) return [];
    const state = location.state as { sessionOrder?: unknown } | null;
    return resolveSessionOrder(
      allSessions,
      sessionIdNum,
      state?.sessionOrder,
      sortCriteria,
      sortDirection
    );
  }, [allSessions, location.state, sessionIdNum, sortCriteria, sortDirection]);

  const neighbors = useMemo(
    () => getSessionNeighbors(orderedSessions, sessionIdNum),
    [orderedSessions, sessionIdNum]
  );

  const handleSessionNavigate = useCallback(
    (targetId: number) => {
      // Carry the order forward so repeated prev/next keeps walking the
      // same list instead of falling back to the global sort.
      // Navigating to the bare session route lets the effect below
      // redirect to that session's latest chat automatically.
      navigate(`/sessions/${targetId}`, {
        state: { sessionOrder: orderedSessions.map((s) => s.id) },
      });
    },
    [navigate, orderedSessions]
  );

  // --- Sidebar Resizing Logic ---
  const [isResizing, setIsResizing] = useState(false);
  const setSidebarWidth = useSetAtom(sidebarWidthAtom);
  const clampedSidebarWidth = useAtomValue(clampedSidebarWidthAtom);
  const isPersistentSidebarOpen = useAtomValue(isPersistentSidebarOpenAtom);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    // Remove selection in case user dragged over text
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      // isResizing is captured in the closure
      if (!isResizing) return;
      // Adjust for the main persistent sidebar's width
      const persistentSidebarWidth = isPersistentSidebarOpen ? 256 : 80; // Corresponds to w-64 and w-20
      const newWidth = e.clientX - persistentSidebarWidth;
      setSidebarWidth(newWidth);
    },
    [isResizing, setSidebarWidth, isPersistentSidebarOpen]
  );

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);
  // --- End Sidebar Resizing Logic ---

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
    data: llmStatus,
    isLoading: isLoadingLlmStatus,
    error: llmError,
  } = useQuery<LlmStatus, Error>({
    queryKey: ['llmStatus'],
    queryFn: () => fetchLlmStatus(), // Fetch status for the currently active model
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
      // Refresh session lists so the chat indicator stays accurate
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
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

  const handleOpenConfigureLlmModal = () => setIsSelectModelModalOpen(true);
  const handleNavigateBack = () => navigate('/sessions-list');
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
        style={{ height: '100%', backgroundColor: 'var(--color-panel-solid)' }} // Use 100% instead of 100vh
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
        style={{ height: '100%', backgroundColor: 'var(--color-panel-solid)' }} // Use 100% instead of 100vh
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
  if (llmError) console.error('LLM status check failed:', llmError);

  const displayTitle = sessionMetadata.sessionName || sessionMetadata.fileName;
  const hasChats = sessionMetadata.chats && sessionMetadata.chats.length > 0;
  const currentActiveChatId = chatIdParam
    ? parseInt(chatIdParam, 10)
    : (activeChatIdAtomValue ?? null);

  const transcriptTokenCount = sessionMetadata.transcriptTokenCount;
  const activeModelDefaultContextSize =
    llmStatus?.details?.name === llmStatus?.activeModel
      ? llmStatus?.details?.defaultContextSize
      : null;

  return (
    <>
      <Flex style={{ height: '100%', overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar - for large screens */}
        <Box
          className="hidden lg:flex flex-col"
          style={{
            width: `${clampedSidebarWidth}px`,
            flexShrink: 0,
            height: '100%',
            backgroundColor: 'var(--gray-a2)',
          }}
        >
          <SessionSidebar
            session={sessionMetadata}
            isLoading={isFetchingSessionMeta}
            error={sessionMetaError}
          />
        </Box>

        {/* --- Resizer Handle --- */}
        <div
          onMouseDown={handleMouseDown}
          className="hidden lg:block w-2 h-full cursor-col-resize group relative z-10 -mx-1"
          style={{ flexShrink: 0, backgroundColor: 'transparent' }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[var(--gray-a5)] group-hover:bg-[var(--accent-a9)] group-hover:w-[2px] transition-all duration-150" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-8 rounded-full bg-[var(--accent-a9)] opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        </div>
        {/* --- End Resizer Handle --- */}

        {/* Main Content Area */}
        <Flex
          direction="column"
          style={{
            height: '100%',
            overflow: 'hidden',
            minHeight: 0,
            flexGrow: 1,
          }}
        >
          <Box
            px={{ initial: '4', md: '6' }}
            py="3"
            flexShrink="0"
            style={{
              backgroundColor: 'var(--color-panel-solid)',
              borderBottom: '1px solid var(--gray-a6)',
            }}
          >
            <Flex justify="between" align="center" gap="2">
              <Flex align="center" gap="2" style={{ minWidth: 0, flex: 1 }}>
                <AppTooltip content={displayTitle}>
                  <Text
                    size="2"
                    weight="bold"
                    truncate
                    style={{ flexShrink: 1 }}
                    className="text-gray-800 dark:text-gray-200"
                  >
                    {displayTitle}
                  </Text>
                </AppTooltip>
              </Flex>
              <Flex align="center" gap="1" style={{ flexShrink: 0 }}>
                <SessionNavButton
                  direction="prev"
                  neighbor={neighbors.prev}
                  onNavigate={handleSessionNavigate}
                />
                <SessionNavButton
                  direction="next"
                  neighbor={neighbors.next}
                  onNavigate={handleSessionNavigate}
                />
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
              activeChatId={currentActiveChatId}
              hasChats={hasChats}
              onStartFirstChat={handleStartFirstChat}
              isLoadingSessionMeta={
                isLoadingSessionMeta || isFetchingSessionMeta
              }
              sessionMetaError={sessionMetaError}
              isLoadingTranscript={isLoadingTranscript}
              transcriptError={transcriptError}
              llmStatus={llmStatus}
              isLoadingLlmStatus={isLoadingLlmStatus}
              onOpenLlmModal={handleOpenConfigureLlmModal}
              transcriptTokenCount={transcriptTokenCount}
              activeModelDefaultContextSize={activeModelDefaultContextSize}
            />
          </Box>
        </Flex>
      </Flex>
      <SelectActiveModelModal
        isOpen={isSelectModelModalOpen}
        onOpenChange={setIsSelectModelModalOpen}
        onModelSuccessfullySet={handleModelSuccessfullySet}
        currentActiveModelName={llmStatus?.activeModel}
        currentConfiguredContextSize={llmStatus?.configuredContextSize}
        activeTranscriptTokens={transcriptTokenCount}
        llmStatus={llmStatus}
      />
    </>
  );
}
