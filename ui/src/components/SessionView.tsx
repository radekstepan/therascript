import React, { useState, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Button } from './ui/Button'; // Import new Button
import { Card, CardContent, CardHeader } from './ui/Card'; // Import new Card
import { Loader2, ArrowLeft, Edit, Save } from './icons/Icons';

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

// Sub-components
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

    // Local UI State
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

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
                // Navigate to session base, let the next part redirect to latest chat
                navigate(`/sessions/${currentSessionIdNum}`, { replace: true });
                targetChatId = NaN; // Ensure it falls into default logic below
            }
        }

        // If no valid chat ID from URL OR URL points to base session URL, find the latest chat
        if (isNaN(targetChatId) && chats.length > 0) {
            targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
            // Only navigate if the URL doesn't already include this targetChatId
            const expectedPath = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
             if (location.pathname !== expectedPath) {
                navigate(expectedPath, { replace: true });
             }
        } else if (isNaN(targetChatId)) {
             targetChatId = NaN; // No chats exist
        }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError('');
        setIsLoading(false);
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname]); // Added location.pathname dependency


    // --- Effects to Initialize Local Edit State ---
     useEffect(() => {
        if (derivedSession && !isEditingMetadata) {
            setEditClientName(derivedSession.clientName || '');
            setEditName(derivedSession.sessionName || derivedSession.fileName || '');
            setEditDate(derivedSession.date || '');
            setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
            setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        }
        // Reset if session changes or editing stops
        if (!derivedSession || !isEditingMetadata) { setIsEditingMetadata(false); }
    }, [derivedSession, isEditingMetadata]);

    useEffect(() => {
        if (derivedSession && !isEditingTranscript) {
            setEditTranscriptContent(derivedSession.transcription || '');
        }
         // Reset if session changes or editing stops
        if (!derivedSession || !isEditingTranscript) { setIsEditingTranscript(false); }
    }, [derivedSession, isEditingTranscript]);

    // --- Handlers ---
    const handleEditMetadataToggle = () => {
         if (!isEditingMetadata && derivedSession) {
             // Re-initialize state when starting edit
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
             // Re-initialize state when starting edit
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


    // --- Render Logic ---
    if (isLoading) {
        return ( <div className="flex-grow flex items-center justify-center text-center p-10"> <Card className="max-w-sm mx-auto p-6"> <div className="flex justify-center mb-4"> <Loader2 className="h-8 w-8 animate-spin text-gray-400 dark:text-gray-500" /> </div> <p className="text-gray-600 dark:text-gray-300">Loading session data...</p> <Button onClick={handleNavigateBack} variant="secondary" className="mt-6 w-full"> Go Back </Button> </Card> </div> );
    }
    if (!derivedSession) { return <Navigate to="/" replace />; }

    return (
        // Main flex container for sidebar + content
        <div className="flex flex-grow min-h-0 items-stretch"> {/* Use div + flex */}
            <SessionSidebar />

            {/* Main Content Area with Scroll */}
            <main ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-gray-100 dark:bg-gray-950 overflow-y-auto">

                {/* Sticky Header */}
                 <div className="sticky top-0 z-10 flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm flex items-center justify-between"> {/* div + flex */}
                     <Button onClick={handleNavigateBack} variant="link" size="sm" icon={ArrowLeft}> {/* Use link variant */}
                         Back to Sessions
                     </Button>
                      <span className="truncate font-medium text-gray-800 dark:text-gray-200">{derivedSession.sessionName || derivedSession.fileName}</span>
                      {/* Placeholder for potential actions */}
                      <div className="w-[150px]"></div> {/* Keep spacing roughly balanced */}
                 </div>

                {/* Content Wrapper: Default vertical, becomes horizontal row on large screens */}
                <div className="p-4 md:p-6 lg:p-8 flex-grow flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0">

                    {/* Left Panel (Details + Transcript) */}
                    <div className="flex flex-col space-y-6 lg:w-1/2 lg:flex-shrink-0">
                        {/* Details Section */}
                        <Card>
                             {/* CardHeader for padding and layout */}
                            <CardHeader className="flex-row justify-between items-start mb-0 pb-2"> {/* Adjust layout */}
                                <h3 className="text-lg font-semibold">Details</h3> {/* Use h3 */}
                                {!isEditingMetadata ? (
                                    <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm" icon={Edit}>
                                        Edit
                                    </Button>
                                ) : (
                                    <div className="flex justify-end space-x-2"> {/* div + flex */}
                                        <Button onClick={handleSaveMetadataEdit} variant="default" size="sm" icon={Save}>
                                            Save
                                        </Button>
                                        <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm">Cancel</Button>
                                    </div>
                                )}
                            </CardHeader>
                            {/* Use hr for divider */}
                            <hr className="my-4 border-gray-200 dark:border-gray-700" />
                            {/* CardContent for padding */}
                            <CardContent className="pt-2">
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
                            </CardContent>
                        </Card>

                        {/* Transcription Section */}
                        <Card className="flex flex-col min-h-[50vh]">
                            <CardHeader className="flex-row justify-between items-start mb-0 pb-2"> {/* Adjust layout */}
                                <h3 className="text-lg font-semibold">Transcription</h3> {/* Use h3 */}
                                {!isEditingTranscript ? (
                                    <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm" icon={Edit}>
                                        Edit
                                    </Button>
                                ) : (
                                    <div className="flex justify-end space-x-2"> {/* div + flex */}
                                        <Button onClick={handleSaveTranscriptEdit} variant="default" size="sm" icon={Save}>
                                            Save
                                        </Button>
                                        <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm">Cancel</Button>
                                    </div>
                                )}
                            </CardHeader>
                            <hr className="my-4 border-gray-200 dark:border-gray-700" />
                            {/* Use CardContent and ensure Transcription takes full height */}
                            <CardContent className="pt-2 flex flex-col flex-grow min-h-0">
                                <Transcription
                                    session={derivedSession}
                                    isEditingOverall={isEditingTranscript}
                                    editTranscriptContent={editTranscriptContent}
                                    onContentChange={setEditTranscriptContent}
                                    onEditToggle={handleEditTranscriptToggle}
                                    onSave={handleSaveTranscriptEdit}
                                />
                            </CardContent>
                        </Card>
                    </div> {/* End Left Panel */}


                    {/* Right Panel (Chat) */}
                    <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0">
                        {/* Chat Section */}
                        {activeChatId !== null ? (
                             <Card className="flex flex-col flex-grow min-h-[70vh] p-0"> {/* Remove Card padding */}
                                <ChatInterface />
                             </Card>
                        ) : derivedSession.chats && derivedSession.chats.length > 0 ? (
                            <Card className="flex items-center justify-center text-center italic min-h-[70vh]">
                                <p className="text-gray-500 dark:text-gray-400">
                                Select a chat from the sidebar to view it.
                                </p>
                            </Card>
                        ) : (
                            <Card className="flex items-center justify-center text-center italic min-h-[70vh]">
                                <p className="text-gray-500 dark:text-gray-400">
                                No chats have been started for this session yet.
                                </p>
                            </Card>
                        )}
                    </div> {/* End Right Panel */}

                </div> {/* End Content Wrapper */}
            </main> {/* End Main Content Area */}
        </div> // End Outer Flex Container
    );
}
