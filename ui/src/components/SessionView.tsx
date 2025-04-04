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
import { Transcription } from './SessionView/Transcription'; // Updated component
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
    const [isEditingTranscript, setIsEditingTranscript] = useState(false); // Controls overall transcript edit state
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Refs for scrolling - Ensure standard initialization
    const detailsRef = useRef<HTMLDivElement | null>(null);
    const transcriptRef = useRef<HTMLDivElement | null>(null);
    const chatRef = useRef<HTMLDivElement | null>(null);
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
                // Navigate to base session URL if specific chat is invalid
                navigate(`/sessions/${currentSessionIdNum}`, { replace: true });
                targetChatId = NaN; // Ensure it's reset
            }
        }
        // If no chat ID in URL or it was invalid, try finding the latest chat
        if (isNaN(targetChatId) && chats.length > 0) {
            targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
            // Update URL only if it doesn't already match the default target
             if (location.pathname !== `/sessions/${currentSessionIdNum}/chats/${targetChatId}`) {
                navigate(`/sessions/${currentSessionIdNum}/chats/${targetChatId}`, { replace: true });
             }
        } else if (isNaN(targetChatId)) {
             targetChatId = NaN; // Explicitly NaN if no chats exist
        }

        setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
        setChatError(''); // Clear chat errors on navigation
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
        // Explicitly exit edit mode if session changes or is null
        if (!derivedSession || !isEditingMetadata) { setIsEditingMetadata(false); }
    }, [derivedSession, isEditingMetadata]); // Rerun if derivedSession changes

    useEffect(() => {
        // Only update editTranscriptContent from derivedSession if not currently editing
        if (derivedSession && !isEditingTranscript) {
            setEditTranscriptContent(derivedSession.transcription || '');
        }
        // Ensure edit mode is off if session changes or is null
        if (!derivedSession || !isEditingTranscript) { setIsEditingTranscript(false); }
    }, [derivedSession, isEditingTranscript]); // Rerun if derivedSession changes

    // --- Handlers ---
    const handleEditMetadataToggle = () => {
         if (!isEditingMetadata && derivedSession) {
             // Entering edit mode - re-initialize state from current session
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
            // Entering edit mode - ensure edit content matches current session transcript
            setEditTranscriptContent(derivedSession.transcription || '');
        }
        setIsEditingTranscript(prev => !prev);
        // Note: Paragraph edit state is handled within Transcription component and resets automatically
    };

    const handleSaveMetadataEdit = () => {
        if (!derivedSession) return;
        const trimmedName = editName.trim();
        const trimmedClient = editClientName.trim();

        // Basic validation (optional)
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

    const scrollToSection = (section: 'details' | 'transcript' | 'chat') => {
        let targetRef: React.RefObject<HTMLDivElement | null> | null = null;
        switch (section) {
            case 'details': targetRef = detailsRef; break;
            case 'transcript': targetRef = transcriptRef; break;
            case 'chat': targetRef = chatRef; break;
        }
        targetRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // --- Render Logic ---
    if (isLoading) {
        return ( <div className="flex-grow flex items-center justify-center text-center text-gray-600 p-10"> <div> <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" /> <p>Loading session data...</p> <Button onClick={handleNavigateBack} variant="outline" className="mt-4"> Go Back </Button> </div> </div> );
    }
    if (!derivedSession) { return <Navigate to="/" replace />; }

    return (
        <div className="flex flex-grow min-h-0">
            {/* Sidebar */}
            <SessionSidebar scrollToSection={scrollToSection} />

            {/* Main Content Area with Scroll */}
            <div ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-gray-50 overflow-y-auto">

                {/* Sticky Header */}
                 <div className="sticky top-0 z-10 flex-shrink-0 flex justify-between items-center p-4 border-b border-gray-200 bg-white shadow-sm">
                     <Button onClick={handleNavigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900 -ml-2">
                         <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sessions
                     </Button>
                     {/* Optional: Add session name here if needed */}
                 </div>

                {/* Scrollable Content */}
                <div className="p-4 md:p-6 lg:p-8 space-y-6">

                     {/* Details Section */}
                    <div ref={detailsRef} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                         <div className="flex justify-between items-center mb-4">
                              <h2 className="text-xl font-semibold">Details</h2>
                              {!isEditingMetadata ? (
                                  <Button onClick={handleEditMetadataToggle} variant="outline" size="sm">
                                      <Edit className="mr-2 h-4 w-4" /> Edit
                                  </Button>
                              ) : (
                                  <div className="space-x-2">
                                      <Button onClick={handleSaveMetadataEdit} variant="default" size="sm">
                                          <Save className="mr-2 h-4 w-4" /> Save
                                      </Button>
                                      <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm">Cancel</Button>
                                  </div>
                              )}
                         </div>
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
                    <div ref={transcriptRef} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 flex flex-col"> {/* Added flex flex-col */}
                         <div className="flex justify-between items-center mb-4 flex-shrink-0"> {/* Added flex-shrink-0 */}
                            <h2 className="text-xl font-semibold">Transcription</h2>
                             {!isEditingTranscript ? (
                                 <Button onClick={handleEditTranscriptToggle} variant="outline" size="sm">
                                     <Edit className="mr-2 h-4 w-4" /> Edit
                                 </Button>
                             ) : (
                                 <div className="space-x-2">
                                     <Button onClick={handleSaveTranscriptEdit} variant="default" size="sm">
                                         <Save className="mr-2 h-4 w-4" /> Save
                                     </Button>
                                     <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm">Cancel</Button>
                                 </div>
                             )}
                         </div>
                         {/* Container for Transcription component to allow it to grow */}
                         <div className="flex flex-col flex-grow min-h-[300px] h-[50vh]"> {/* Use flex-grow */}
                            <Transcription
                                session={derivedSession}
                                isEditingOverall={isEditingTranscript} // *** CORRECTED PROP NAME HERE ***
                                editTranscriptContent={editTranscriptContent}
                                onContentChange={setEditTranscriptContent}
                                // Pass toggle/save if needed by Transcription, though currently unused by it
                                onEditToggle={handleEditTranscriptToggle}
                                onSave={handleSaveTranscriptEdit}
                             />
                         </div>
                    </div>

                    {/* Chat Section */}
                    {/* Conditionally render ChatInterface only if an activeChatId exists */}
                    {activeChatId !== null ? (
                        <div ref={chatRef} className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col min-h-[70vh]">
                            {/* ChatInterface will handle rendering based on activeChatId */}
                            <ChatInterface />
                        </div>
                    ) : derivedSession.chats && derivedSession.chats.length > 0 ? (
                         // If there are chats but none is selected (e.g., base session URL)
                        <div ref={chatRef} className="text-center text-gray-500 italic py-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            Select a chat from the sidebar to view it.
                        </div>
                    ) : (
                         // If there are no chats for this session at all
                        <div ref={chatRef} className="text-center text-gray-500 italic py-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                            No chats have been started for this session yet.
                        </div>
                    )}
                </div> {/* End Scrollable Content */}
            </div> {/* End Main Content Area */}
        </div> // End Outer Flex Container
    );
}
