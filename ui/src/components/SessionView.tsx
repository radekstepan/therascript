import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

// Import UI Components
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
import { ScrollArea } from './ui/ScrollArea';
import { Textarea } from './ui/Textarea';
// Import Icons
import {
    ArrowLeft, Edit, Save, User, CalendarDays, Tag, BookMarked,
    FileText, MessageSquare, Bot, Loader2, List, Star,
    PlusCircle, Check, X
} from './icons/Icons';
// Import Other Components
import { StarredTemplatesList } from './StarredTemplates';
// Import Constants
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { formatTimestamp } from '../helpers';
// Import Types
import type { ChatMessage, ChatSession } from '../types';
// Import Atoms
import {
    activeSessionAtom, // Read the active session object
    activeChatIdAtom, // Read/Set the active chat ID
    activeChatAtom, // Read the active chat object
    currentChatMessagesAtom, // Read messages for the active chat
    currentQueryAtom, // Read/Set the chat input query
    isChattingAtom, // Read chat loading state
    chatErrorAtom, // Read chat error state
    starredMessagesAtom, // Read global starred messages
    navigateBackAtom, // Action atom
    updateSessionMetadataAtom, // Action atom
    saveTranscriptAtom, // Action atom
    starMessageAtom, // Action atom
    startNewChatAtom, // Action atom
    renameChatAtom, // Action atom
    handleChatSubmitAtom, // Action atom for chat submission
} from '../store'; // Adjust path

// SessionViewProps is no longer needed

