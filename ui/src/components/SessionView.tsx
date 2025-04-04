// src/components/SessionView.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom';

// Import UI Components & Icons
import { Button } from './ui/Button';
import { Loader2, ArrowLeft, Edit, Save } from './icons/Icons';

// Import Sub-components
import {
    SessionMetadata,
    Transcription,
    ChatHeader,
    ChatMessages,
    ChatInput,
    PastChatsList
} from './SessionView/'; // Use index import

// Import Constants, Helpers, Types
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import type { Session } from '../types';

// Import Atoms
import {
    pastSessionsAtom,
    activeSessionIdAtom,
    activeChatIdAtom,
    activeSessionAtom, // Read the derived active session
    chatErrorAtom, // Keep setter for error handling here if needed
    updateSessionMetadataAtom,
    saveTranscriptAtom,
    startNewChatAtom, // Keep action setter
} from '../store';
import { Card, CardContent } from './ui/Card';

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId: string }>();
    const navigate = useNavigate();

    // Atoms for global state access
    const allSessions = useAtomValue(pastSessionsAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const derivedSession = useAtomValue(activeSessionAtom); // Read derived session based on activeSessionIdAtom
    const activeChatId = useAtomValue(activeChatIdAtom); // Read current chat ID
    const [chatError, setChatError] = useAtom(chatErrorAtom); // Get setter if needed here

    // Action Atoms
    const updateMetadata = useSetAtom(updateSessionMetadataAtom);
    const saveTranscript = useSetAtom(saveTranscriptAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);

    const chatScrollRef = useRef<HTMLDivElement>(null);

    // --- Local UI State for Editing ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // --- Effect to Sync URL Params with Jotai State ---
    useEffect(() => {
        setIsLoading(true);
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : NaN;

        if (isNaN(currentSessionIdNum)) {
            console.error("Invalid session ID in URL:", sessionIdParam);
            navigate('/', { replace: true });
            return;
        }

        const sessionFromParam = allSessions.find(s => s.id === currentSessionIdNum);

        if (!sessionFromParam) {
            console.error(`Session with ID ${currentSessionIdNum} not found.`);
            navigate('/', { replace: true });
            return;
        }

        // Set the active session ID. The derivedSession atom will update automatically.
        setActiveSessionId(currentSessionIdNum);

        // Determine and set the active chat ID
        let targetChatId: number | null = null;
        const chats = Array.isArray(sessionFromParam.chats) ? sessionFromParam.chats : [];

        if (!isNaN(currentChatIdNum)) {
            if (chats.some(c => c.id === currentChatIdNum)) {
                targetChatId = currentChatIdNum;
            } else {
                console.warn(`Chat ID ${currentChatIdNum} not found in session ${currentSessionIdNum}. Defaulting.`);
            }
        }

        if (targetChatId === null && chats.length > 0) {
            const latestChat = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0];
            targetChatId = latestChat.id;
            if (isNaN(currentChatIdNum) || currentChatIdNum !== targetChatId) {
               navigate(`/sessions/${currentSessionIdNum}/chats/${targetChatId}`, { replace: true });
               // Setting activeChatId will happen on the next render cycle after navigation
               // setActiveChatId(targetChatId); // Defer this to avoid race condition
            } else {
                 setActiveChatId(targetChatId); // Set if URL already matches
            }
        } else if (targetChatId === null && chats.length === 0) {
            targetChatId = null;
            setActiveChatId(targetChatId);
        } else {
             // targetChatId is valid from URL or already null
             setActiveChatId(targetChatId);
        }


        // Reset chat error state on navigation
        setChatError('');

        setIsLoading(false);

    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError]);


    // --- Effects to Initialize Local Edit State when Session Changes ---
    useEffect(() => {
        if (derivedSession && !isEditingMetadata) {
            setEditClientName(derivedSession.clientName || '');
            setEditName(derivedSession.sessionName || derivedSession.fileName || '');
            setEditDate(derivedSession.date || '');
            setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
            setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        }
        if (!derivedSession) setIsEditingMetadata(false);
    }, [derivedSession, isEditingMetadata]);

    useEffect(() => {
        if (derivedSession && !isEditingTranscript) {
            setEditTranscriptContent(derivedSession.transcription || '');
        }
         if (!derivedSession) setIsEditingTranscript(false);
    }, [derivedSession, isEditingTranscript]);


    // --- Handlers for Container Logic ---

    const handleNavigateBack = () => {
        navigate('/');
    };

    const handleEditMetadataToggle = () => {
        setIsEditingMetadata(prev => !prev);
        // Resetting fields on cancel is handled by the useEffect above
    };

    const handleSaveMetadataEdit = () => {
        if (!editClientName.trim() || !editName.trim() || !editDate || !editType || !editTherapy) {
            alert("Please fill all metadata fields before saving.");
            return;
        }
        if (derivedSession) {
            updateMetadata({
                sessionId: derivedSession.id,
                metadata: {
                    clientName: editClientName.trim(),
                    sessionName: editName.trim(),
                    date: editDate,
                    sessionType: editType,
                    therapy: editTherapy
                }
            });
            setIsEditingMetadata(false);
        }
    };

    const handleEditTranscriptToggle = () => {
        setIsEditingTranscript(prev => !prev);
    };

    const handleSaveTranscriptEdit = () => {
        if (derivedSession) {
            saveTranscript({ sessionId: derivedSession.id, transcript: editTranscriptContent });
            setIsEditingTranscript(false);
        }
    };

    // Navigation triggered by sub-components
    const handleSelectChatHistory = (chatId: number) => {
        if (derivedSession && chatId !== activeChatId) {
            navigate(`/sessions/${derivedSession.id}/chats/${chatId}`);
        }
    };

    const handleNewChatClick = async () => {
        const currentSessionId = derivedSession?.id;
        if (currentSessionId) {
            const result = await startNewChatAction({ sessionId: currentSessionId });
            if (result.success) {
                navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
            } else {
                console.error("Failed to start new chat:", result.error);
                 setChatError(result.error); // Display error
            }
        } else {
            console.error("Cannot start new chat: Session ID not available.");
            setChatError("Cannot start new chat: Session context is missing.");
        }
    };


    // --- Render Logic ---
    if (isLoading) {
         return (
             <div className="text-center text-gray-600 p-10">
                 <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" />
                 <p>Loading session data...</p>
                 <Button onClick={handleNavigateBack} variant="outline" className="mt-4">
                     Go Back
                 </Button>
             </div>
         );
    }

    // derivedSession atom handles the case where the session doesn't exist for the ID
    if (!derivedSession) {
         // This case should ideally be handled by the redirect in useEffect,
         // but render a fallback just in case.
        return <Navigate to="/" replace />;
    }

    const session = derivedSession; // Alias for clarity

    return (
        <div className="w-full max-w-7xl mx-auto flex-grow flex flex-col space-y-4 min-h-0">
            {/* Header Row */}
            <div className="flex-shrink-0 flex justify-between items-center">
                <Button onClick={handleNavigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sessions
                </Button>
                <div className="space-x-2">
                    {!isEditingMetadata ? (
                        <Button onClick={handleEditMetadataToggle} variant="outline" size="sm">
                            <Edit className="mr-2 h-4 w-4" /> Edit Details
                        </Button>
                    ) : (
                        <>
                            <Button onClick={handleSaveMetadataEdit} variant="default" size="sm">
                                <Save className="mr-2 h-4 w-4" /> Save Details
                            </Button>
                            <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm">
                                Cancel
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-grow flex flex-col lg:flex-row lg:space-x-4 space-y-4 lg:space-y-0 min-h-0">

                {/* Left Column */}
                <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                    <SessionMetadata
                        session={session}
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
                    <Transcription
                        session={session}
                        isEditing={isEditingTranscript}
                        editTranscriptContent={editTranscriptContent}
                        onEditToggle={handleEditTranscriptToggle}
                        onSave={handleSaveTranscriptEdit}
                        onContentChange={setEditTranscriptContent}
                    />
                </div>

                {/* Right Column */}
                <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                    {/* Combined Chat Card */}
                    <Card className="flex-grow flex flex-col min-h-0">
                         <ChatHeader
                            activeChatId={activeChatId}
                            onNewChatClick={handleNewChatClick}
                         />
                         {/* Chat Content: Messages + Input */}
                         <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4">
                            <ChatMessages
                                chatScrollRef={chatScrollRef}
                                activeChatId={activeChatId}
                            />
                            <ChatInput />
                        </CardContent>
                    </Card>
                    {/* Past Chats List */}
                    <PastChatsList
                        session={session}
                        activeChatId={activeChatId}
                        onSelectChatHistory={handleSelectChatHistory}
                    />
                </div>
            </div>
        </div>
    );
}
