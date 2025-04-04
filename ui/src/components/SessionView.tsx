import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Button } from './ui/Button';
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

// Sub-components and their Props Interfaces (Keep imports explicit)
import { SessionMetadata } from './SessionView/SessionMetadata';
import { Transcription } from './SessionView/Transcription';
import { ChatInterface } from './SessionView/ChatInterface';
// We don't need the prop interfaces defined here if we pass props individually

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

    // Refs for scrolling - Ensure standard initialization
    const detailsRef = useRef<HTMLDivElement | null>(null);
    const transcriptRef = useRef<HTMLDivElement | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // --- Effect to Sync Session ID and Chat ID --- (Keep as is)
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
            if (String(currentChatIdNum) !== String(targetChatId)) {
                 navigate(`/sessions/${currentSessionIdNum}/chats/${targetChatId}`, { replace: true });
            }
        } else if (isNaN(targetChatId)) { targetChatId = NaN; }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError('');
        setIsLoading(false);
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError]);

    // --- Effects to Initialize Local Edit State --- (Keep as is)
     useEffect(() => {
        if (derivedSession && !isEditingMetadata) {
            setEditClientName(derivedSession.clientName || ''); setEditName(derivedSession.sessionName || derivedSession.fileName || ''); setEditDate(derivedSession.date || ''); setEditType(derivedSession.sessionType || SESSION_TYPES[0]); setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        }
        if (!derivedSession || !isEditingMetadata) { setIsEditingMetadata(false); }
    }, [derivedSession, isEditingMetadata]);

    useEffect(() => {
        if (derivedSession && !isEditingTranscript) { setEditTranscriptContent(derivedSession.transcription || ''); }
         if (!derivedSession || !isEditingTranscript) { setIsEditingTranscript(false); }
    }, [derivedSession, isEditingTranscript]);

    // --- Handlers --- (Keep as is)
    const handleEditMetadataToggle = () => setIsEditingMetadata(prev => !prev);
    const handleEditTranscriptToggle = () => setIsEditingTranscript(prev => !prev);
    const handleSaveMetadataEdit = () => { /* ... */ };
    const handleSaveTranscriptEdit = () => { /* ... */ };
    const handleNavigateBack = () => navigate('/');
    const scrollToSection = (section: 'details' | 'transcript' | 'chat') => { /* ... */ };

    // --- Render Logic ---
    if (isLoading) {
        return ( <div className="flex-grow flex items-center justify-center text-center text-gray-600 p-10"> <div> <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" /> <p>Loading session data...</p> <Button onClick={handleNavigateBack} variant="outline" className="mt-4"> Go Back </Button> </div> </div> );
    }
    if (!derivedSession) { return <Navigate to="/" replace />; }

    // No longer need props objects if passing individually
    // const metadataComponentProps = { ... };
    // const transcriptionComponentProps = { ... };

    return (
        <div className="flex flex-grow min-h-0">
            <SessionSidebar scrollToSection={scrollToSection} />
             {/* Ensure ref is assigned correctly */}
            <div ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-gray-50 overflow-y-auto">
                 <div className="sticky top-0 z-10 flex-shrink-0 flex justify-between items-center p-4 border-b border-gray-200 bg-white shadow-sm">
                     <Button onClick={handleNavigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900 -ml-2"> <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sessions </Button>
                 </div>
                <div className="p-4 md:p-6 lg:p-8 space-y-6">
                     {/* Details Section */}
                     {/* Ensure ref is assigned correctly */}
                    <div ref={detailsRef} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                         <div className="flex justify-between items-center mb-4">
                              <h2 className="text-xl font-semibold">Details</h2>
                              {!isEditingMetadata ? ( <Button onClick={handleEditMetadataToggle} variant="outline" size="sm"> <Edit className="mr-2 h-4 w-4" /> Edit </Button> )
                              : ( <div className="space-x-2"> <Button onClick={handleSaveMetadataEdit} variant="default" size="sm"><Save className="mr-2 h-4 w-4" /> Save</Button> <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm">Cancel</Button> </div> )}
                         </div>
                         {/* FIX: Pass props individually */}
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
                    </div>
                    {/* Transcription Section */}
                     {/* Ensure ref is assigned correctly */}
                    <div ref={transcriptRef} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                         <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold">Transcription</h2>
                             {!isEditingTranscript ? ( <Button onClick={handleEditTranscriptToggle} variant="outline" size="sm"> <Edit className="mr-2 h-4 w-4" /> Edit </Button> )
                             : ( <div className="space-x-2"> <Button onClick={handleSaveTranscriptEdit} variant="default" size="sm"><Save className="mr-2 h-4 w-4" /> Save</Button> <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm">Cancel</Button> </div> )}
                         </div>
                         <div className="flex flex-col min-h-[300px] h-[50vh]">
                            {/* FIX: Pass props individually */}
                            <Transcription
                                session={derivedSession}
                                isEditing={isEditingTranscript}
                                editTranscriptContent={editTranscriptContent}
                                onContentChange={setEditTranscriptContent}
                                onEditToggle={handleEditTranscriptToggle} // Keep these if needed
                                onSave={handleSaveTranscriptEdit}         // Keep these if needed
                             />
                         </div>
                    </div>
                    {/* Chat Section */}
                    {activeChatId !== null && (
                         /* Ensure ref is assigned correctly */
                        <div ref={chatRef} className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col min-h-[70vh]">
                            <ChatInterface />
                        </div>
                    )}
                     {derivedSession.chats?.length === 0 && (
                         <div className="text-center text-gray-500 italic py-6"> No chats have been started for this session yet. </div>
                     )}
                     {derivedSession.chats?.length > 0 && activeChatId === null && (
                           /* Ensure ref is assigned correctly */
                          <div ref={chatRef} className="text-center text-gray-500 italic py-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                              Select a chat from the sidebar to view it.
                          </div>
                     )}
                </div>
            </div>
        </div>
    );
}
