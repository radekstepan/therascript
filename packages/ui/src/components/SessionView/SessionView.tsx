import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai'; // Keep for UI state atoms
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { SessionSidebar } from './Sidebar/SessionSidebar';
import { SessionContent } from './SessionContent';
import { EditDetailsModal } from './Modals/EditDetailsModal';
// Import API functions used in this file
import { fetchSession, fetchTranscript, startNewChat, fetchChatDetails } from '../../api/api';
// Import new types
import type { Session, SessionMetadata, ChatSession, StructuredTranscript } from '../../types';
import {
    activeSessionIdAtom,
    activeChatIdAtom,
    clampedSidebarWidthAtom,
    sidebarWidthAtom, // Keep sidebarWidthAtom for the setter
} from '../../store'; // Removed chatErrorAtom, pastSessionsAtom

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Still need to know the current chat ID
    const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom); // Use base atom for setting
    const clampedSidebarWidth = useAtomValue(clampedSidebarWidthAtom); // Read clamped value
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const previousSessionIdRef = useRef<number | null>(null);
    const queryClient = useQueryClient();


    const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

    // --- Tanstack Query Hooks ---

    // Fetch Session Metadata (including chat list without messages)
    const { data: sessionMetadata, isLoading: isLoadingSessionMeta, error: sessionMetaError, isFetching: isFetchingSessionMeta } = useQuery<Session, Error>({
        queryKey: ['sessionMeta', sessionIdNum],
        queryFn: () => {
            if (!sessionIdNum) return Promise.reject(new Error("Invalid Session ID"));
            console.log(`[SessionView] Fetching sessionMeta for ID: ${sessionIdNum}`);
            return fetchSession(sessionIdNum);
        },
        enabled: !!sessionIdNum, // Only fetch if sessionIdNum is valid
        staleTime: 5 * 60 * 1000, // Cache metadata for 5 mins
    });

    // Fetch Transcript Content (now expects StructuredTranscript)
    const { data: transcriptContent, isLoading: isLoadingTranscript, error: transcriptError } = useQuery<StructuredTranscript, Error>({
        queryKey: ['transcript', sessionIdNum],
        queryFn: () => {
            if (!sessionIdNum) return Promise.reject(new Error("Invalid Session ID"));
            console.log(`[SessionView] Fetching transcript for ID: ${sessionIdNum}`);
            return fetchTranscript(sessionIdNum); // fetchTranscript now returns StructuredTranscript
        },
        enabled: !!sessionIdNum, // Only fetch if sessionIdNum is valid
        staleTime: Infinity, // Transcript structure might change via edits, but content less frequent? Revisit if needed.
    });

    // Note: Chat details query (`useQuery(['chat', sessionId, chatId])`) is now inside ChatInterface component

     // --- Mutations ---
     // Moved startChatMutation here to be triggered by StartChatPrompt
     const startChatMutation = useMutation({
        mutationFn: () => {
            if (!sessionIdNum) throw new Error("Session ID is missing");
            return startNewChat(sessionIdNum);
        },
        onSuccess: (newChat) => {
            // Update session meta cache optimistically or invalidate
            queryClient.setQueryData<Session>(['sessionMeta', sessionIdNum], (oldData) => {
                 if (!oldData) return oldData;
                 const existingChats = Array.isArray(oldData.chats) ? oldData.chats : [];
                 // Add only metadata of new chat
                 // Ensure the object added conforms to ChatSession metadata part
                 const newChatMetadata: ChatSession = {
                    id: newChat.id,
                    sessionId: newChat.sessionId, // Use sessionId from newChat response
                    timestamp: newChat.timestamp,
                    name: newChat.name,
                    messages: [] // Start with empty messages
                 };
                 return { ...oldData, chats: [...existingChats, newChatMetadata] };
            });
            // OR invalidate: queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionIdNum] });

            // Pre-fetch the new chat's details
            queryClient.prefetchQuery({
                queryKey: ['chat', sessionIdNum, newChat.id],
                // Use fetchChatDetails with correct IDs from newChat response
                // Explicitly type 'chat' parameter
                queryFn: () => startNewChat(sessionIdNum!).then((chat: ChatSession) => fetchChatDetails(chat.sessionId, chat.id)),
            });

            // Navigate to the new chat immediately
            navigate(`/sessions/${sessionIdNum}/chats/${newChat.id}`);
            // Let useEffect handle setting activeChatId based on navigation
        },
        onError: (error) => {
            console.error("Failed to start new chat:", error);
            // TODO: Show toast or error message
        }
    });

    // --- Resizing Logic ---
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        // Use the setter for the base atom, clamping will happen automatically via derived atom logic if needed elsewhere
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

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove, handleMouseUp]);

    // --- Effects ---

    // Effect to set global active Session ID and determine/set active Chat ID
    useEffect(() => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

        // Validate route param
        if (!currentSessionIdNum || isNaN(currentSessionIdNum)) {
            navigate('/', { replace: true });
            setActiveSessionId(null);
            setActiveChatId(null);
            return;
        }

        // Update global Jotai atom for session ID
        setActiveSessionId(currentSessionIdNum);

        // Logic to determine/set active Chat ID based on URL and session metadata
        const isNewSession = previousSessionIdRef.current !== currentSessionIdNum;

        // Only proceed if session metadata is loaded
        if (sessionMetadata) {
            // Update ref *after* checking sessionMetadata
             if (isNewSession) {
                previousSessionIdRef.current = currentSessionIdNum;
             }

            const chats = sessionMetadata.chats || [];
            let targetChatId: number | null = null;
            let shouldNavigate = false;
            let navigateTo: string | null = null;

            const urlChatId = chatIdParam ? parseInt(chatIdParam, 10) : null;
            const chatExistsInSession = urlChatId !== null && !isNaN(urlChatId) && chats.some(c => c.id === urlChatId);

            if (chatExistsInSession && urlChatId !== null) {
                targetChatId = urlChatId;
                // If the URL chat ID is valid and matches the current Jotai state, do nothing extra
                if (targetChatId === activeChatId) {
                     // console.log(`[SessionView Effect] URL chat ${targetChatId} matches active state.`);
                }
            } else if (chats.length > 0) {
                // No valid chat in URL or URL is missing chat ID, default to newest chat
                const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);
                targetChatId = sortedChats[0].id;
                 // Navigate if URL had no chat ID, or if it had an invalid one
                if (!chatIdParam || !chatExistsInSession) {
                    shouldNavigate = true;
                    navigateTo = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
                }
            } else if (chatIdParam) {
                 // URL has a chat ID, but the session has no chats (e.g., after deleting last chat)
                 // Navigate to the base session URL
                shouldNavigate = true;
                navigateTo = `/sessions/${currentSessionIdNum}`;
            }

            // Update global Jotai atom for chat ID if it's different or needs setting
            if (targetChatId !== activeChatId) {
                 console.log(`[SessionView Effect] Setting activeChatId to ${targetChatId} (was ${activeChatId})`);
                 setActiveChatId(targetChatId);
            }

            // Perform navigation AFTER state updates, if needed
            if (shouldNavigate && navigateTo) {
                console.log(`[SessionView Effect] Navigating to ${navigateTo}`);
                navigate(navigateTo, { replace: true });
            }
        } else {
            // If sessionMetadata is not yet loaded, ensure activeChatId is reset if session changed
            if (isNewSession) {
                 setActiveChatId(null);
                 previousSessionIdRef.current = currentSessionIdNum; // Still update ref here
            }
        }
        // Dependencies: Rerun when route params change or session metadata loads
    }, [sessionIdParam, chatIdParam, sessionMetadata, activeChatId, navigate, setActiveSessionId, setActiveChatId]);


    // Cleanup Resizer Listeners
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

     // Removed: handleSaveTranscriptParagraph - handled by mutation within Transcription component

     const handleNavigateBack = () => navigate('/');

    // Handler for successful metadata save (passed to EditDetailsModal)
    // This function might not be strictly necessary if invalidation handles UI updates sufficiently.
    const handleMetadataSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
        console.log("[SessionView] Metadata save successful (via callback):", updatedMetadata);
        // Optionally perform actions here, but Tanstack Query invalidation
        // in the modal's mutation hook should handle data refresh.
    };


    // --- Render Logic ---
    if (isLoadingSessionMeta && !sessionMetadata) { // Check loading state AND if data is still undefined
         return (<Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Spinner size="3" /><Text ml="2" color="gray">Loading session data...</Text></Flex>);
     }
    if (sessionMetaError || !sessionMetadata) {
         // Handle error state for metadata query
         return (<Flex direction="column" justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Text color="red" mb="4">{sessionMetaError?.message || "Session data could not be loaded."}</Text><Button onClick={handleNavigateBack} variant="soft" color="gray"><ArrowLeftIcon /> Go back to Sessions</Button></Flex>);
     }

    // Data ready for rendering
    const displayTitle = sessionMetadata.sessionName || sessionMetadata.fileName;
    const hasChats = sessionMetadata.chats && sessionMetadata.chats.length > 0;
    const currentActiveChatIdFromParam = chatIdParam ? parseInt(chatIdParam, 10) : null; // Get chat ID from URL for content

    return (
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
            {/* Sidebar - Rendered ONLY for large screens (lg and up) */}
            {/* Use clampedSidebarWidth for reading the width */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col" // Keep hidden, lg:flex
                style={{ width: `${clampedSidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)', borderRight: '1px solid var(--gray-a6)' }}
            >
                {/* Pass props to SessionSidebar, DO NOT hide header */}
                <SessionSidebar
                    session={sessionMetadata ?? null} // Pass data
                    isLoading={isLoadingSessionMeta || isFetchingSessionMeta}   // Pass combined loading state
                    error={sessionMetaError ?? null}   // Pass error state
                    // hideHeader={false} // Default is false, no need to pass explicitly
                />
            </Box>

            {/* Resizer - Rendered ONLY for large screens */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>

            {/* Main Content Area */}
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                {/* Header */}
                <Box px={{ initial: '5', md: '7', lg: '8' }} py="3" flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}>
                    <Flex justify="between" align="center">
                        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                            <Button onClick={handleNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}><ArrowLeftIcon /> Sessions</Button>
                            <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
                            <Text size="2" weight="bold" truncate title={displayTitle} style={{ flexShrink: 1 }}>{displayTitle}</Text>
                        </Flex>
                        <UserThemeDropdown />
                    </Flex>
                </Box>
                {/* Content Body (contains tabs/side-by-side layout) */}
                <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
                    {/* SessionSidebar is now rendered inside SessionContent for small screens */}
                    <SessionContent
                        session={sessionMetadata} // Pass metadata
                        // Pass the structured transcript data
                        transcriptContent={transcriptContent} // Pass transcript content (StructuredTranscript | undefined)
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        // onSaveTranscriptParagraph removed, handled in Transcription
                        activeChatId={currentActiveChatIdFromParam ?? activeChatId} // Use URL param first, then Jotai state
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                        // Pass loading/error for session meta down to SessionContent
                        // so it can pass them to SessionSidebar in the tab view
                        isLoadingSessionMeta={isLoadingSessionMeta || isFetchingSessionMeta}
                        sessionMetaError={sessionMetaError}
                        isLoadingTranscript={isLoadingTranscript} // Pass transcript loading state
                        transcriptError={transcriptError} // Pass transcript error state
                    />
                </Box>
            </Flex>
            {/* Edit Modal */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={sessionMetadata} // Pass session metadata for initial values
                onSaveSuccess={handleMetadataSaveSuccess}
             />
        </Flex>
    );
}
