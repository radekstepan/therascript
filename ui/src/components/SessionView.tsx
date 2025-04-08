import React, { useEffect, useRef, useCallback } from 'react'; // Removed useState
import { useAtomValue, useSetAtom, useAtom } from 'jotai'; // Added useAtom
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './ui/Dialog'; // Import Dialog
import { Input } from './ui/Input'; // Import Input
import { Label } from './ui/Label'; // Import Label
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select'; // Import Select
import {
    ArrowLeftIcon,     // Available
    BookmarkIcon,      // Available
    CalendarIcon,      // Available
    ChatBubbleIcon,    // Import for the button
    Cross1Icon,        // Available (used implicitly by DialogClose)
    Pencil1Icon,       // Available
    PersonIcon,        // Available
    ReloadIcon,        // Available
    BadgeIcon,         // Available (replaces TagIcon)
} from '@radix-ui/react-icons';

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
    updateSessionMetadataAtom,
    saveTranscriptAtom,
    startNewChatAtom, // Import atom to start a chat
    // Sidebar Width Atoms & Constants
    clampedSidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
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
    const startNewChatAction = useSetAtom(startNewChatAtom); // Get the action setter

    // --- Sidebar Resizing State ---
    const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
    const isResizing = useRef(false);
    const sidebarRef = useRef<HTMLDivElement | null>(null);

    // --- State for Editing Details ---
    const [isEditingMetadata, setIsEditingMetadata] = React.useState(false);
    const [editClientName, setEditClientName] = React.useState('');
    const [editSessionName, setEditSessionName] = React.useState('');
    const [editDate, setEditDate] = React.useState('');
    const [editType, setEditType] = React.useState('');
    const [editTherapy, setEditTherapy] = React.useState('');
    // --- Transcript State ---
    const [editTranscriptContent, setEditTranscriptContent] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(true);

    const scrollContainerRef = useRef<HTMLDivElement | null>(null);

    // --- Effect to Sync Session ID and Chat ID --- (remains the same)
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


    // --- Effect to Initialize Local Edit State --- (remains the same)
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

    // --- Start First Chat Handler ---
    const handleStartFirstChat = async () => {
        if (!derivedSession) return;
        const currentSessionId = derivedSession.id;
        const result = await startNewChatAction({ sessionId: currentSessionId });
        if (result.success) {
            navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
        } else {
             setChatError(result.error);
             // Optionally display a more visible error message/toast
             alert(`Error starting chat: ${result.error}`); // Simple alert for now
        }
    };
    // --- End Start First Chat Handler ---


    // Handler to open the Edit Details modal and initialize state (remains the same)
    const handleOpenEditMetadataModal = () => {
      if (derivedSession) {
        setEditClientName(derivedSession.clientName || '');
        setEditSessionName(derivedSession.sessionName || derivedSession.fileName || '');
        setEditDate(derivedSession.date || '');
        setEditType(derivedSession.sessionType || SESSION_TYPES[0]);
        setEditTherapy(derivedSession.therapy || THERAPY_TYPES[0]);
        setIsEditingMetadata(true); // Open the modal
      }
    };

    // Handler to close the Edit Details modal (remains the same)
     const handleCloseEditMetadataModal = () => {
        setIsEditingMetadata(false);
        // No need to reset state here, it's reset on open
    };

    // Re-introduce handler to save metadata changes (from modal) (remains the same)
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

    // This handler updates the state when a paragraph is saved in Transcription.tsx (remains the same)
    const handleTranscriptContentChange = (newContent: string) => {
        if (!derivedSession) return;
        saveTranscriptAction({
            sessionId: derivedSession.id,
            transcript: newContent // Use the content passed up from the component
        });
         setEditTranscriptContent(newContent); // Also update local state if needed for consistency
    }

    const handleNavigateBack = () => navigate('/'); // Keep this

    // Modified helper to render details, handling badges for type/therapy (remains the same)
    const renderHeaderDetail = (
        IconComponent: React.ElementType, // Use ElementType for flexibility
        value: string | undefined,
        label: string,
        category?: 'session' | 'therapy'
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
                     {isBadge ? value : value}
                 </span>
             </div>
        );
    };

    // --- Resizing Handlers --- (remain the same)
    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize'; // Change cursor globally
        document.body.style.userSelect = 'none'; // Prevent text selection
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return; // Need parent context
        let newWidth = e.clientX - containerRect.left;
        setSidebarWidth(newWidth);
    }, [setSidebarWidth]);
    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = ''; // Restore default cursor
            document.body.style.userSelect = ''; // Restore text selection
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        }
    }, [handleMouseMove]);

    // Cleanup listeners if component unmounts while resizing (remains the same)
    useEffect(() => {
        return () => {
            if (isResizing.current) {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            }
        };
    }, [handleMouseMove, handleMouseUp]);


    // --- Render Logic ---
    if (isLoading) {
      return (
        <div className="flex-grow flex items-center justify-center text-center p-10">
          <Card className="max-w-sm mx-auto p-6">
            <div className="flex justify-center mb-4">
              <ReloadIcon className="h-8 w-8 animate-spin text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-gray-600 dark:text-gray-300">Loading session data...</p>
            <Button onClick={handleNavigateBack} variant="secondary" className="mt-6 w-full">Go Back</Button>
          </Card>
        </div>
      );
    }
    if (!derivedSession) { return <Navigate to="/" replace />; }

    // Determine if there are any chats for the current session
    const hasChats = derivedSession.chats && derivedSession.chats.length > 0;

    return (
      <div className="flex flex-grow min-h-0 items-stretch h-screen">
        {/* Sidebar Container - Apply width dynamically */}
        <div
            ref={sidebarRef} // Add ref to the container div
            className="relative flex-shrink-0 hidden lg:flex" // Keep flex-shrink-0
            style={{ width: `${sidebarWidth}px` }} // Use sidebarWidth from atom
        >
          <SessionSidebar />
        </div>

        {/* Resizer Handle */}
         <div
             className="hidden lg:block flex-shrink-0 w-2 cursor-col-resize group"
             onMouseDown={handleMouseDown}
             title="Resize sidebar"
         >
            <div className="h-full w-[1px] bg-gray-200 dark:bg-gray-700 group-hover:bg-blue-500 dark:group-hover:bg-blue-400 transition-colors duration-150 mx-auto"></div>
         </div>


        {/* Main Content Area - Takes remaining space */}
        <main ref={scrollContainerRef} className="flex-grow flex flex-col min-w-0 bg-gray-100 dark:bg-gray-950">
          {/* Sticky Header (remains the same) */}
          <div className="sticky top-0 z-10 flex-shrink-0 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-md flex items-center justify-between gap-6">
            <div className="flex-shrink-0">
              <Button
                onClick={handleNavigateBack}
                variant="ghost"
                size="sm"
                icon={ArrowLeftIcon}
                className="text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 p-1"
              >
                Back
              </Button>
            </div>
            <div className="flex flex-col items-center text-center flex-grow min-w-0 px-4">
              <h1 className="truncate text-lg font-bold text-gray-900 dark:text-gray-100" title={derivedSession.sessionName || derivedSession.fileName}>
                {derivedSession.sessionName || derivedSession.fileName}
              </h1>
              <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-2 bg-gray-50 dark:bg-gray-800/50 rounded-md py-1 px-3">
                {renderHeaderDetail(PersonIcon, derivedSession.clientName, "Client")}
                {renderHeaderDetail(CalendarIcon, derivedSession.date, "Date")}
                {renderHeaderDetail(BadgeIcon, derivedSession.sessionType, "Session Type", 'session')}
                {renderHeaderDetail(BookmarkIcon, derivedSession.therapy, "Therapy Type", 'therapy')}
              </div>
            </div>
            <div className="flex-shrink-0">
              <Button
                variant="secondary"
                size="sm"
                icon={Pencil1Icon}
                onClick={handleOpenEditMetadataModal}
                disabled={!derivedSession}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:hover:bg-blue-900 dark:text-blue-200"
              >
                Edit Details
              </Button>
            </div>
          </div>

          {/* Content Wrapper */}
          <div className="flex flex-col flex-grow min-h-0 lg:flex-row lg:space-x-6 p-4 md:p-6 lg:p-8">
            {/* Left Panel: Transcript (remains the same) */}
            <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0 mb-6 lg:mb-0">
                <Card className="flex flex-col h-full">
                    <CardHeader className="mb-0 pb-2 flex-shrink-0">
                    <h3 className="text-lg font-semibold">Transcription</h3>
                    </CardHeader>
                    <hr className="my-4 border-gray-200 dark:border-gray-700 flex-shrink-0" />
                    <CardContent className="flex-grow overflow-y-auto p-0">
                    <Transcription
                        session={derivedSession}
                        editTranscriptContent={editTranscriptContent}
                        onContentChange={handleTranscriptContentChange}
                    />
                    </CardContent>
                </Card>
            </div>

            {/* Right Panel: Chat */}
            <div className="flex flex-col lg:w-1/2 lg:flex-shrink-0 min-h-0">
              {activeChatId !== null ? (
                // --- Render Chat Interface if a chat is active ---
                <Card className="flex flex-col h-full p-0">
                  <ChatInterface />
                </Card>
              ) : hasChats ? (
                // --- Render "Select Chat" message if chats exist but none are active ---
                <Card className="flex flex-grow items-center justify-center text-center italic h-full">
                  <p className="text-gray-500 dark:text-gray-400">Select a chat from the sidebar to view it.</p>
                </Card>
              ) : (
                // --- Render "Start Chat" button if NO chats exist for this session ---
                <Card className="flex flex-col flex-grow items-center justify-center text-center h-full p-6">
                    <ChatBubbleIcon className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-4" />
                    <p className="text-gray-600 dark:text-gray-400 mb-6">
                        No chats have been started for this session yet.
                    </p>
                    <Button
                        onClick={handleStartFirstChat}
                        variant="secondary" // Or "default" if you want it more prominent
                        size="sm"
                        icon={ChatBubbleIcon} // Optional: use a specific icon like PlusCircledIcon
                    >
                        Start New Chat
                    </Button>
                </Card>
              )}
            </div>
          </div>
        </main>

        {/* Edit Details Modal (remains the same) */}
        <Dialog open={isEditingMetadata} onOpenChange={setIsEditingMetadata}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>Edit Session Details</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Form fields remain the same */}
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
                                    <SelectItem key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</SelectItem>
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
                    <DialogClose asChild>
                         <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleSaveMetadataEdit}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

      </div>
    );
}