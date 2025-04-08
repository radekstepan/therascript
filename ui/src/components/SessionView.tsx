import React, { useState, useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from './ui/Dialog'; // Import Dialog
import { Input } from './ui/Input'; // Import Input
import { Label } from './ui/Label'; // Import Label
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select'; // Import Select
import { Loader2, ArrowLeft, User, CalendarDays, Tag, BookMarked, Edit, Save, X } from './icons/Icons'; // Re-add Edit, Save, X

// Sidebar
import { SessionSidebar } from './SessionView/SessionSidebar';

// Constants, Types
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import type { Session, ChatSession } from '../types';
import { cn } from '../utils'; // Keep cn import if used elsewhere

// Atoms
import {
pastSessionsAtom,
activeSessionIdAtom,
activeChatIdAtom,
activeSessionAtom,
chatErrorAtom,
updateSessionMetadataAtom, // Need this atom
saveTranscriptAtom,
} from '../store';

// Sub-components
import { Transcription } from './SessionView/Transcription';
import { ChatInterface } from './SessionView/ChatInterface';
import { getBadgeClasses } from '../helpers'; // Import shared helper

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

// --- Re-introduce State for Editing Details ---
const [isEditingMetadata, setIsEditingMetadata] = useState(false); // Controls the modal
const [editClientName, setEditClientName] = useState('');
const [editSessionName, setEditSessionName] = useState(''); // Renamed for clarity
const [editDate, setEditDate] = useState('');
const [editType, setEditType] = useState('');
const [editTherapy, setEditTherapy] = useState('');
// --- Transcript State ---
// Remove isEditingTranscript state for overall edit
const [editTranscriptContent, setEditTranscriptContent] = useState('');
const [isLoading, setIsLoading] = useState(true);

const scrollContainerRef = useRef<HTMLDivElement | null>(null);

// --- Effect to Sync Session ID and Chat ID (Keep as is) ---
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
        const expectedPath = `/sessions/${currentSessionIdNum}/chats/${targetChatId}`;
         if (location.pathname !== expectedPath) {
            navigate(expectedPath, { replace: true });
         }
    } else if (isNaN(targetChatId)) {
         targetChatId = NaN;
    }

    setActiveChatId(isNaN(targetChatId) ? null : targetChatId);
    setChatError('');
    setIsLoading(false);
}, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setChatError, location.pathname]);


// --- Effect to Initialize Local Edit State (Keep transcript, add details for modal) ---
useEffect(() => {
    if (derivedSession) {
        // Initialize transcript edit state
        setEditTranscriptContent(derivedSession.transcription || ''); // Initialize content directly
        // Initialize details edit state (used when modal opens)
        setEditClientName(derivedSession.clientName || '');
        setEditSessionName(derivedSession.sessionName || derivedSession.fileName || '');
        setEditDate(derivedSession.date || '');
        setEditType(derivedSession.sessionType || SESSION_TYPES[0]); // Default if undefined
        setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);   // Default if undefined
    }
}, [derivedSession]); // Only depend on derivedSession now

// --- Handlers ---

// Handler to open the Edit Details modal and initialize state
const handleOpenEditMetadataModal = () => {
    if (derivedSession) {
        // Ensure state is fresh when opening modal
        setEditClientName(derivedSession.clientName || '');
        setEditSessionName(derivedSession.sessionName || derivedSession.fileName || '');
        setEditDate(derivedSession.date || '');
        setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
        setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        setIsEditingMetadata(true); // Open the modal
    }
};

// Handler to close the Edit Details modal
 const handleCloseEditMetadataModal = () => {
    setIsEditingMetadata(false);
    // No need to reset state here, it's reset on open
};

