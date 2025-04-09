import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { Flex } from '@radix-ui/themes';
import { SessionHeader } from './SessionView/SessionHeader';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    chatErrorAtom,
    saveTranscriptAtom,
    startNewChatAtom,
} from '../store';

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    const allSessions = useAtomValue(pastSessionsAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const session = useAtomValue(activeSessionAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const saveTranscriptAction = useSetAtom(saveTranscriptAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);

    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(true);
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : NaN;

        if (isNaN(currentSessionIdNum)) { navigate('/', { replace: true }); return; }
        const sessionFromParam = allSessions.find((s) => s.id === currentSessionIdNum);
        if (!sessionFromParam) { navigate('/', { replace: true }); return; }

        setActiveSessionId(currentSessionIdNum);

        let targetChatId = NaN;
        const chats = Array.isArray(sessionFromParam.chats) ? sessionFromParam.chats : [];
        if (!isNaN(currentChatIdNum)) {
            if (chats.some((c) => c.id === currentChatIdNum)) {
                targetChatId = currentChatIdNum;
            } else {
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
        }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError('');
        setIsLoading(false);
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname]);

    useEffect(() => {
        if (session) {
            setEditTranscriptContent(session.transcription || '');
        }
    }, [session]);

    const handleStartFirstChat = async () => {
        if (!session) return;
        const currentSessionId = session.id;
        const result = await startNewChatAction({ sessionId: currentSessionId });
        if (result.success) {
            navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
        } else {
            setChatError(result.error);
        }
    };

    const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
    const handleTranscriptContentChange = (newContent: string) => {
        if (!session) return;
        saveTranscriptAction({ sessionId: session.id, transcript: newContent });
        setEditTranscriptContent(newContent);
    };
    const handleNavigateBack = () => navigate('/');

    if (isLoading || !session) {
        return <Navigate to="/" replace />;
    }

    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    return (
        <Flex direction="column" style={{ height: '100vh' }}>
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
        </Flex>
    );
}
