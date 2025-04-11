import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown'; // Adjusted path (Assuming User folder is sibling to SessionView)
import { SessionSidebar } from './Sidebar/SessionSidebar'; // Adjusted path
import { SessionContent } from './SessionContent'; // Adjusted path
import { EditDetailsModal } from './Modals/EditDetailsModal'; // Adjusted path
import { fetchSession, fetchTranscript, startNewChat, updateTranscriptParagraph, fetchChatDetails } from '../../api/api'; // Adjusted path
import type { Session, ChatSession, SessionMetadata } from '../../types'; // Adjusted path
import {
    activeSessionIdAtom,
    activeChatIdAtom,
    chatErrorAtom,
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    pastSessionsAtom,
    activeSessionAtom,
} from '../../store'; // Adjusted path

export function SessionView() {
    // --- HOOKS ---
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const currentGlobalSession = useAtomValue(activeSessionAtom); // Maybe used for comparison?
    const currentError = useAtomValue(chatErrorAtom);
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const [localSession, setLocalSession] = useState<Session | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    // Note: editTranscriptContent state is removed as Transcription component likely handles its own edit state now.
    const sidebarRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const previousSessionIdRef = useRef<number | null>(null);
    const currentChatLoadIdRef = useRef<number | null>(null);

    // --- Computed Values ---
    const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

    // --- CALLBACKS ---

    // Resizing Logic
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
    }, [handleMouseMove]); // handleMouseMove is a dependency

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [handleMouseMove, handleMouseUp]); // Both handlers are dependencies

    // --- EFFECTS ---

    // Effect 1: Load Session Metadata and Transcript
    useEffect(() => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        if (!currentSessionIdNum || isNaN(currentSessionIdNum)) {
             navigate('/', { replace: true }); return;
        }
        const isNewSession = previousSessionIdRef.current !== currentSessionIdNum;
        previousSessionIdRef.current = currentSessionIdNum;

        const loadSessionCoreData = async () => {
            setIsLoadingSession(true); setLocalSession(null);
            setActiveChatId(null); currentChatLoadIdRef.current = null;
            try {
                const [sessionBaseData, transcriptContent] = await Promise.all([ fetchSession(currentSessionIdNum), fetchTranscript(currentSessionIdNum) ]);
                // Ensure chats array exists and initialize messages as undefined
                const initialChats = (Array.isArray(sessionBaseData.chats) ? sessionBaseData.chats : []).map(chat => ({ ...chat, messages: undefined }));
                const fullSession: Session = { ...sessionBaseData, transcription: transcriptContent, chats: initialChats, };

                setLocalSession(fullSession);
                setActiveSessionId(currentSessionIdNum); setChatError('');
                setPastSessions(prevSessions => {
                    const sessionExists = prevSessions.some(s => s.id === currentSessionIdNum);
                    if (sessionExists) { return prevSessions.map(s => s.id === currentSessionIdNum ? fullSession : s); }
                    else { return [fullSession, ...prevSessions]; }
                 });

                // Determine target chat ID and handle navigation
                const chats = fullSession.chats || []; let targetChatId: number | null = null; let shouldNavigate = false; let navigateTo: string | null = null;
                const urlChatId = chatIdParam ? parseInt(chatIdParam, 10) : null;
                const chatExistsInSession = urlChatId !== null && !isNaN(urlChatId) && chats.some(c => c.id === urlChatId);

                if (chatExistsInSession && urlChatId !== null) { targetChatId = urlChatId; }
                else if (chats.length > 0) { const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp); targetChatId = sortedChats[0].id; if (String(urlChatId) !== String(targetChatId)) { shouldNavigate = true; navigateTo = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`; } }
                else { if (chatIdParam) { shouldNavigate = true; navigateTo = `/sessions/${currentSessionIdNum}`; } }

                setActiveChatId(targetChatId); // Set active chat ID *after* loading session
                if (shouldNavigate && navigateTo) { navigate(navigateTo, { replace: true }); }

            } catch (err) { console.error(`[Effect 1] Error loading session ${currentSessionIdNum}:`, err); setChatError("Failed to load session data."); setLocalSession(null); }
            finally { setIsLoadingSession(false); }
        };
        loadSessionCoreData();
    }, [sessionIdParam, chatIdParam, navigate, setActiveSessionId, setActiveChatId, setChatError, setPastSessions]);

    // Effect 2: Load Chat Messages when activeChatId changes or session loads
    useEffect(() => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        if (!localSession || !currentSessionIdNum || activeChatId === null) {
            currentChatLoadIdRef.current = null; // Reset ref if no chat selected
            return;
        }
        // Avoid re-fetching if already loading this chat or if messages are already present
        if (currentChatLoadIdRef.current === activeChatId) { return; }
        const currentChat = localSession.chats?.find(c => c.id === activeChatId);
        if (currentChat?.messages !== undefined) { // Messages already loaded (could be empty array if fetch failed before)
            currentChatLoadIdRef.current = activeChatId; // Update ref to prevent re-fetch
            setIsLoadingChat(false); // Ensure loading is false
            return;
        }

        // Only proceed if chat exists but messages are 'undefined' (meaning not fetched yet)
        if (currentChat) {
            const loadChatMessages = async () => {
                currentChatLoadIdRef.current = activeChatId; // Mark as loading this chat
                setIsLoadingChat(true); setChatError('');
                try {
                    const detailedChatData = await fetchChatDetails(currentSessionIdNum, activeChatId);
                    const chatWithMessages: ChatSession = { ...detailedChatData, messages: detailedChatData.messages || [], }; // Ensure messages is array

                    // Update local state
                    setLocalSession(prevSession => {
                        if (!prevSession) return null;
                        return { ...prevSession, chats: (prevSession.chats || []).map(chat => chat.id === activeChatId ? chatWithMessages : chat) };
                    });
                    // Update global state
                    setPastSessions(prevGlobalSessions => {
                        return prevGlobalSessions.map(session => {
                            if (session.id === currentSessionIdNum) {
                                return { ...session, chats: (session.chats || []).map(chat => chat.id === activeChatId ? chatWithMessages : chat) };
                            }
                            return session;
                        })
                    });
                } catch (err) {
                    console.error(`[Effect 2] Failed load messages chat ${activeChatId}:`, err);
                    setChatError(`Failed load messages chat ${activeChatId}.`);
                    // Mark chat as attempted fetch (empty array) on error
                    setLocalSession(prevSession => {
                         if (!prevSession) return null;
                         return { ...prevSession, chats: (prevSession.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) };
                     });
                     setPastSessions(prevGlobalSessions => {
                        return prevGlobalSessions.map(session => {
                            if (session.id === currentSessionIdNum) {
                                return { ...session, chats: (session.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) };
                            }
                            return session;
                        })
                    });
                } finally {
                    // Only set loading false if this is the chat we *finished* loading
                    if (currentChatLoadIdRef.current === activeChatId) {
                        setIsLoadingChat(false);
                    }
                }
            };
            loadChatMessages();
        } else {
             // This case (activeChatId set but chat doesn't exist in localSession) should be rare
             console.warn(`[Effect 2] Active chat ID ${activeChatId} not found in local session ${currentSessionIdNum}. Resetting active chat.`);
             setActiveChatId(null);
             currentChatLoadIdRef.current = null;
        }
    // Depend on activeChatId to trigger fetch, localSession for data, and session ID param
    }, [activeChatId, localSession, setChatError, setPastSessions, setActiveChatId, sessionIdParam]);

    // Effect 3: Cleanup for Resize Listeners
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
    }, [handleMouseMove, handleMouseUp]); // Dependencies are the memoized handlers


    // --- EVENT HANDLERS ---
     const handleStartFirstChat = async () => {
         const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
         if (!localSession || !currentSessionIdNum) return; setIsLoadingChat(true);
         try {
             const newChatMetaData = await startNewChat(currentSessionIdNum);
             const newChatFull = await fetchChatDetails(currentSessionIdNum, newChatMetaData.id);
             const chatReadyForState: ChatSession = { ...newChatFull, messages: newChatFull.messages || [], };
             const updatedSession: Session = { ...localSession, chats: [...(localSession.chats || []), chatReadyForState] };
             setLocalSession(updatedSession);
             setPastSessions(prevSessions => prevSessions.map(s => s.id === currentSessionIdNum ? updatedSession : s));
             setActiveChatId(chatReadyForState.id);
             navigate(`/sessions/${currentSessionIdNum}/chats/${chatReadyForState.id}`);
         } catch (err) { console.error("Failed start new chat:", err); setChatError('Failed start new chat.'); }
         finally { setIsLoadingChat(false); }
     };
     const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
     // handleTranscriptContentChange is removed as state is likely local to Transcription now

     const handleSaveTranscriptParagraph = async (index: number, text: string) => {
         const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
         if (!localSession || !currentSessionIdNum) return;
         try {
             const updatedFullTranscript = await updateTranscriptParagraph(currentSessionIdNum, index, text);
             // Update state optimistically (or use the returned transcript)
             const updatedSession: Session = { ...localSession, transcription: updatedFullTranscript };
             setLocalSession(updatedSession);
             // No need to setEditTranscriptContent here anymore
             setPastSessions(prevSessions => prevSessions.map(s => s.id === currentSessionIdNum ? updatedSession : s));
         } catch (err) { console.error(`Failed save paragraph ${index}:`, err); setChatError('Failed update transcript paragraph.'); throw err; /* Re-throw to allow Transcription component to handle UI */ }
     };
     const handleNavigateBack = () => navigate('/');

    // Handler for successful metadata save (called by EditDetailsModal)
    const handleMetadataSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        if (!currentSessionIdNum) return;
        // Optimistically update local state
        setLocalSession(prevSession => {
            if (!prevSession) return null;
            return { ...prevSession, ...updatedMetadata };
        });
        // Optimistically update global state
        setPastSessions(prevGlobalSessions => {
            return prevGlobalSessions.map(session => {
                if (session.id === currentSessionIdNum) { return { ...session, ...updatedMetadata }; }
                return session;
            });
        });
    };


    // --- RENDER LOGIC ---
    if (isLoadingSession) {
         return (<Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Spinner size="3" /><Text ml="2" color="gray">Loading session data...</Text></Flex>);
     }
    if (!localSession) {
         return (<Flex direction="column" justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Text color="red" mb="4">{currentError || "Session data could not be loaded."}</Text><Button onClick={handleNavigateBack} variant="soft" color="gray"><ArrowLeftIcon /> Go back to Sessions</Button></Flex>);
     }

    const displayTitle = localSession.sessionName || localSession.fileName;
    const hasChats = localSession.chats && localSession.chats.length > 0;

    return (
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
            {/* Sidebar */}
            <Box ref={sidebarRef} className="relative flex-shrink-0 hidden lg:flex flex-col" style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}>
                <SessionSidebar />
            </Box>
            {/* Resizer */}
            <Box className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]" onMouseDown={handleMouseDown} title="Resize sidebar">
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>
            {/* Main Content */}
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
                {/* Content Body */}
                <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
                    <SessionContent
                        session={localSession}
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        // editTranscriptContent and onTranscriptContentChange removed
                        onSaveTranscriptParagraph={handleSaveTranscriptParagraph}
                        activeChatId={activeChatId}
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                        isLoadingChat={isLoadingChat} // Pass down chat loading state
                    />
                </Box>
            </Flex>
            {/* Edit Modal */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={localSession}
                onSaveSuccess={handleMetadataSaveSuccess}
             />
        </Flex>
    );
}
