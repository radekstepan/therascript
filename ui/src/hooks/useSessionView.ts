// src/hooks/useSessionView.ts
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import {
    // Import specific atoms from source files or main index
    activeSessionIdAtom,   // From sessionAtoms <<< CORRECTED
    activeChatIdAtom,      // From chatAtoms
    chatErrorAtom,         // From chatAtoms
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    activeSessionAtom,     // From derivedAtoms
    loadSessionCoreActionAtom,
    loadChatMessagesActionAtom,
    startNewChatActionAtom,
    updateTranscriptParagraphActionAtom,
    updateSessionMetadataActionAtom,
    pastSessionsAtom,      // From sessionAtoms <<< CORRECTED
    // Import types from source file
    SessionSortCriteria,   // From sessionAtoms <<< CORRECTED
    SortDirection          // From sessionAtoms <<< CORRECTED
} from '../store'; // Use main index
import type { Session, ChatSession, SessionMetadata } from '../types';

export function useSessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const store = useStore();

    // Global State Access
    const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom); // Use correct atom
    const [activeChatId, setActiveChatId] = useAtom(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const activeSession = useAtomValue(activeSessionAtom);
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const loadSessionCore = useSetAtom(loadSessionCoreActionAtom);
    const loadChatMessages = useSetAtom(loadChatMessagesActionAtom);
    const startNewChat = useSetAtom(startNewChatActionAtom);
    const updateTranscriptParagraph = useSetAtom(updateTranscriptParagraphActionAtom);
    const updateSessionMetadata = useSetAtom(updateSessionMetadataActionAtom);

    // Local UI State, Refs, Derived Params
    const [isLoadingSession, setIsLoadingSession] = useState(true);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const isResizing = useRef(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const previousSessionIdRef = useRef<number | null>(null);
    const currentChatLoadIdRef = useRef<number | null>(null);
    const sessionId = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
    const chatIdUrl = chatIdParam ? parseInt(chatIdParam, 10) : null;

    // Resize Logic
    const handleMouseMove = useCallback((e: MouseEvent) => { if (!isResizing.current || !sidebarRef.current?.parentElement) return; const cR=sidebarRef.current.parentElement.getBoundingClientRect(); const nW=e.clientX-cR.left; setSidebarWidth(nW); }, [setSidebarWidth]);
    const handleMouseUp = useCallback(() => { if (isResizing.current) { isResizing.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); } }, [handleMouseMove]);
    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); isResizing.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp); }, [handleMouseMove, handleMouseUp]);
    useEffect(() => { return () => { if (isResizing.current) { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; } }; }, [handleMouseMove, handleMouseUp]);

    // Data Loading Logic
    useEffect(() => {
        if (sessionId === null || isNaN(sessionId)) { navigate('/', { replace: true }); return; }
        let isMounted = true;
        const syncAndLoad = async () => {
            if (previousSessionIdRef.current !== sessionId) {
                previousSessionIdRef.current = sessionId; setIsLoadingSession(true); setChatError(''); setActiveChatId(null); currentChatLoadIdRef.current = null;
                const loadedSession = await loadSessionCore(sessionId);
                if (isMounted) {
                    setIsLoadingSession(false); if (!loadedSession) return;
                    const chats = loadedSession.chats || []; let targetChatId: number | null = null; const urlChatIdIsValid = chatIdUrl !== null && !isNaN(chatIdUrl); const chatExists = urlChatIdIsValid && chats.some(c => c.id === chatIdUrl);
                    if (chatExists && chatIdUrl) { targetChatId = chatIdUrl; } else if (chats.length > 0) { targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id; }
                    setActiveChatId(targetChatId);
                    const expectedPath = `/sessions/${sessionId}${targetChatId ? `/chats/${targetChatId}` : ''}`; if (window.location.pathname !== expectedPath) { navigate(expectedPath, { replace: true }); }
                }
            } else {
                if (!isLoadingSession) {
                     const currentActiveChat_Store = store.get(activeChatIdAtom); const sessionData_Store = store.get(activeSessionAtom);
                     const urlChatIdIsValid = chatIdUrl !== null && !isNaN(chatIdUrl); const chatExists = urlChatIdIsValid && sessionData_Store?.chats?.some(c => c.id === chatIdUrl);
                     if (urlChatIdIsValid && chatExists && currentActiveChat_Store !== chatIdUrl) { setActiveChatId(chatIdUrl); }
                     else if (urlChatIdIsValid && !chatExists) { const dId=sessionData_Store?.chats?.[0]?.id??null; const tP=`/sessions/${sessionId}${dId?'/chats/'+dId:''}`; if(window.location.pathname!==tP)navigate(tP,{replace:true}); setActiveChatId(dId); }
                     else if (!urlChatIdIsValid && currentActiveChat_Store !== null) { const tP=`/sessions/${sessionId}/chats/${currentActiveChat_Store}`; if(window.location.pathname!==tP)navigate(tP,{replace:true}); }
                }
            }
        };
        syncAndLoad(); return () => { isMounted = false; };
    }, [sessionId, chatIdUrl, navigate, loadSessionCore, setActiveChatId, setChatError, store, isLoadingSession]);

    useEffect(() => {
        if (isLoadingSession || !sessionId || activeChatId === null) { setIsLoadingChat(false); return; }
        const sessionData = activeSession; const currentChat = sessionData?.chats?.find(c => c.id === activeChatId);
        if (currentChat?.messages !== undefined || currentChatLoadIdRef.current === activeChatId) { setIsLoadingChat(false); return; }
        let isMounted = true;
        const loadMessages = async () => {
            currentChatLoadIdRef.current = activeChatId; setIsLoadingChat(true); setChatError('');
            await loadChatMessages({ sessionId: sessionId!, chatId: activeChatId });
            if (isMounted && currentChatLoadIdRef.current === activeChatId) { setIsLoadingChat(false); }
        };
        loadMessages(); return () => { isMounted = false; };
    }, [activeChatId, sessionId, isLoadingSession, activeSession, loadChatMessages, setChatError]);

    // Action Handlers
    const handleStartFirstChat = useCallback(async () => { if (!sessionId) return; setIsLoadingChat(true); await startNewChat({ sessionId }); setIsLoadingChat(false); }, [sessionId, startNewChat]);
    const handleOpenEditMetadataModal = useCallback(() => setIsEditingMetadata(true), []);
    const handleCloseEditMetadataModal = useCallback(() => setIsEditingMetadata(false), []);
    const handleSaveMetadata = useCallback(async (metadata: Partial<SessionMetadata>) => { if (!sessionId) return; await updateSessionMetadata({ sessionId, metadata }); setIsEditingMetadata(false); }, [sessionId, updateSessionMetadata]);
    const handleSaveTranscriptParagraph = useCallback(async (index: number, text: string) => { if (!sessionId) return; await updateTranscriptParagraph({ sessionId, paragraphIndex: index, newText: text }); }, [sessionId, updateTranscriptParagraph]);
    const handleNavigateBack = useCallback(() => navigate('/'), [navigate]);

    // Derived Display Values
    const displayTitle = activeSession?.sessionName || activeSession?.fileName || 'Session';
    const hasChats = !!activeSession?.chats && activeSession.chats.length > 0;
    const activeChatMessagesAvailable = activeChatId !== null && (activeSession?.chats?.find(c => c.id === activeChatId)?.messages !== undefined);
    const showChatLoading = isLoadingChat || (activeChatId !== null && !activeChatMessagesAvailable);

    return {
        isLoadingSession, isLoadingChat: showChatLoading, activeSession, activeChatId,
        isEditingMetadata, sidebarWidth, currentError: chatError, displayTitle, hasChats, sidebarRef,
        handleNavigateBack, handleOpenEditMetadataModal, handleCloseEditMetadataModal,
        handleSaveMetadata, handleSaveTranscriptParagraph, handleStartFirstChat, handleMouseDown,
        setActiveChatId,
    };
}
