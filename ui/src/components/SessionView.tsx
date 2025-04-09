import React, { useEffect, useState, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// Radix Themes & Icons
import { Card, Button, Flex, Text, Spinner } from '@radix-ui/themes'; // Use Themes components for loading state
import { ReloadIcon } from '@radix-ui/react-icons'; // Keep ReloadIcon

// App Sub-components
import { SessionHeader } from './SessionView/SessionHeader';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';

// Constants, Types
// import { SESSION_TYPES, THERAPY_TYPES } from '../constants'; // Path corrected - Not needed here anymore
import type { Session, ChatSession } from '../types'; // Path corrected
import { cn } from '../utils'; // Path corrected

// Atoms
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    chatErrorAtom,
    updateSessionMetadataAtom,
    saveTranscriptAtom,
    startNewChatAtom,
} from '../store'; // Path corrected

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    // Atoms
    const allSessions = useAtomValue(pastSessionsAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const session = useAtomValue(activeSessionAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    // const updateMetadataAction = useSetAtom(updateSessionMetadataAtom); // Action called within Modal
    const saveTranscriptAction = useSetAtom(saveTranscriptAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);

    // --- State ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // --- Effect to Sync Session ID and Chat ID --- (Keep logic)
    useEffect(() => {
        setIsLoading(true);
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : NaN;

        if (isNaN(currentSessionIdNum)) { navigate('/', { replace: true }); return; }
        const sessionFromParam = allSessions.find((s: Session) => s.id === currentSessionIdNum);
        if (!sessionFromParam) { navigate('/', { replace: true }); return; }

        setActiveSessionId(currentSessionIdNum);

        let targetChatId = NaN;
        const chats = Array.isArray(sessionFromParam.chats) ? sessionFromParam.chats : [];
        if (!isNaN(currentChatIdNum)) {
            if (chats.some((c: ChatSession) => c.id === currentChatIdNum)) {
                targetChatId = currentChatIdNum;
            } else {
                console.warn(`Chat ID ${currentChatIdNum} not found, defaulting.`);
                navigate(`/sessions/${currentSessionIdNum}`, { replace: true });
                targetChatId = NaN;
            }
        }

        if (isNaN(targetChatId) && chats.length > 0) {
            targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
            const expectedPath = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
             if (location.pathname !== expectedPath) {
                navigate(expectedPath, { replace: true });
             }
        } else if (isNaN(targetChatId)) {
             targetChatId = NaN;
        }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError('');
        setIsLoading(false);
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname]);

    // --- Effect to Initialize Transcript State --- (Keep logic)
    useEffect(() => {
        if (session) {
            setEditTranscriptContent(session.transcription || '');
        }
    }, [session]);


    // --- Handlers ---
    const handleStartFirstChat = async () => {
        if (!session) return;
        const currentSessionId = session.id;
        const result = await startNewChatAction({ sessionId: currentSessionId });
        if (result.success) {
            navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
        } else {
             setChatError(result.error);
             alert(`Error starting chat: ${result.error}`);
        }
    };

    const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
    // const handleCloseEditMetadataModal = () => setIsEditingMetadata(false); // Handled by Modal's onOpenChange

    const handleTranscriptContentChange = (newContent: string) => {
        if (!session) return;
        saveTranscriptAction({ sessionId: session.id, transcript: newContent });
        setEditTranscriptContent(newContent);
    };

    const handleNavigateBack = () => navigate('/');

    // --- Render Logic ---
    if (isLoading) {
      return (
        <Flex flexGrow="1" align="center" justify="center" p="8">
          <Card size="3">
            <Flex direction="column" align="center" gap="4">
              <Spinner size="3" />
              <Text color="gray">Loading session data...</Text>
              <Button onClick={handleNavigateBack} variant="soft" color="gray" mt="4">Go Back</Button>
            </Flex>
          </Card>
        </Flex>
      );
    }
    if (!session) { return <Navigate to="/" replace />; }

    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    return (
      <div className="flex flex-col flex-grow min-h-0 h-full">
          <SessionHeader
              session={session}
              onEditDetailsClick={handleOpenEditMetadataModal}
              onNavigateBack={handleNavigateBack}
          />
          <SessionContent
                session={session}
                editTranscriptContent={editTranscriptContent}
                onTranscriptContentChange={handleTranscriptContentChange}
                activeChatId={activeChatId}
                hasChats={hasChats}
                onStartFirstChat={handleStartFirstChat}
          />
          <EditDetailsModal
              isOpen={isEditingMetadata}
              onOpenChange={setIsEditingMetadata}
              session={session}
          />
      </div>
    );
}
