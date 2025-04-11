// src/components/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { SessionSidebar } from './SessionSidebar';
import { SessionContent } from './SessionContent';
import { EditDetailsModal } from './EditDetailsModal';
import { fetchSession, fetchTranscript, startNewChat, updateTranscriptParagraph, fetchChatDetails } from '../../api/api';
import type { Session, ChatSession, SessionMetadata } from '../../types';
import {
    activeSessionIdAtom,
    activeChatIdAtom,
    chatErrorAtom,
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    pastSessionsAtom,
    activeSessionAtom,
} from '../../store';

export function SessionView() {
    // --- HOOKS (ALL AT THE TOP) ---
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const currentGlobalSession = useAtomValue(activeSessionAtom);
    const currentError = useAtomValue(chatErrorAtom);
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const [localSession, setLocalSession] = useState<Session | null>(null);
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const sidebarRef = useRef<HTMLDivElement>(null);
    const isResizing = useRef(false);
    const previousSessionIdRef = useRef<number | null>(null);
    const currentChatLoadIdRef = useRef<number | null>(null);

    // --- Computed Values ---
    const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

    // --- CALLBACKS (Define before effects that use them) ---

    // Resizing Logic Callbacks
    // Define handleMouseMove and handleMouseUp *before* the effect that uses them for cleanup
     const handleMouseMove = useCallback((e: MouseEvent) => {
         if (!isResizing.current || !sidebarRef.current) return;
         const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
         if (!containerRect) return;
         let newWidth = e.clientX - containerRect.left;
         newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
         setSidebarWidth(newWidth); // Use the setter from useAtom
     }, [setSidebarWidth]); // Dependency on the setter function

     const handleMouseUp = useCallback(() => {
         if (isResizing.current) {
             isResizing.current = false;
             document.body.style.cursor = '';
             document.body.style.userSelect = '';
             // Pass the memoized handlers to removeEventListener
             document.removeEventListener('mousemove', handleMouseMove);
             document.removeEventListener('mouseup', handleMouseUp); // Pass itself
         }
     // IMPORTANT: Add handleMouseMove as a dependency here because it's used inside removeEventListener
     }, [handleMouseMove]);

     const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
         e.preventDefault();
         isResizing.current = true;
         document.body.style.cursor = 'col-resize';
         document.body.style.userSelect = 'none';
         // Pass memoized handlers to addEventListener
         document.addEventListener('mousemove', handleMouseMove);
         document.addEventListener('mouseup', handleMouseUp);
     // Add handleMouseMove and handleMouseUp as dependencies
     }, [handleMouseMove, handleMouseUp]);

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
            setIsLoadingSession(true); setLocalSession(null); setEditTranscriptContent('');
            setActiveChatId(null); currentChatLoadIdRef.current = null;
            try {
                const [sessionBaseData, transcriptContent] = await Promise.all([ fetchSession(currentSessionIdNum), fetchTranscript(currentSessionIdNum) ]);
                const initialChats = (Array.isArray(sessionBaseData.chats) ? sessionBaseData.chats : []).map(chat => ({ ...chat, messages: chat.messages || undefined }));
                const fullSession: Session = { ...sessionBaseData, transcription: transcriptContent, chats: initialChats, };
                // console.log(`[Effect 1] Constructed fullSession for ${currentSessionIdNum}:`, { /* ... */ });
                setLocalSession(fullSession); setEditTranscriptContent(fullSession.transcription || '');
                setActiveSessionId(currentSessionIdNum); setChatError('');
                setPastSessions(prevSessions => { /* ... update or add ... */
                    const sessionExists = prevSessions.some(s => s.id === currentSessionIdNum);
                    if (sessionExists) { return prevSessions.map(s => s.id === currentSessionIdNum ? fullSession : s); }
                    else { return [fullSession, ...prevSessions]; }
                 });
                const chats = fullSession.chats || []; let targetChatId: number | null = null; let shouldNavigate = false; let navigateTo: string | null = null;
                const urlChatId = chatIdParam ? parseInt(chatIdParam, 10) : null; const chatExistsInSession = urlChatId !== null && !isNaN(urlChatId) && chats.some(c => c.id === urlChatId);
                if (chatExistsInSession && urlChatId !== null) { targetChatId = urlChatId; }
                else if (chats.length > 0) { const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp); targetChatId = sortedChats[0].id; if (String(urlChatId) !== String(targetChatId)) { shouldNavigate = true; navigateTo = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`; } }
                else { if (chatIdParam) { shouldNavigate = true; navigateTo = `/sessions/${currentSessionIdNum}`; } }
                setActiveChatId(targetChatId);
                if (shouldNavigate && navigateTo) { navigate(navigateTo, { replace: true }); }
            } catch (err) { console.error(`[Effect 1] Error loading session ${currentSessionIdNum}:`, err); setChatError("Failed to load session data."); setLocalSession(null); setIsLoadingSession(false); }
            finally { setIsLoadingSession(false); }
        };
        loadSessionCoreData();
    }, [sessionIdParam, chatIdParam, navigate, setActiveSessionId, setActiveChatId, setChatError, setPastSessions]);

    // Effect 2: Load Chat Messages
    useEffect(() => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        // console.log(`[Effect 2] Running: activeChatId=${activeChatId}, ...`);
        if (!localSession || !currentSessionIdNum || activeChatId === null) { currentChatLoadIdRef.current = null; return; }
        if (currentChatLoadIdRef.current === activeChatId) { return; }
        const currentChat = localSession.chats?.find(c => c.id === activeChatId);
        if (currentChat?.messages !== undefined) { currentChatLoadIdRef.current = activeChatId; setIsLoadingChat(false); return; }
        if (currentChat) {
            const loadChatMessages = async () => {
                // console.log(`[Effect 2] Fetching messages chat ${activeChatId}...`);
                currentChatLoadIdRef.current = activeChatId; setIsLoadingChat(true); setChatError('');
                try {
                    const detailedChatData = await fetchChatDetails(currentSessionIdNum, activeChatId);
                    const chatWithMessages: ChatSession = { ...detailedChatData, messages: detailedChatData.messages || [], };

                    // ** FIX TS2345: Return the new state in functional updates **
                    setLocalSession(prevSession => {
                        if (!prevSession) return null; // Handle null case
                        return { ...prevSession, chats: (prevSession.chats || []).map(chat => chat.id === activeChatId ? chatWithMessages : chat) };
                    });
                    setPastSessions(prevGlobalSessions => {
                        return prevGlobalSessions.map(session => {
                            if (session.id === currentSessionIdNum) {
                                return { ...session, chats: (session.chats || []).map(chat => chat.id === activeChatId ? chatWithMessages : chat) };
                            }
                            return session;
                        })
                    });
                    // console.log(`[Effect 2] Success fetch messages chat ${activeChatId}.`);
                } catch (err) {
                    console.error(`[Effect 2] Failed load messages chat ${activeChatId}:`, err);
                    setChatError(`Failed load messages chat ${activeChatId}.`);
                    // ** FIX TS2345: Return the new state in functional updates **
                     setLocalSession(prevSession => {
                         if (!prevSession) return null; // Handle null case
                         // Return session with chat marked as attempted (empty messages)
                         return { ...prevSession, chats: (prevSession.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) };
                     });
                     setPastSessions(prevGlobalSessions => {
                        return prevGlobalSessions.map(session => {
                            if (session.id === currentSessionIdNum) {
                                // Return session with chat marked as attempted (empty messages)
                                return { ...session, chats: (session.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) };
                            }
                            return session;
                        })
                    });
                } finally { if (currentChatLoadIdRef.current === activeChatId) { setIsLoadingChat(false); } }
            };
            loadChatMessages();
        } else { /* ... warn, reset loading ... */ }
    }, [activeChatId, localSession, setChatError, setPastSessions, setActiveChatId, sessionIdParam]);

    // Effect 3: Cleanup for Resize Listeners
    // Now defined *after* handleMouseMove and handleMouseUp
    useEffect(() => {
        // Return the cleanup function
        return () => {
            // Check if resizing was in progress when component unmounts
            if (isResizing.current) {
                 console.log("[SessionView] Cleanup: Removing resize listeners.");
                // Use the memoized callbacks for removal
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                // Reset cursor and selection styles
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                // Reset resizing flag just in case
                isResizing.current = false;
            }
        };
    // Depend on the memoized handlers
    }, [handleMouseMove, handleMouseUp]);


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
     const handleTranscriptContentChange = (newContent: string) => setEditTranscriptContent(newContent);
     const handleSaveTranscriptParagraph = async (index: number, text: string) => {
         const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
         if (!localSession || !currentSessionIdNum) return;
         try {
             const updatedFullTranscript = await updateTranscriptParagraph(currentSessionIdNum, index, text);
             const updatedSession: Session = { ...localSession, transcription: updatedFullTranscript };
             setLocalSession(updatedSession); setEditTranscriptContent(updatedFullTranscript);
             setPastSessions(prevSessions => prevSessions.map(s => s.id === currentSessionIdNum ? updatedSession : s));
         } catch (err) { console.error(`Failed save paragraph ${index}:`, err); setChatError('Failed update transcript paragraph.'); }
     };
     const handleNavigateBack = () => navigate('/');

    // Handler for successful metadata save (Optimistic Update)
    const handleMetadataSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        if (!currentSessionIdNum) return;
        // console.log("[SessionView] handleMetadataSaveSuccess called:", updatedMetadata);
        setLocalSession(prevSession => {
            if (!prevSession) return null;
            const newLocalSession: Session = { ...prevSession, ...updatedMetadata };
            // console.log("[SessionView] Optimistically updated localSession:", newLocalSession);
            return newLocalSession;
        });
        setPastSessions(prevGlobalSessions => {
            // console.log("[SessionView] Optimistically updating pastSessions atom...");
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
                        editTranscriptContent={editTranscriptContent}
                        onTranscriptContentChange={handleTranscriptContentChange}
                        onSaveTranscriptParagraph={handleSaveTranscriptParagraph}
                        activeChatId={activeChatId}
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                        isLoadingChat={isLoadingChat}
                    />
                </Box>
            </Flex>
            {/* Edit Modal - ** FIX TS2741: Pass the onSaveSuccess prop ** */}
            <EditDetailsModal
                isOpen={isEditingMetadata}
                onOpenChange={setIsEditingMetadata}
                session={localSession}
                onSaveSuccess={handleMetadataSaveSuccess} // Pass the callback here
             />
        </Flex>
    );
}
