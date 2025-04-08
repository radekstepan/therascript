import React, { useState, useEffect, useRef } from 'react'; // Removed Dispatch, SetStateAction
import { useAtomValue, useSetAtom } from 'jotai'; // Removed useAtom
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Button, Card, Flex, Title, Text, Divider } from '@tremor/react';
import { Loader2, ArrowLeft, Edit, Save } from './icons/Icons'; // Removed FileText as it's not directly used here

// Sidebar
import { SessionSidebar } from './SessionView/SessionSidebar';

// Constants, Types
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import type { Session, ChatSession } from '../types';

// Atoms
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom,
    chatErrorAtom,
    updateSessionMetadataAtom,
    saveTranscriptAtom,
} from '../store';

// Sub-components and their Props Interfaces
import { SessionMetadata } from './SessionView/SessionMetadata';
import { Transcription } from './SessionView/Transcription';
import { ChatInterface } from './SessionView/ChatInterface';


export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    // Atoms
    const allSessions = useAtomValue(pastSessionsAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const derivedSession = useAtomValue(activeSessionAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const updateMetadataAction = useSetAtom(updateSessionMetadataAtom);
    const saveTranscriptAction = useSetAtom(saveTranscriptAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);

    // Local UI State for Editing
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Refs for scrolling - REMOVED
    // const detailsRef = useRef<HTMLDivElement | null>(null);
    // const transcriptRef = useRef<HTMLDivElement | null>(null);
    // const chatRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null); // Keep for main scroll

    // --- Effect to Sync Session ID and Chat ID ---
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
             if (location.pathname !== `/sessions/${currentSessionIdNum}/chats/${targetChatId}`) {
                navigate(`/sessions/${currentSessionIdNum}/chats/${targetChatId}`, { replace: true });
             }
        } else if (isNaN(targetChatId)) {
             targetChatId = NaN;
        }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError('');
        setIsLoading(false);
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname]);

    // --- Effects to Initialize Local Edit State ---
     useEffect(() => {
        if (derivedSession && !isEditingMetadata) {
            setEditClientName(derivedSession.clientName || '');
            setEditName(derivedSession.sessionName || derivedSession.fileName || '');
            setEditDate(derivedSession.date || '');
            setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
            setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        }
        if (!derivedSession || !isEditingMetadata) { setIsEditingMetadata(false); }
    }, [derivedSession, isEditingMetadata]);

    useEffect(() => {
        if (derivedSession && !isEditingTranscript) {
            setEditTranscriptContent(derivedSession.transcription || '');
        }
        if (!derivedSession || !isEditingTranscript) { setIsEditingTranscript(false); }
    }, [derivedSession, isEditingTranscript]);

    // --- Handlers ---
    const handleEditMetadataToggle = () => {
         if (!isEditingMetadata && derivedSession) {
             setEditClientName(derivedSession.clientName || '');
             setEditName(derivedSession.sessionName || derivedSession.fileName || '');
             setEditDate(derivedSession.date || '');
             setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
             setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
         }
         setIsEditingMetadata(prev => !prev);
    };

    const handleEditTranscriptToggle = () => {
        if (!isEditingTranscript && derivedSession) {
            setEditTranscriptContent(derivedSession.transcription || '');
        }
        setIsEditingTranscript(prev => !prev);
    };

    const handleSaveMetadataEdit = () => {
        if (!derivedSession) return;
        const trimmedName = editName.trim();
        const trimmedClient = editClientName.trim();

        if (!trimmedName || !trimmedClient || !editDate) {
            alert("Please ensure Session Name, Client Name, and Date are filled.");
            return;
        }

        updateMetadataAction({
            sessionId: derivedSession.id,
            metadata: {
                 clientName: trimmedClient,
                 sessionName: trimmedName,
                 date: editDate,
                 sessionType: editType,
                 therapy: editTherapy,
            }
        });
        setIsEditingMetadata(false);
    };

    const handleSaveTranscriptEdit = () => {
        if (!derivedSession) return;
        saveTranscriptAction({
            sessionId: derivedSession.id,
            transcript: editTranscriptContent
        });
        setIsEditingTranscript(false);
    };

    const handleNavigateBack = () => navigate('/');

    // ScrollToSection logic REMOVED
    // const scrollToSection = (section: 'details' | 'transcript' | 'chat') => { ... };

    // --- Render Logic ---
    if (isLoading) {
        return ( <div className="flex-grow flex items-center justify-center text-center p-10"> <Card className="max-w-sm mx-auto p-6"> <Flex justifyContent="center" className="mb-4"> <Loader2 className="h-8 w-8 animate-spin text-tremor-content-subtle" /> </Flex> <Text className="text-tremor-content">Loading session data...</Text> <Button onClick={handleNavigateBack} variant="secondary" className="mt-6 w-full"> Go Back </Button> </Card> </div> );
    }
    if (!derivedSession) { return <Navigate to="/" replace />; }

    return (
        // The main flex container for sidebar + content
        <Flex className="flex-grow min-h-0" alignItems='stretch'>
            {/* Sidebar */}
            {/* <SessionSidebar scrollToSection={scrollToSection} /> // REMOVED prop */}
            <SessionSidebar />

            {/* Main Content Area with Scroll */}
            <main ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-tremor-background-muted overflow-y-auto">

                {/* Sticky Header */}
                 <Flex className="sticky top-0 z-10 flex-shrink-0 p-4 border-b border-tremor-border bg-tremor-background shadow-sm" justifyContent="between" alignItems='center'>
                     <Button onClick={handleNavigateBack} variant="light" icon={ArrowLeft}>
                         Back to Sessions
                     </Button>
                      <Text className="truncate font-medium text-tremor-content-strong">{derivedSession.sessionName || derivedSession.fileName}</Text>
                      {/* Placeholder for potential actions */}
                      <div></div>
                 </Flex>

                {/* Content Wrapper: Default vertical, becomes horizontal row on large screens */}
                <div className="p-4 md:p-6 lg:p-8 flex-grow flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0">

                    {/* Left Panel (Details + Transcript) */}
                    <div className="flex flex-col space-y-6 lg:w-1/2 lg:flex-shrink-0">
                        {/* Details Section */}
                        {/* Removed ref={detailsRef} */}
                        <Card>
                            <Flex justifyContent="between" alignItems="start" className="mb-4">
                                <Title>Details</Title>
                                {!isEditingMetadata ? (
                                    <Button onClick={handleEditMetadataToggle} variant="secondary" icon={Edit}>
                                        Edit
                                    </Button>
                                ) : (
                                    <Flex justifyContent="end" className="space-x-2">
                                        <Button onClick={handleSaveMetadataEdit} variant="primary" icon={Save}>
                                            Save
                                        </Button>
                                        <Button onClick={handleEditMetadataToggle} variant="secondary">Cancel</Button>
                                    </Flex>
                                )}
                            </Flex>
                            <Divider className="my-4 -mx-6" />
                            <SessionMetadata
                                session={derivedSession}
                                isEditing={isEditingMetadata}
                                editName={editName}
                                editClientName={editClientName}
                                editDate={editDate}
                                editType={editType}
                                editTherapy={editTherapy}
                                onEditNameChange={setEditName}
                                onEditClientNameChange={setEditClientName}
                                onEditDateChange={setEditDate}
                                onEditTypeChange={setEditType}
                                onEditTherapyChange={setEditTherapy}
                            />
                        </Card>

                        {/* Transcription Section */}
                         {/* Removed ref={transcriptRef} */}
                        <Card className="flex flex-col min-h-[50vh]">
                            <Flex justifyContent="between" alignItems="start" className="mb-4 flex-shrink-0">
                                <Title>Transcription</Title>
                                {!isEditingTranscript ? (
                                    <Button onClick={handleEditTranscriptToggle} variant="secondary" icon={Edit}>
                                        Edit
                                    </Button>
                                ) : (
                                    <Flex justifyContent="end" className="space-x-2">
                                        <Button onClick={handleSaveTranscriptEdit} variant="primary" icon={Save}>
                                            Save
                                        </Button>
                                        <Button onClick={handleEditTranscriptToggle} variant="secondary">Cancel</Button>
                                    </Flex>
                                )}
                            </Flex>
                            <Divider className="my-4 -mx-6 flex-shrink-0" />
                            <div className="flex flex-col flex-grow min-h-0">
                                <Transcription
                                    session={derivedSession}
                                    isEditingOverall={isEditingTranscript}
                                    editTranscriptContent={editTranscriptContent}
                                    onContentChange={setEditTranscriptContent}
                                    onEditToggle={handleEditTranscriptToggle}
                                    onSave={handleSaveTranscriptEdit}
                                />
                            </div>
                        </Card>
                    </div> {/* End Left Panel */}


                    {/* Right Panel (Chat) */}
                    <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0">
                        {/* Chat Section */}
                         {/* Removed ref={chatRef} */}
                        {/* Conditionally render ChatInterface or placeholders */}
                        {activeChatId !== null ? (
                            // Ensure Chat Card takes up appropriate space in the column
                             <Card className="flex flex-col flex-grow min-h-[70vh]"> {/* flex-grow helps it fill */}
                                <ChatInterface />
                            </Card>
                        ) : derivedSession.chats && derivedSession.chats.length > 0 ? (
                            <Card className="text-center italic py-6">
                                <Text className="text-tremor-content-subtle">
                                Select a chat from the sidebar to view it.
                                </Text>
                            </Card>
                        ) : (
                            <Card className="text-center italic py-6">
                                <Text className="text-tremor-content-subtle">
                                No chats have been started for this session yet.
                                </Text>
                            </Card>
                        )}
                    </div> {/* End Right Panel */}

                </div> {/* End Content Wrapper */}
            </main> {/* End Main Content Area */}
        </Flex> // End Outer Flex Container
    );
}
