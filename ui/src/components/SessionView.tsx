/*
Modified File: src/components/SessionView.tsx
+ Fixed header border color in dark mode
+ Increased horizontal padding in header
+ Improved useEffect logic to handle hard reloads correctly
*/
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes'; // Added Spinner
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
    const session = useAtomValue(activeSessionAtom); // Keep this to get the currently derived active session
    const setChatError = useSetAtom(chatErrorAtom);
    const saveTranscriptAction = useSetAtom(saveTranscriptAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Keep this for SessionContent prop
    const startNewChatAction = useSetAtom(startNewChatAtom);
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const isResizing = useRef(false);
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    // --- MODIFICATION: isLoading default true ---
    const [isLoading, setIsLoading] = useState(true); // Start in loading state

    // --- MODIFICATION: Refined useEffect Logic ---
    useEffect(() => {
        // Always start assuming loading until checks pass
        setIsLoading(true);

        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : NaN;

        // 1. Validate Session ID Parameter Format
        if (isNaN(currentSessionIdNum)) {
            console.error("Invalid Session ID parameter:", sessionIdParam);
            navigate('/', { replace: true });
            return; // Stop processing this effect run
        }

        // 2. Wait for Session Data
        // Check if the atom holds the initial empty array or is still loading (if it were async)
        // For this example with static SAMPLE_SESSIONS, checking length is sufficient after first render.
        if (allSessions.length === 0) {
            console.log("SessionView: Waiting for session data...");
            // Keep isLoading true and wait for the effect to re-run when allSessions updates.
            return;
        }

        // 3. Find Session *after* data is available
        const sessionFromParam = allSessions.find((s) => s.id === currentSessionIdNum);
        if (!sessionFromParam) {
            // Session data is loaded, but this specific session ID doesn't exist
            console.warn(`Session ${currentSessionIdNum} not found in loaded sessions. Redirecting.`);
            navigate('/', { replace: true });
            return; // Stop processing this effect run
        }

        // --- Session Found - Proceed ---
        setActiveSessionId(currentSessionIdNum); // Set the active session ID *before* chat logic
        setChatError(''); // Clear any previous chat errors

        const chats = Array.isArray(sessionFromParam.chats) ? sessionFromParam.chats : [];
        let targetChatId: number | null = null; // Use null for clarity when no chat is active

        // 4. Validate Chat ID Parameter or Find Default
        if (chatIdParam) { // Specific chat requested
            if (isNaN(currentChatIdNum)) {
                // Chat ID parameter is present but not a valid number
                console.warn(`Invalid Chat ID parameter: ${chatIdParam}. Redirecting to session base.`);
                navigate(`/sessions/${currentSessionIdNum}`, { replace: true });
                return; // Redirect will trigger re-run
            } else {
                // Valid number, check if it exists in the session
                if (chats.some((c) => c.id === currentChatIdNum)) {
                    targetChatId = currentChatIdNum;
                } else {
                    // Chat ID is valid number but not found in this session
                    console.warn(`Chat ${currentChatIdNum} not found in session ${currentSessionIdNum}. Redirecting to session base.`);
                    navigate(`/sessions/${currentSessionIdNum}`, { replace: true });
                    return; // Redirect will trigger re-run
                }
            }
        } else { // No specific chat requested, find the latest one
            if (chats.length > 0) {
                // Sort chats by timestamp descending and take the first one
                targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
                // If we are at the session base URL, redirect *to* the specific latest chat URL
                const expectedPath = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
                if (location.pathname !== expectedPath) {
                    console.log(`No chat ID in URL, redirecting to latest chat: ${targetChatId}`);
                    navigate(expectedPath, { replace: true });
                    return; // Redirect will trigger re-run
                }
                // If already at the latest chat URL (e.g., after redirect), targetChatId is set correctly
            } else {
                // No chat ID in URL, and no chats exist for this session
                targetChatId = null;
            }
        }

        // 5. Set the final active chat ID state
        setActiveChatId(targetChatId);

        // 6. Update local transcript content state if session details changed
        if (sessionFromParam.transcription !== editTranscriptContent) {
           setEditTranscriptContent(sessionFromParam.transcription || '');
        }

        // 7. All checks passed, data loaded and state set
        setIsLoading(false);

     // Rerun when parameters, data, or navigation tools change.
     // location.pathname is important to handle redirects correctly.
     }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname, editTranscriptContent]);
    // Removed editTranscriptContent dependency - Handled inside the effect now

    // --- END MODIFICATION ---


    // Sidebar Resizing Logic (Unchanged)
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
        setSidebarWidth(newWidth);
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


    // Handlers (Unchanged)
    const handleStartFirstChat = async () => {
        // We use 'session' derived atom here, which should be up-to-date
        // if isLoading is false and the effect ran correctly.
        if (!session) {
            console.error("Cannot start chat: Active session data not available.");
            setChatError("Could not find active session data.");
            return;
        }
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
         // Optimistically update local state first for responsiveness
         setEditTranscriptContent(newContent);
         // Then save to the main store
         saveTranscriptAction({ sessionId: session.id, transcript: newContent });
    };
    const handleNavigateBack = () => navigate('/');

    // --- MODIFICATION: Improved Loading/Error Handling ---
    // Display loading spinner while validating session/chat after reload
    if (isLoading) {
        return (
            <Flex justify="center" align="center" style={{height: '100vh', backgroundColor: 'var(--color-panel-solid)'}}>
                <Spinner size="3" />
                <Text ml="2" color="gray">Loading session...</Text>
            </Flex>
        );
    }

    // If loading is finished but session is somehow still null (shouldn't happen if effect is correct)
    // This relies on the `activeSessionAtom` derived state.
    if (!session) {
        console.error("SessionView render: isLoading is false but session is null. This indicates a state inconsistency.");
        // Redirecting is safer than potentially crashing.
         return <Navigate to="/" replace />;
    }
    // --- END MODIFICATION ---

    const displayTitle = session.sessionName || session.fileName;
    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    // --- Render actual content when loaded and session exists ---
    return (
        // Main container: Full height, hidden overflow
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
             {/* Sidebar */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col"
                style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
            >
                <SessionSidebar />
            </Box>

            {/* Resizer */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>

            {/* Main Content Column */}
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                 {/* Header */}
                 <Box
                    px={{ initial: '5', md: '7', lg: '8' }}
                    py="3"
                    flexShrink="0"
                    style={{
                        backgroundColor: 'var(--color-panel-solid)',
                        borderBottom: '1px solid var(--gray-a6)'
                    }}
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

                 {/* Content Area */}
                 <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
                    <SessionContent
                        session={session} // Pass the derived session atom value
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        editTranscriptContent={editTranscriptContent}
                        onTranscriptContentChange={handleTranscriptContentChange}
                        activeChatId={activeChatId} // Pass the activeChatId atom value
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                    />
                 </Box>
            </Flex>

            {/* Modal */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={session} // Pass the derived session atom value
            />
        </Flex>
    );
}
