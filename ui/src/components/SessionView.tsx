/*
Modified File: src/components/SessionView.tsx
*/
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { Flex, Box, Button, Text } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../components/UserThemeDropdown';
import { SessionSidebar } from './SessionView/SessionSidebar';
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
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
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
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const isResizing = useRef(false);
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // useEffects for loading/navigation (remain the same)
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
    useEffect(() => { if (session) setEditTranscriptContent(session.transcription || ''); }, [session]);

    // Sidebar Resizing Logic (remain the same)
    // Dummy implementations for unchanged callbacks
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
     }, []); // Assuming handleMouseMove/Up are stable refs or defined outside

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        setSidebarWidth(newWidth);
    }, [setSidebarWidth]); // Depends on setSidebarWidth

    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
    }, [handleMouseMove]); // Depends on handleMouseMove

    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);


    // Handlers (remain the same)
    // Dummy implementations for unchanged callbacks
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

    const displayTitle = session.sessionName || session.fileName;
    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    return (
        // Main container: Full height, hidden overflow
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
             {/* Sidebar (Unchanged) */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col"
                style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
            >
                <SessionSidebar />
            </Box>

            {/* Resizer (Unchanged) */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>

            {/* Main Content Column */}
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}> {/* Ensure column takes full height and hides overflow */}
                 {/* Header (Unchanged) */}
                 <Box
                    px={{ initial: '4', md: '6', lg: '8' }}
                    py="3"
                    flexShrink="0"
                    className="border-b"
                    style={{ backgroundColor: 'var(--color-panel-solid)'}}
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

                 {/* *** MODIFICATION HERE *** */}
                 {/* Content Area: Takes remaining space, NO overflowY, minimum height 0 */}
                 {/* This Box defines the height constraint for SessionContent */}
                 <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}> {/* REMOVED overflowY: 'auto' */}
                    <SessionContent // SessionContent itself should fill this Box (e.g., using height: 100%)
                        session={session}
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        editTranscriptContent={editTranscriptContent}
                        onTranscriptContentChange={handleTranscriptContentChange}
                        activeChatId={activeChatId}
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                    />
                 </Box>
                 {/* *** END MODIFICATION *** */}
            </Flex>

            {/* Modal (Unchanged) */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={session}
            />
        </Flex>
    );
}