export function SessionView() { // Removed props
    // Read state from Jotai atoms
    const session = useAtomValue(activeSessionAtom);
    const [activeChatId, setActiveChatId] = useAtom(activeChatIdAtom); // Need setter for switching past chats
    const activeChat = useAtomValue(activeChatAtom);
    const chatMessages = useAtomValue(currentChatMessagesAtom);
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const chatError = useAtomValue(chatErrorAtom);
    const starredMessages = useAtomValue(starredMessagesAtom); // Global list

    // Get setter functions for Jotai actions
    const navigateBack = useSetAtom(navigateBackAtom);
    const updateMetadata = useSetAtom(updateSessionMetadataAtom);
    const saveTranscript = useSetAtom(saveTranscriptAtom);
    const starMessage = useSetAtom(starMessageAtom);
    const startNewChat = useSetAtom(startNewChatAtom);
    const renameChat = useSetAtom(renameChatAtom);
    const handleChatSubmit = useSetAtom(handleChatSubmitAtom);

    const chatScrollRef = useRef<HTMLDivElement>(null);

    // --- Local UI State (useState remains appropriate here) ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [showTemplates, setShowTemplates] = useState(false);
    const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
    const [editChatName, setEditChatName] = useState('');

    // --- Effects ---
    // Initialize local edit fields when session changes or editing starts/stops
    useEffect(() => {
        if (session && !isEditingMetadata) {
            setEditClientName(session.clientName || '');
            setEditName(session.sessionName || session.fileName || ''); // Use fileName as fallback
            setEditDate(session.date || '');
            setEditType(session.sessionType || SESSION_TYPES[0]);
            setEditTherapy(session.therapy || THERAPY_TYPES[0]);
        }
         // Reset if session becomes null (e.g., navigating back unexpectedly)
        if (!session) {
            setIsEditingMetadata(false);
        }
    }, [session, isEditingMetadata]);

    useEffect(() => {
        if (session && !isEditingTranscript) {
            setEditTranscriptContent(session.transcription || '');
        }
         // Reset if session becomes null
        if (!session) {
             setIsEditingTranscript(false);
         }
    }, [session, isEditingTranscript]);

    // Scroll chat to bottom when messages change
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages]); // Depend on the derived chatMessages atom value

    // Reset renaming state and hide templates when the active chat changes
     useEffect(() => {
         setRenamingChatId(null);
         setEditChatName('');
         setShowTemplates(false);
     }, [activeChatId]); // Depend directly on activeChatIdAtom's value

    // --- Handlers ---
    const handleEditMetadataToggle = () => {
        setIsEditingMetadata(prev => !prev);
        // Resetting fields on cancel is handled by the useEffect above
    };

    const handleSaveMetadataEdit = () => {
        if (!editClientName.trim() || !editName.trim() || !editDate || !editType || !editTherapy) {
            alert("Please fill all metadata fields before saving.");
            return;
        }
        if (session) {
            // Call the Jotai action atom
            updateMetadata({
                sessionId: session.id,
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
        // Resetting fields on cancel is handled by the useEffect above
    };

    const handleSaveTranscriptEdit = () => {
        if (session) {
            // Call the Jotai action atom
            saveTranscript({ sessionId: session.id, transcript: editTranscriptContent });
            setIsEditingTranscript(false);
        }
    };

    // Handler to switch active chat (directly set the activeChatIdAtom)
    const handleSelectChatHistory = (chatId: number) => {
        if (chatId !== activeChatId) {
            setActiveChatId(chatId);
            // Renaming state reset is handled by useEffect watching activeChatId
        }
    };

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text); // Directly use setter from useAtom
        setShowTemplates(false);
    };

    const handleStarClick = (message: ChatMessage) => {
        if (activeChatId !== null) {
            // Call the Jotai action atom
            starMessage({
                chatId: activeChatId,
                messageId: message.id,
                shouldStar: !message.starred // Toggle starred status
            });
        } else {
            console.warn("Cannot star message: No active chat selected.");
        }
    };

    // Local UI state handlers for renaming
    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChatId(chat.id);
        setEditChatName(chat.name || '');
    };

    const handleCancelRename = () => {
        setRenamingChatId(null);
        setEditChatName('');
    };

    const handleSaveRename = () => {
        if (renamingChatId !== null && session) {
            const trimmedName = editChatName.trim();
            // Allow saving if name is non-empty OR if clearing an existing name
            if (trimmedName || activeChat?.name) { // Check current activeChat derived atom
                // Call the Jotai action atom
                renameChat({ chatId: renamingChatId, newName: trimmedName });
            }
        }
        setRenamingChatId(null);
        setEditChatName('');
    };

    // Trigger the Jotai action atom for starting a new chat
    const handleNewChatClick = () => {
        // Confirmation logic could be added here if needed
        startNewChat(); // No arguments needed as it reads activeSessionId internally
    };

     // --- Submit Handler ---
     // Uses the handleChatSubmitAtom. The form calls this directly.
     const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
         e.preventDefault();
         handleChatSubmit(); // Call the action atom setter
     };


    // --- Render Logic ---
    if (!session) {
        // This can happen briefly during navigation or if ID is invalid
        return (
            <div className="text-center text-gray-600 p-10">
                <Loader2 className="mx-auto h-8 w-8 animate-spin mb-4" />
                <p>Loading session data...</p>
                {/* Provide a way back if stuck */}
                <Button onClick={navigateBack} variant="outline" className="mt-4">
                    Go Back
                </Button>
            </div>
        );
    }

    // Sort chats consistently
    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    // Determine chat title
    const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
        if (!chat) return 'No Chat Selected';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };
    const activeChatTitle = getChatDisplayTitle(activeChat); // Use derived activeChat atom

    // --- RETURN JSX ---
    return (
        <div className="w-full max-w-7xl mx-auto flex-grow flex flex-col space-y-4 min-h-0">
             {/* Header Row */}
             <div className="flex-shrink-0 flex justify-between items-center">
                 <Button onClick={navigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Sessions
                 </Button>
                 {/* Metadata Edit Controls (using local state) */}
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

                {/* Left Column: Details & Transcript */}
                <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                     {/* Session Metadata Card */}
                     <Card className="flex-shrink-0">
                         <CardHeader className="border-b">
                             <CardTitle className="flex items-center">
                                 Details: {/* Note: Fixed space typo */}
                                 {isEditingMetadata ? (
                                     <Input
                                        value={editName}
                                        onChange={(e: any) => setEditName(e.target.value)}
                                        placeholder="Session Name"
                                        className="text-lg font-semibold leading-none tracking-tight h-9 inline-block w-auto ml-1 flex-grow"
                                    />
                                ) : (
                                    <span className="ml-1">{session.sessionName || session.fileName}</span>
                                )}
                            </CardTitle>
                         </CardHeader>
                         <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-4 text-sm">
                             {/* Fields using local state for editing, session data for display */}
                             <div className="flex items-center space-x-2">
                                 <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="clientNameEditView" className="w-16 flex-shrink-0">Client:</Label>
                                 {isEditingMetadata ? (
                                    <Input id="clientNameEditView" value={editClientName} onChange={(e: any) => setEditClientName(e.target.value)} placeholder="Client Name" className="text-sm h-8 flex-grow"/>
                                 ) : ( <span className="font-medium">{session.clientName || 'N/A'}</span> )}
                            </div>
                            <div className="flex items-center space-x-2">
                                 <CalendarDays className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="sessionDateEditView" className="w-16 flex-shrink-0">Date:</Label>
                                {isEditingMetadata ? (
                                    <Input id="sessionDateEditView" type="date" value={editDate} onChange={(e: any) => setEditDate(e.target.value)} className="text-sm h-8 flex-grow"/>
                                ) : ( <span className="font-medium">{session.date || 'N/A'}</span> )}
                            </div>
                            <div className="flex items-center space-x-2">
                                 <Tag className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="sessionTypeEditView" className="w-16 flex-shrink-0">Type:</Label>
                                {isEditingMetadata ? (
                                     <Select id="sessionTypeEditView" value={editType} onChange={(e: any) => setEditType(e.target.value)} className="text-sm h-8 flex-grow">
                                        {SESSION_TYPES.map(type => ( <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium capitalize">{session.sessionType || 'N/A'}</span> )}
                            </div>
                             <div className="flex items-center space-x-2">
                                 <BookMarked className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="therapyEditView" className="w-16 flex-shrink-0">Therapy:</Label>
                                {isEditingMetadata ? (
                                     <Select id="therapyEditView" value={editTherapy} onChange={(e: any) => setEditTherapy(e.target.value)} className="text-sm h-8 flex-grow">
                                        {THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium">{session.therapy || 'N/A'}</span> )}
                            </div>
                            {session.fileName && !isEditingMetadata && (
                                 <div className="flex items-center space-x-2 text-xs text-gray-400 pt-1 md:col-span-2">
                                    <FileText className="h-3 w-3" />
                                    <span>Original file: {session.fileName}</span>
                                </div>
                            )}
                         </CardContent>
                     </Card>

                     {/* Transcription Card */}
                     <Card className="flex-grow flex flex-col min-h-0">
                         <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between border-b">
                            <CardTitle>Transcription</CardTitle>
                            {/* Transcript Edit Controls (using local state) */}
                             <div className="space-x-2">
                                {!isEditingTranscript ? (
                                    <Button onClick={handleEditTranscriptToggle} variant="outline" size="sm"><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                                ) : (
                                    <>
                                        <Button onClick={handleSaveTranscriptEdit} variant="default" size="sm"><Save className="mr-2 h-4 w-4" /> Save</Button>
                                        <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm">Cancel</Button>
                                    </>
                                )}
                            </div>
                         </CardHeader>
                         <CardContent className="flex-grow pt-4 flex flex-col min-h-0">
                            {isEditingTranscript ? (
                                 <Textarea
                                    value={editTranscriptContent} // local state
                                    onChange={(e: any) => setEditTranscriptContent(e.target.value)} // local state
                                    className="flex-grow w-full whitespace-pre-wrap text-sm font-mono"
                                    placeholder="Enter or paste transcription here..."
                                />
                            ) : (
                                <ScrollArea className="flex-grow border rounded-md">
                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 p-3 font-mono">
                                        {session.transcription || <span className="italic text-gray-500">No transcription available.</span>}
                                    </pre>
                                 </ScrollArea>
                            )}
                         </CardContent>
                    </Card>
                </div> {/* End Left Column */}

                 {/* Right Column: Chat Interface + History List */}
                 <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                     <Card className="flex-grow flex flex-col min-h-0">
                         {/* Chat Header */}
                         <CardHeader className="flex-shrink-0 flex flex-row justify-between items-center border-b gap-2">
                             {/* Title/Rename Section */}
                             <div className="flex items-center gap-2 flex-grow min-w-0">
                                <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                {renamingChatId === activeChatId && activeChat ? (
                                    // Rename Mode (using local state)
                                    <>
                                        <Input
                                            value={editChatName} // local state
                                            onChange={(e: any) => setEditChatName(e.target.value)} // local state
                                            placeholder="Enter new chat name"
                                            className="h-8 text-sm flex-grow" autoFocus
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                                        />
                                        <Button onClick={handleSaveRename} variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-100" title="Save Name"><Check size={18} /></Button>
                                        <Button onClick={handleCancelRename} variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-100" title="Cancel Rename"><X size={18} /></Button>
                                    </>
                                ) : (
                                    // Display Mode
                                    <div className="flex items-center gap-1 min-w-0">
                                         <CardTitle className="truncate" title={activeChatTitle}>
                                             {activeChatTitle}
                                         </CardTitle>
                                         {/* Edit button triggers local rename state */}
                                         {activeChat && (
                                             <Button onClick={() => handleRenameClick(activeChat)} variant="ghost" size="icon" className="h-6 w-6 ml-1 text-gray-500 hover:text-blue-600 flex-shrink-0" title="Rename Chat">
                                                 <Edit size={14} />
                                             </Button>
                                         )}
                                     </div>
                                )}
                            </div>
                             {/* New Chat Button (triggers Jotai action) */}
                             <Button onClick={handleNewChatClick} variant="outline" size="sm" className="flex-shrink-0">
                                 <PlusCircle className="mr-1 h-4 w-4" /> New Chat
                             </Button>
                         </CardHeader>

                         {/* Chat Content: Messages + Input */}
                         <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4">
                             {/* Chat Messages Area */}
                             <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}>
                                 <div className="space-y-3 p-3">
                                     {/* Display messages read from currentChatMessagesAtom */}
                                     {chatMessages.length === 0 && activeChatId === null && (
                                        <p className="text-center text-gray-500 italic py-4">Start a new chat or select one from the list below.</p>
                                     )}
                                     {chatMessages.length === 0 && activeChatId !== null && (
                                        <p className="text-center text-gray-500 italic py-4">No messages in this chat yet. Start typing below.</p>
                                     )}
                                    {chatMessages.map((msg) => (
                                        <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                                            {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}
                                            <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words shadow-sm ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                                {/* Star button triggers local handler -> Jotai action */}
                                                {msg.sender === 'user' && (
                                                     <Button
                                                         variant="ghost" size="icon"
                                                         className="absolute -left-9 top-0 h-6 w-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500"
                                                         title={msg.starred ? "Unstar message" : "Star message as template"}
                                                         onClick={() => handleStarClick(msg)}
                                                         aria-label={msg.starred ? "Unstar message" : "Star message"}
                                                     >
                                                         <Star size={14} filled={!!msg.starred} className={msg.starred ? "text-yellow-500" : ""} />
                                                     </Button>
                                                 )}
                                                {msg.text}
                                            </div>
                                            {msg.sender === 'user' && <User className="h-5 w-5 text-gray-500 flex-shrink-0 mt-1" />}
                                        </div>
                                    ))}
                                    {/* Display loading state read from isChattingAtom */}
                                    {isChatting && (
                                        <div className="flex items-start space-x-2">
                                            <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                                            <div className="rounded-lg p-2 px-3 text-sm bg-gray-200 text-gray-800 italic flex items-center">
                                                <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                                            </div>
                                        </div>
                                    )}
                                </div>
                             </ScrollArea>

                            {/* Chat Input Form */}
                            {/* Form submission triggers the onSubmit -> handleChatSubmitAtom */}
                            <form onSubmit={onSubmit} className="relative flex space-x-2 flex-shrink-0 pt-2 border-t">
                                 {/* Starred Templates (uses local state for popover visibility) */}
                                 <div className="relative">
                                     <Button
                                        type="button" variant="outline" size="icon"
                                        className="h-10 w-10 flex-shrink-0"
                                        title="Show Starred Templates"
                                        onClick={() => setShowTemplates(prev => !prev)}
                                        aria-label="Show starred templates"
                                    >
                                        <Star size={18} />
                                    </Button>
                                    {showTemplates && (
                                        // StarredTemplatesList now reads atom internally
                                        <StarredTemplatesList
                                            onSelectTemplate={handleSelectTemplate}
                                            onClose={() => setShowTemplates(false)}
                                        />
                                    )}
                                 </div>

                                {/* Text Input (binds to currentQueryAtom) */}
                                <Input
                                    type="text"
                                    placeholder="Ask about the session..."
                                    value={currentQuery}
                                    onChange={(e: any) => setCurrentQuery(e.target.value)}
                                    disabled={isChatting || activeChatId === null} // Use isChattingAtom value
                                    className="flex-grow"
                                    aria-label="Chat input message"
                                />
                                {/* Send Button */}
                                <Button type="submit" disabled={isChatting || !currentQuery.trim() || activeChatId === null}>
                                     Send
                                </Button>
                            </form>
                             {/* Chat Error Message (read from chatErrorAtom) */}
                             {chatError && (
                                <p className="text-sm text-red-600 text-center flex-shrink-0 mt-1">
                                    {chatError}
                                </p>
                             )}
                         </CardContent>
                     </Card>

                     {/* Past Chats List */}
                     {sortedChats.filter(c => c.id !== activeChatId).length > 0 && (
                        <Card className="flex-shrink-0">
                             <CardHeader className="pb-2 pt-3 border-b">
                                 <CardTitle className="text-base flex items-center"><List className="mr-2 h-4 w-4 text-gray-500"/> Past Chats</CardTitle>
                             </CardHeader>
                             <CardContent className="p-2 max-h-36 overflow-y-auto">
                                 <ul className="space-y-1">
                                     {sortedChats
                                         .filter(chat => chat.id !== activeChatId)
                                         .map(chat => (
                                             <li key={chat.id} className="flex items-center justify-between p-1.5 hover:bg-gray-100 rounded-md">
                                                  <span className="text-sm text-gray-700 truncate mr-2" title={getChatDisplayTitle(chat)}>
                                                      {getChatDisplayTitle(chat)}
                                                  </span>
                                                  {/* Switch button triggers local handler -> sets activeChatIdAtom */}
                                                  <Button
                                                      variant="ghost" size="sm"
                                                      className="text-xs h-7 px-2 flex-shrink-0"
                                                      onClick={() => handleSelectChatHistory(chat.id)}
                                                      title={`Switch to: ${getChatDisplayTitle(chat)}`}
                                                  >
                                                     Switch
                                                  </Button>
                                             </li>
                                         ))
                                     }
                                 </ul>
                             </CardContent>
                         </Card>
                     )}

                 </div> {/* End Right Column */}
            </div> {/* End Main Content Flex Container */}
        </div> // End Overall View Container
    );
}
