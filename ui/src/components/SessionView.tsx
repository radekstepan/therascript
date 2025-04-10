// src/components/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai'; // Fixed import
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../components/UserThemeDropdown';
import { SessionSidebar } from './SessionView/SessionSidebar';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import { fetchSession, startNewChat, updateTranscript } from '../api/api';
import { Session } from '../types'; // Added import
import {
  activeSessionIdAtom,
  activeChatIdAtom,
  chatErrorAtom,
  clampedSidebarWidthAtom,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '../store';

export function SessionView() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
  const navigate = useNavigate();
  const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
  const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setActiveChatId = useSetAtom(activeChatIdAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom); // Fixed to useAtom

  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editTranscriptContent, setEditTranscriptContent] = useState('');

  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  useEffect(() => {
    if (!sessionIdNum) return;

    const loadSession = async () => {
      try {
        setIsLoading(true);
        if (isNaN(sessionIdNum)) {
          navigate('/', { replace: true });
          return;
        }

        const data = await fetchSession(sessionIdNum);
        setSession(data);
        setActiveSessionId(sessionIdNum);
        setChatError('');

        const chats = data.chats || [];
        let targetChatId: number | null = chatIdNum || null;
        if (!targetChatId && chats.length > 0) {
          targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
          navigate(`/sessions/${sessionIdNum}/chats/${targetChatId}`, { replace: true });
        }
        setActiveChatId(targetChatId);

        if (data.transcription !== editTranscriptContent) {
          setEditTranscriptContent(data.transcription || '');
        }
      } catch (err) {
        navigate('/', { replace: true });
      } finally {
        setIsLoading(false);
      }
    };
    loadSession();
  }, [sessionIdNum, chatIdNum, navigate, setActiveSessionId, setActiveChatId, setChatError]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current || !sidebarRef.current) return;
    const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    let newWidth = e.clientX - containerRect.left;
    newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
    setSidebarWidth(newWidth); // Fixed usage
  }, [setSidebarWidth]);

  const handleMouseUp = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [handleMouseMove]);

  useEffect(() => {
    return () => {
      if (isResizing.current) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleStartFirstChat = async () => {
    if (!session) return;
    try {
      const newChat = await startNewChat(session.id);
      setSession((prev: Session | null) => (prev ? { ...prev, chats: [...prev.chats, newChat] } : prev));
      navigate(`/sessions/${session.id}/chats/${newChat.id}`);
    } catch (err) {
      setChatError('Failed to start new chat.');
    }
  };

  const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
  const handleTranscriptContentChange = async (newContent: string) => {
    if (!session) return;
    try {
      const paragraphs = editTranscriptContent.split(/\n\s*\n/).filter((p) => p.trim() !== '');
      const newParagraphs = newContent.split(/\n\s*\n/).filter((p) => p.trim() !== '');
      const changedIndex = paragraphs.findIndex((p, i) => p !== newParagraphs[i]);
      if (changedIndex !== -1) {
        await updateTranscript(session.id, changedIndex, newParagraphs[changedIndex]);
      }
      setEditTranscriptContent(newContent);
      setSession((prev: Session | null) => (prev ? { ...prev, transcription: newContent } : prev));
    } catch (err) {
      setChatError('Failed to update transcript.');
    }
  };
  const handleNavigateBack = () => navigate('/');

  if (isLoading || !sessionIdNum) {
    return (
      <Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
        <Spinner size="3" />
        <Text ml="2" color="gray">Loading session...</Text>
      </Flex>
    );
  }

  if (!session) {
    return <Navigate to="/" replace />;
  }

  const displayTitle = session.sessionName || session.fileName;
  const hasChats = session.chats.length > 0;

  return (
    <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
      <Box
        ref={sidebarRef}
        className="relative flex-shrink-0 hidden lg:flex flex-col"
        style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
      >
        <SessionSidebar />
      </Box>
      <Box className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]" onMouseDown={handleMouseDown} title="Resize sidebar">
        <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
      </Box>
      <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
        <Box
          px={{ initial: '5', md: '7', lg: '8' }}
          py="3"
          flexShrink="0"
          style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}
        >
          <Flex justify="between" align="center">
            <Flex align="center" gap="2" style={{ minWidth: 0 }}>
              <Button onClick={handleNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}>
                <ArrowLeftIcon /> Sessions
              </Button>
              <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
              <Text size="2" weight="bold" truncate title={displayTitle} style={{ flexShrink: 1 }}>
                {displayTitle}
              </Text>
            </Flex>
            <UserThemeDropdown />
          </Flex>
        </Box>
        <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
          <SessionContent
            session={session}
            onEditDetailsClick={handleOpenEditMetadataModal}
            editTranscriptContent={editTranscriptContent}
            onTranscriptContentChange={handleTranscriptContentChange}
            activeChatId={activeChatId}
            hasChats={hasChats}
            onStartFirstChat={handleStartFirstChat}
          />
        </Box>
      </Flex>
      <EditDetailsModal isOpen={isEditingMetadata} onOpenChange={setIsEditingMetadata} session={session} />
    </Flex>
  );
}
