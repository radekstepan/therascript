// src/components/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom, useAtom } from 'jotai'; // Import useAtom for sidebar width
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
// Import Text component
import { Flex, Box, Button, Text } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons'; // Icon for back button
import { UserThemeDropdown } from '../components/UserThemeDropdown'; // Import dropdown
import { SessionSidebar } from './SessionView/SessionSidebar'; // Import Sidebar
import { SessionContent } from './SessionView/SessionContent'; // Content now holds only panels
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    chatErrorAtom,
    saveTranscriptAtom,
    startNewChatAtom,
    clampedSidebarWidthAtom, // Import sidebar width atom
    MIN_SIDEBAR_WIDTH, // Import constants if needed here for resize logic
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
    // Sidebar Width Logic (moved from SessionContent)
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

    // Sidebar Resizing Logic (moved from SessionContent)
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
     }, []); // Empty dependency array assuming handleMouseMove/Up are stable refs or defined outside

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        // Clamp here directly as well, or rely on atom setter's clamping
        newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        setSidebarWidth(newWidth); // Uses the derived writable atom setter
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

    // Cleanup listeners on component unmount
    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);


    // Handlers (remain the same)
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

    // --- Calculate displayTitle here ---
    const displayTitle = session.sessionName || session.fileName;
    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    return (
        // Main container for the whole Session view (Sidebar + Main)
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
             {/* --- Sidebar --- */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col"
                style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
            >
                {/* Render Sidebar Directly */}
                <SessionSidebar />
            </Box>

            {/* --- Resizer --- */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>

            {/* --- Main Content Column (Header + Panels) --- */}
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                 {/* --- NEW HEADER for Main Panel Area --- */}
                 <Box
                    px={{ initial: '4', md: '6', lg: '8' }} // Consistent padding
                    py="3"
                    flexShrink="0"
                    className="border-b" // Add border below header
                    style={{ backgroundColor: 'var(--color-panel-solid)'}} // Match sidebar bg
                >
                    {/* Outer Flex: Pushes Left (Breadcrumb) and Right (Dropdown) apart */}
                    <Flex justify="between" align="center">
                         {/* --- MODIFICATION START: Left Breadcrumb Section --- */}
                         <Flex align="center" gap="2" style={{ minWidth: 0 }}> {/* Allow shrinking */}
                            {/* Back Button */}
                            <Button onClick={handleNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}> {/* Prevent shrinking */}
                                <ArrowLeftIcon />
                                Sessions
                            </Button>
                            {/* Separator */}
                            <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
                            {/* Current Session Title */}
                            <Text size="2" weight="bold" truncate title={displayTitle} style={{ flexShrink: 1 }}> {/* Allow shrinking and truncation */}
                                {displayTitle}
                            </Text>
                         </Flex>
                         {/* --- MODIFICATION END --- */}

                         {/* User/Theme Dropdown (Stays on the right) */}
                         <UserThemeDropdown />
                    </Flex>
                </Box>
                 {/* --- END NEW HEADER --- */}

                 {/* SessionContent now just renders the panels within the remaining space */}
                 {/* Takes remaining vertical space and allows internal scrolling */}
                 <Box flexGrow="1" style={{ overflowY: 'auto', minHeight: 0 }}>
                    <SessionContent
                        session={session}
                        onEditDetailsClick={handleOpenEditMetadataModal} // Still needs to pass this down
                        editTranscriptContent={editTranscriptContent}
                        onTranscriptContentChange={handleTranscriptContentChange}
                        activeChatId={activeChatId}
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                    />
                 </Box>
            </Flex>

            {/* Modal remains outside the main layout */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={session}
            />
        </Flex>
    );
}
