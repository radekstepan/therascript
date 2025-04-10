// src/components/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../components/UserThemeDropdown';
import { SessionSidebar } from './SessionView/SessionSidebar';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import { fetchSession, fetchTranscript, startNewChat, updateTranscriptParagraph, fetchChatDetails } from '../api/api';
import type { Session, ChatSession } from '../types';
import {
    activeSessionIdAtom,
    activeChatIdAtom,
    chatErrorAtom,
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    pastSessionsAtom,
    activeSessionAtom,
} from '../store';

export function SessionView() {
    // --- HOOKS ---
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const setPastSessions = useSetAtom(pastSessionsAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const currentGlobalSession = useAtomValue(activeSessionAtom); // Can be used for checks if needed
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
    // Calculate sessionIdNum here, but use it carefully inside effects if params change
    const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

    // --- EFFECTS ---
    // Effect 1: Load Session Metadata and Transcript
    useEffect(() => {
        // Use sessionIdParam directly for dependency check, derive inside for logic
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
        if (!currentSessionIdNum || isNaN(currentSessionIdNum)) {
             console.log("[SessionView Effect 1] Invalid or missing sessionIdParam, navigating away.");
            navigate('/', { replace: true });
            return;
        }

        const isNewSession = previousSessionIdRef.current !== currentSessionIdNum;
        previousSessionIdRef.current = currentSessionIdNum;

        const loadSessionCoreData = async () => {
            console.log(`[SessionView Effect 1] Starting for session ${currentSessionIdNum}. Is new session: ${isNewSession}`);
            setIsLoadingSession(true);
            setLocalSession(null);
            setEditTranscriptContent('');
            setActiveChatId(null); // Reset active chat ID for the new session
            currentChatLoadIdRef.current = null;

            try {
                console.log(`[SessionView Effect 1] Fetching session base and transcript for ${currentSessionIdNum}`);
                const [sessionBaseData, transcriptContent] = await Promise.all([
                    fetchSession(currentSessionIdNum),
                    fetchTranscript(currentSessionIdNum)
                ]);
                 console.log(`[SessionView Effect 1] Fetched base data for ${currentSessionIdNum}:`, sessionBaseData);
                 console.log(`[SessionView Effect 1] Fetched transcript length for ${currentSessionIdNum}:`, transcriptContent?.length);


                // **Crucial Check:** Ensure chats array exists on base data, initialize properly
                 const initialChats = (Array.isArray(sessionBaseData.chats) ? sessionBaseData.chats : []).map(chat => ({
                    ...chat,
                    messages: chat.messages || undefined // Keep messages undefined initially
                }));
                 console.log(`[SessionView Effect 1] Initial chats array created for ${currentSessionIdNum}:`, initialChats);


                const fullSession: Session = {
                    ...sessionBaseData,
                    transcription: transcriptContent,
                    chats: initialChats, // Use the processed chats array
                };

                // --- LOGGING BEFORE STATE UPDATE ---
                console.log(`[SessionView Effect 1] Constructed fullSession for ${currentSessionIdNum}:`, {
                   id: fullSession.id,
                   name: fullSession.sessionName,
                   transcription_exists: !!fullSession.transcription,
                   chats_exist: fullSession.hasOwnProperty('chats'), // Check property existence
                   chats_is_array: Array.isArray(fullSession.chats), // Check if it's an array
                   chats_count: Array.isArray(fullSession.chats) ? fullSession.chats.length : 'N/A',
                });
                // --- END LOGGING ---

                setLocalSession(fullSession);
                setEditTranscriptContent(fullSession.transcription || '');
                setActiveSessionId(currentSessionIdNum); // Set global active session ID
                setChatError(''); // Clear any previous errors

                // Update global pastSessions atom
                setPastSessions(prevSessions => {
                    console.log(`[SessionView Effect 1] Updating pastSessions atom for ${currentSessionIdNum}`);
                    const sessionExists = prevSessions.some(s => s.id === currentSessionIdNum);
                    if (sessionExists) {
                        // Update existing session
                        return prevSessions.map(s => s.id === currentSessionIdNum ? fullSession : s);
                    } else {
                        // Add new session
                         console.log(`[SessionView Effect 1] Adding new session ${currentSessionIdNum} to pastSessions`);
                        return [fullSession, ...prevSessions];
                    }
                });

                // Determine target chat ID and necessary navigation AFTER session state is set
                const chats = fullSession.chats || [];
                let targetChatId: number | null = null;
                let shouldNavigate = false;
                let navigateTo: string | null = null;
                const urlChatId = chatIdParam ? parseInt(chatIdParam, 10) : null;
                const chatExistsInSession = urlChatId !== null && !isNaN(urlChatId) && chats.some(c => c.id === urlChatId);

                 if (chatExistsInSession && urlChatId !== null) {
                      targetChatId = urlChatId;
                 } else if (chats.length > 0) {
                      const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);
                      targetChatId = sortedChats[0].id;
                      if (String(urlChatId) !== String(targetChatId)) {
                          shouldNavigate = true;
                          navigateTo = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
                      }
                  } else {
                       if (chatIdParam) {
                          shouldNavigate = true;
                          navigateTo = `/sessions/${currentSessionIdNum}`;
                       }
                  }

                 console.log(`[SessionView Effect 1] Determined targetChatId for ${currentSessionIdNum}:`, targetChatId);
                 setActiveChatId(targetChatId); // Set global active chat ID -> Triggers Effect 2

                if (shouldNavigate && navigateTo) {
                     console.log(`[SessionView Effect 1] Navigating for ${currentSessionIdNum} to:`, navigateTo);
                    navigate(navigateTo, { replace: true });
                }

            } catch (err) {
                console.error(`[SessionView Effect 1] Error loading session ${currentSessionIdNum}:`, err);
                setChatError("Failed to load session data. Please try again.");
                // Clear potentially partially loaded state
                setLocalSession(null);
                setIsLoadingSession(false); // Ensure loading stops on error
            } finally {
                // Ensure loading state is turned off even if error occurred before full processing
                setIsLoadingSession(false);
            }
        };

        loadSessionCoreData();
    // Dependencies: Run when session ID or chat ID from URL change
    }, [sessionIdParam, chatIdParam, navigate, setActiveSessionId, setActiveChatId, setChatError, setPastSessions]);


    // Effect 2: Load Chat Messages
    useEffect(() => {
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

        // --- LOGGING START ---
         console.log(`[SessionView Effect 2] Running: activeChatId=${activeChatId}, localSessionExists=${!!localSession}, isLoadingChat=${isLoadingChat}, currentChatLoadIdRef=${currentChatLoadIdRef.current}`);
        // --- LOGGING END ---


        if (!localSession || !currentSessionIdNum || activeChatId === null) {
            currentChatLoadIdRef.current = null;
             console.log(`[SessionView Effect 2] Bailing: No local session, session ID, or active chat ID.`);
            return;
        }

        if (currentChatLoadIdRef.current === activeChatId) {
             console.log(`[SessionView Effect 2] Skipping fetch for chat ${activeChatId}: already loading or loaded (ref match).`);
            return;
        }

        // Use optional chaining for safety when accessing chats
        const currentChat = localSession.chats?.find(c => c.id === activeChatId);

        // Use optional chaining for safety when accessing messages
        if (currentChat?.messages !== undefined) {
             console.log(`[SessionView Effect 2] Skipping fetch for chat ${activeChatId}: messages array already exists (might be empty).`);
            currentChatLoadIdRef.current = activeChatId;
            setIsLoadingChat(false);
            return;
        }

        if (currentChat) { // currentChat exists, but messages are undefined, so fetch them
            const loadChatMessages = async () => {
                console.log(`[SessionView Effect 2] Fetching messages for chat ${activeChatId}...`);
                currentChatLoadIdRef.current = activeChatId;
                setIsLoadingChat(true);
                setChatError('');
                try {
                    const detailedChatData = await fetchChatDetails(currentSessionIdNum, activeChatId);
                    console.log(`[SessionView Effect 2] Fetched messages for chat ${activeChatId}, count:`, detailedChatData.messages?.length);
                    const chatWithMessages: ChatSession = {
                       ...detailedChatData,
                       messages: detailedChatData.messages || [], // Ensure messages is an array
                    };

                    // Update local session state
                    setLocalSession(prevSession => {
                        if (!prevSession) return null;
                         console.log(`[SessionView Effect 2] Updating localSession with messages for chat ${activeChatId}`);
                        return {
                            ...prevSession,
                            // Ensure prevSession.chats exists before mapping
                            chats: (prevSession.chats || []).map(chat =>
                                chat.id === activeChatId ? chatWithMessages : chat
                            )
                        };
                    });

                    // Update global state atom
                    setPastSessions(prevGlobalSessions => {
                         console.log(`[SessionView Effect 2] Updating pastSessions atom with messages for chat ${activeChatId}`);
                        return prevGlobalSessions.map(session => {
                            if (session.id === currentSessionIdNum) {
                                // Ensure session.chats exists before mapping
                                const updatedChats = (session.chats || []).map(chat =>
                                    chat.id === activeChatId ? chatWithMessages : chat
                                );
                                return { ...session, chats: updatedChats };
                            }
                            return session;
                        })
                    });

                } catch (err) {
                    console.error(`[SessionView Effect 2] Failed to load messages for chat ${activeChatId}:`, err);
                    setChatError(`Failed to load messages for chat ${activeChatId}.`);
                    // Update state to indicate failed attempt (empty messages array)
                     setLocalSession(prevSession => {
                         if (!prevSession) return null;
                         return { ...prevSession, chats: (prevSession.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) };
                     });
                     setPastSessions(prevGlobalSessions => prevGlobalSessions.map(session => session.id === currentSessionIdNum ? { ...session, chats: (session.chats || []).map(chat => chat.id === activeChatId ? { ...chat, messages: [] } : chat) } : session));
                } finally {
                    if (currentChatLoadIdRef.current === activeChatId) {
                       setIsLoadingChat(false);
                    }
                }
            };
            loadChatMessages();
        } else {
             console.warn(`[SessionView Effect 2] Chat with ID ${activeChatId} not found in local session state when trying to load messages.`);
             currentChatLoadIdRef.current = null;
             setIsLoadingChat(false);
        }
    // Depend on activeChatId, localSession (to trigger when chats array populates initially), and sessionIdParam
    }, [activeChatId, localSession, setChatError, setPastSessions, setActiveChatId, sessionIdParam]);


    // --- CALLBACKS & EVENT HANDLERS ---
    // Resizing Logic
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
         e.preventDefault(); isResizing.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
         document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp);
     }, []);
     const handleMouseMove = useCallback((e: MouseEvent) => {
         if (!isResizing.current || !sidebarRef.current) return; const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect(); if (!containerRect) return;
         let newWidth = e.clientX - containerRect.left; newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH)); setSidebarWidth(newWidth);
     }, [setSidebarWidth]);
     const handleMouseUp = useCallback(() => {
         if (isResizing.current) { isResizing.current = false; document.body.style.cursor = ''; document.body.style.userSelect = '';
         document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); }
     }, [handleMouseMove]); // Keep handleMouseMove dependency
     useEffect(() => { /* resize cleanup */ return () => { if (isResizing.current) { handleMouseUp(); } } }, [handleMouseMove, handleMouseUp]); // Ensure cleanup happens

     // Other Handlers
     const handleStartFirstChat = async () => {
         const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null; // Get current ID
         if (!localSession || !currentSessionIdNum) return;
         setIsLoadingChat(true);
         try {
             const newChatMetaData = await startNewChat(currentSessionIdNum);
             const newChatFull = await fetchChatDetails(currentSessionIdNum, newChatMetaData.id);
             const chatReadyForState: ChatSession = { ...newChatFull, messages: newChatFull.messages || [] };
             const updatedSession: Session = { ...localSession, chats: [...(localSession.chats || []), chatReadyForState] };
             setLocalSession(updatedSession);
             setPastSessions(prevSessions => prevSessions.map(s => s.id === currentSessionIdNum ? updatedSession : s));
             setActiveChatId(chatReadyForState.id);
             navigate(`/sessions/${currentSessionIdNum}/chats/${chatReadyForState.id}`);
         } catch (err) { console.error("Failed to start new chat:", err); setChatError('Failed to start new chat.');
         } finally { setIsLoadingChat(false); }
     };
     const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);
     const handleTranscriptContentChange = (newContent: string) => setEditTranscriptContent(newContent);
     const handleSaveTranscriptParagraph = async (index: number, text: string) => {
         const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null; // Get current ID
         if (!localSession || !currentSessionIdNum) return;
         console.log(`Attempting to save paragraph ${index} for session ${currentSessionIdNum}`);
         try {
             const updatedFullTranscript = await updateTranscriptParagraph(currentSessionIdNum, index, text);
             const updatedSession: Session = { ...localSession, transcription: updatedFullTranscript };
             setLocalSession(updatedSession);
             setEditTranscriptContent(updatedFullTranscript);
             setPastSessions(prevSessions => prevSessions.map(s => s.id === currentSessionIdNum ? updatedSession : s));
             console.log(`Successfully saved paragraph ${index}`);
         } catch (err) { console.error(`Failed to save paragraph ${index}:`, err); setChatError('Failed to update transcript paragraph.'); }
     };
     const handleNavigateBack = () => navigate('/');


    // --- RENDER LOGIC ---
    if (isLoadingSession) {
        return (
            <Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
                <Spinner size="3" /> <Text ml="2" color="gray">Loading session data...</Text>
            </Flex>
        );
    }

    if (!localSession) {
        return (
             <Flex direction="column" justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
                 <Text color="red" mb="4">{currentError || "Session data could not be loaded."}</Text>
                 <Button onClick={handleNavigateBack} variant="soft" color="gray"><ArrowLeftIcon /> Go back to Sessions</Button>
             </Flex>
        );
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
                        session={localSession} // Pass localSession which gets updated with messages
                        onEditDetailsClick={handleOpenEditMetadataModal}
                        editTranscriptContent={editTranscriptContent}
                        onTranscriptContentChange={handleTranscriptContentChange}
                        onSaveTranscriptParagraph={handleSaveTranscriptParagraph}
                        activeChatId={activeChatId} // Pass the active chat ID from atom
                        hasChats={hasChats}
                        onStartFirstChat={handleStartFirstChat}
                        isLoadingChat={isLoadingChat} // Pass chat loading state
                    />
                </Box>
            </Flex>
            {/* Edit Modal */}
            <EditDetailsModal isOpen={isEditingMetadata} onOpenChange={setIsEditingMetadata} session={localSession} />
        </Flex>
    );
}