// Re-introduce handler to save metadata changes (from modal)
const handleSaveMetadataEdit = () => {
    if (!derivedSession) return;
    const trimmedName = editSessionName.trim(); // Use correct state variable
    const trimmedClient = editClientName.trim();

    if (!trimmedName || !trimmedClient || !editDate) {
        alert("Please ensure Session Name, Client Name, and Date are filled.");
        return; // Keep modal open if validation fails
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
    setIsEditingMetadata(false); // Close modal on success
};

// This handler updates the state when a paragraph is saved in Transcription.tsx
const handleTranscriptContentChange = (newContent: string) => {
    if (!derivedSession) return;
    saveTranscriptAction({
        sessionId: derivedSession.id,
        transcript: newContent // Use the content passed up from the component
    });
     setEditTranscriptContent(newContent); // Also update local state if needed for consistency
}

const handleNavigateBack = () => navigate('/'); // Keep this

// Modified helper to render details, handling badges for type/therapy
const renderHeaderDetail = (
    IconComponent: React.ElementType,
    value: string | undefined,
    label: string,
    category?: 'session' | 'therapy' // Add category for badge styling
) => {
    if (!value) return null;

    // Use badge style if category is provided
    const isBadge = category === 'session' || category === 'therapy';
    // Use the imported getBadgeClasses function
    const badgeClasses = isBadge ? getBadgeClasses(value, category) : '';

    return (
        <div className="flex items-center space-x-1" title={label}>
             <IconComponent className={cn("h-3.5 w-3.5 flex-shrink-0", isBadge ? "text-inherit" : "text-gray-400 dark:text-gray-500")} aria-hidden="true" />
             <span className={cn("text-xs capitalize", isBadge ? badgeClasses : "text-gray-600 dark:text-gray-400")}>
                 {/* Don't double-capitalize if it's already a badge */}
                 {isBadge ? value : value}
             </span>
         </div>
    );
};


// --- Render Logic ---
if (isLoading) {
    return ( <div className="flex-grow flex items-center justify-center text-center p-10"> <Card className="max-w-sm mx-auto p-6"> <div className="flex justify-center mb-4"> <Loader2 className="h-8 w-8 animate-spin text-gray-400 dark:text-gray-500" /> </div> <p className="text-gray-600 dark:text-gray-300">Loading session data...</p> <Button onClick={handleNavigateBack} variant="secondary" className="mt-6 w-full"> Go Back </Button> </Card> </div> );
}
if (!derivedSession) { return <Navigate to="/" replace />; }

return (
    // Main flex container for sidebar + content
    <div className="flex flex-grow min-h-0 items-stretch">
        <SessionSidebar />

        {/* Main Content Area */}
        <main ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-gray-100 dark:bg-gray-950">

            {/* Sticky Header - Now includes details with badges and Edit button */}
             <div className="sticky top-0 z-10 flex-shrink-0 p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm flex items-center justify-between gap-4">
                 {/* Back Button */}
                 <div className="flex-shrink-0">
                     <Button onClick={handleNavigateBack} variant="ghost" size="sm" icon={ArrowLeft} className="text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                         Back
                     </Button>
                 </div>

                 {/* Central Area: Session Name + Details */}
                 <div className="flex flex-col items-center text-center overflow-hidden flex-grow min-w-0 px-2">
                    <span className="truncate font-semibold text-sm text-gray-800 dark:text-gray-200" title={derivedSession.sessionName || derivedSession.fileName}>
                        {derivedSession.sessionName || derivedSession.fileName}
                    </span>
                    {/* Details Row - using helper with category for badges */}
                    <div className="flex items-center flex-wrap justify-center gap-x-3 gap-y-1 mt-1">
                        {renderHeaderDetail(User, derivedSession.clientName, "Client")}
                        {renderHeaderDetail(CalendarDays, derivedSession.date, "Date")}
                        {renderHeaderDetail(Tag, derivedSession.sessionType, "Session Type", 'session')} {/* Pass category */}
                        {renderHeaderDetail(BookMarked, derivedSession.therapy, "Therapy Type", 'therapy')} {/* Pass category */}
                    </div>
                 </div>

                  {/* Right Action Area */}
                  <div className="flex-shrink-0">
                     <Button variant="secondary" size="sm" onClick={handleOpenEditMetadataModal} icon={Edit}>
                        Edit Details
                    </Button>
                  </div>
             </div>

            {/* Content Wrapper: Takes remaining space, defines flex context for panels */}
            <div className="p-4 md:p-6 lg:p-8 flex-grow flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0 min-h-0">

                {/* Left Panel (Transcript only now) */}
                <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0">

                    {/* Transcription Section - Needs to grow */}
                    <Card className="flex flex-col flex-grow min-h-0">
                         {/* Remove Edit/Save/Cancel buttons for overall transcript */}
                        <CardHeader className="mb-0 pb-2 flex-shrink-0">
                            <h3 className="text-lg font-semibold">Transcription</h3>
                        </CardHeader>
                        <hr className="my-4 border-gray-200 dark:border-gray-700 flex-shrink-0" />
                        <CardContent className="pt-2 flex flex-col flex-grow min-h-0">
                            <Transcription
                                session={derivedSession}
                                // isEditingOverall={false} // REMOVED - Prop no longer exists
                                editTranscriptContent={editTranscriptContent} // Pass current content
                                onContentChange={handleTranscriptContentChange} // Pass handler to update state/atom
                            />
                        </CardContent>
                    </Card>
                </div> {/* End Left Panel */}


                {/* Right Panel (Chat) */}
                <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0">
                    {/* Chat Section */}
                     {activeChatId !== null ? (
                         <Card className="flex flex-col flex-grow min-h-0 p-0">
                            <ChatInterface />
                         </Card>
                    ) : derivedSession.chats && derivedSession.chats.length > 0 ? (
                        <Card className="flex flex-grow items-center justify-center text-center italic min-h-0">
                            <p className="text-gray-500 dark:text-gray-400">
                            Select a chat from the sidebar to view it.
                            </p>
                        </Card>
                    ) : (
                        <Card className="flex flex-grow items-center justify-center text-center italic min-h-0">
                            <p className="text-gray-500 dark:text-gray-400">
                            No chats have been started for this session yet.
                            </p>
                        </Card>
                    )}
                </div> {/* End Right Panel */}

            </div> {/* End Content Wrapper */}
        </main> {/* End Main Content Area */}

        {/* Edit Details Modal */}
        <Dialog open={isEditingMetadata} onOpenChange={setIsEditingMetadata}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>Edit Session Details</DialogTitle>
                    {/* Optional: <DialogDescription>Make changes to the session metadata.</DialogDescription> */}
                </DialogHeader>
                {/* Form Grid */}
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                         <Label htmlFor="sessionNameEdit" className="text-right">Session Name</Label>
                         <Input id="sessionNameEdit" value={editSessionName} onChange={(e) => setEditSessionName(e.target.value)} className="col-span-3" placeholder="e.g., Weekly Check-in" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="clientNameEdit" className="text-right">Client Name</Label>
                        <Input id="clientNameEdit" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} className="col-span-3" placeholder="Client's Full Name"/>
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sessionDateEdit" className="text-right">Date</Label>
                        {/* Standard date input, styled via global.css */}
                        <input id="sessionDateEdit" type="date" value={editDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditDate(e.target.value)} required className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sessionTypeEdit" className="text-right">Session Type</Label>
                        <Select value={editType} onValueChange={setEditType}>
                            <SelectTrigger id="sessionTypeEdit" className="col-span-3">
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {SESSION_TYPES.map(type => (
                                    <SelectItem key={type} value={type}>
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                     <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="therapyTypeEdit" className="text-right">Therapy Type</Label>
                        <Select value={editTherapy} onValueChange={setEditTherapy}>
                            <SelectTrigger id="therapyTypeEdit" className="col-span-3">
                                 <SelectValue placeholder="Select therapy..." />
                            </SelectTrigger>
                            <SelectContent>
                                {THERAPY_TYPES.map(type => ( <SelectItem key={type} value={type}>{type}</SelectItem> ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                <DialogFooter>
                    {/* Use DialogClose for the Cancel button for better accessibility */}
                    <DialogClose asChild>
                         <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleSaveMetadataEdit}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

    </div> // End Outer Flex Container
);
}
