import React, { useState, useEffect, useRef, useCallback } from 'react';
// Import UI Components
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
// Remove Select import if no longer needed elsewhere
import { Select } from './ui/Select';
import { ScrollArea } from './ui/ScrollArea';
import { Textarea } from './ui/Textarea';
// Import Icons
import {
    ArrowLeft, Edit, Save, User, CalendarDays, Tag, BookMarked,
    FileText, MessageSquare, Bot, Loader2, List, Star,
    PlusCircle, Check, X // Add PlusCircle, Check, X
} from './icons/Icons';
// Import Other Components
import { StarredTemplatesList } from './StarredTemplates';
// Import Constants, Helpers, Types
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { formatTimestamp } from '../helpers';
// Make sure SessionViewProps includes the new handlers
import type { Session, ChatMessage, ChatSession, SessionViewProps } from '../types';

export function SessionView({
    sessionId,
    activeChatId,
    setActiveChatIdHandler,
    pastSessions,
    navigateBack,
    chatHandlers,
    onSaveMetadata,
    onSaveTranscript,
    starredMessages,
    onStarMessage,
    // Receive new handlers
    onStartNewChat,
    onRenameChat
}: SessionViewProps) {
    const session = pastSessions.find(s => s.id === sessionId);
    const chatScrollRef = useRef<HTMLDivElement>(null);

    // --- State ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');
    const [showTemplates, setShowTemplates] = useState(false);

    // --- NEW: State for Chat Renaming ---
    const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
    const [editChatName, setEditChatName] = useState('');

    // --- Effects ---
    // Initialize metadata edit fields when session changes or editing starts
    useEffect(() => {
        if (session) {
            setEditClientName(session.clientName || '');
            setEditName(session.sessionName || '');
            setEditDate(session.date || '');
            setEditType(session.sessionType || SESSION_TYPES[0]); // Default if empty
            setEditTherapy(session.therapy || THERAPY_TYPES[0]); // Default if empty
        }
    }, [session, isEditingMetadata]); // Re-run only when session or editing mode changes

    // Initialize transcript edit field
     useEffect(() => {
         // Initialize or reset transcript content when session changes OR when editing *stops*
        if (session && !isEditingTranscript) {
            setEditTranscriptContent(session.transcription || '');
        }
         // Note: When editing starts, we *don't* want to reset from session here,
         // allowing the user to continue editing potential unsaved changes.
    }, [session, isEditingTranscript]); // Re-run when session or transcript edit mode changes

     // Effect to scroll chat ScrollArea to the bottom when messages update
    useEffect(() => {
        if (chatScrollRef.current) {
            // Scroll the referenced div to its maximum scroll height
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatHandlers.chatMessages]); // Trigger scroll whenever chatMessages array changes


    // Effect to load messages for the active chat
    useEffect(() => {
        if (session && activeChatId !== null) {
            const currentChat = session.chats?.find(c => c.id === activeChatId);
            chatHandlers.loadChatMessages(currentChat?.messages || []);
            // Reset renaming state when chat changes
            setRenamingChatId(null);
            setEditChatName('');
        } else if (!session || activeChatId === null) {
            // If no session or no chat selected, clear messages
            chatHandlers.loadChatMessages([]);
             // Reset renaming state if no chat is active
            setRenamingChatId(null);
            setEditChatName('');
        }
        // Also hide templates when chat changes
        setShowTemplates(false);
    }, [session, activeChatId, chatHandlers.loadChatMessages]); // Keep loadChatMessages in dependencies


    // --- Handlers ---
    const handleEditMetadataToggle = () => {
        const nextEditingState = !isEditingMetadata;
        setIsEditingMetadata(nextEditingState);
        // If turning OFF edit mode, useEffect handles resetting fields
    };

    const handleSaveMetadataEdit = () => {
        // Basic validation
        if (!editClientName.trim() || !editName.trim() || !editDate || !editType || !editTherapy) {
            alert("Please fill all metadata fields before saving.");
            return;
        }
        if (session) {
            onSaveMetadata(session.id, {
                clientName: editClientName.trim(),
                sessionName: editName.trim(),
                date: editDate,
                sessionType: editType,
                therapy: editTherapy
            });
            setIsEditingMetadata(false); // Exit edit mode on save
        }
    };

    const handleEditTranscriptToggle = () => {
        setIsEditingTranscript(prev => !prev);
        // Resetting content if cancelling is handled by useEffect
    };

    const handleSaveTranscriptEdit = () => {
        if (session) {
            onSaveTranscript(session.id, editTranscriptContent);
            setIsEditingTranscript(false); // Exit edit mode
        }
    };

    // Handler to switch active chat
    const handleSelectChatHistory = (chatId: number) => {
        if (chatId !== activeChatId) {
            setActiveChatIdHandler(chatId);
            // Renaming state is reset by the useEffect watching activeChatId
        }
    };

    const handleSelectTemplate = (text: string) => {
        // Append template text to the current input query
        chatHandlers.setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false); // Hide the template list after selection
    };

     const handleStarClick = (message: ChatMessage) => {
        if (activeChatId !== null) { // Ensure there's an active chat
            onStarMessage(activeChatId, message.id, message.text, !message.starred);
        } else {
            console.warn("Cannot star message: No active chat selected.");
        }
    };

    // --- NEW: Chat Renaming Handlers ---
    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChatId(chat.id);
        setEditChatName(chat.name || ''); // Start edit with current name or empty string
    };

    const handleCancelRename = () => {
        setRenamingChatId(null);
        setEditChatName('');
    };

    const handleSaveRename = () => {
        if (renamingChatId !== null && session) {
            // Prevent renaming to just whitespace
            const trimmedName = editChatName.trim();
             // Allow saving if name is non-empty OR if clearing an existing name
            if (trimmedName || session.chats?.find(c => c.id === renamingChatId)?.name) {
                 onRenameChat(session.id, renamingChatId, trimmedName);
            }
        }
        setRenamingChatId(null); // Exit renaming mode
        setEditChatName('');
    };

    // --- NEW: Start New Chat Trigger ---
    const handleNewChatClick = () => {
        if (session) {
            // Optional: Add confirmation if current chat has unsaved user input?
            // e.g., if(chatHandlers.currentQuery.trim() && !confirm("Start new chat? Current input will be lost.")) return;
            onStartNewChat(session.id);
        }
    };

    // --- Render Logic ---
    // Loading or Error State for Session
    if (!session) {
        // This case should ideally be handled by App.tsx redirecting
        // but provide a fallback message.
        return (
            <div className="text-center text-red-600 p-10">
                <p className="mb-4">Error: Session data could not be loaded.</p>
                <Button onClick={navigateBack} variant="outline">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
                </Button>
            </div>
        );
    }

    const activeChat = session.chats?.find(c => c.id === activeChatId);
    // Sort chats once for consistent ordering (newest first for past list)
    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    // Determine the title for the active chat display
    const getChatDisplayTitle = (chat: ChatSession | undefined): string => {
        if (!chat) return 'No Chat Selected';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };
    const activeChatTitle = getChatDisplayTitle(activeChat);

    return (
        // Main container for the view
        <div className="w-full max-w-7xl mx-auto flex-grow flex flex-col space-y-4 min-h-0"> {/* Increased max-width */}
             {/* Header Row: Back Button & Metadata Edit Controls */}
             <div className="flex-shrink-0 flex justify-between items-center">
                 <Button onClick={navigateBack} variant="ghost" className="text-gray-600 hover:text-gray-900">
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
                            {/* Use toggle function for cancel to reset fields */}
                            <Button onClick={handleEditMetadataToggle} variant="secondary" size="sm">
                                Cancel
                            </Button>
                        </>
                    )}
                </div>
            </div>

             {/* Main Content Area: Two Columns on Large Screens */}
             {/* Use flex-grow and min-h-0 on the container */}
            <div className="flex-grow flex flex-col lg:flex-row lg:space-x-4 space-y-4 lg:space-y-0 min-h-0">

                {/* Left Column: Details & Transcript */}
                <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0"> {/* Ensure column can shrink/grow */}
                     {/* Session Metadata Card */}
                     <Card className="flex-shrink-0">
                         <CardHeader className="border-b"> {/* Added border */}
                             <CardTitle className="flex items-center">
                                 Details:  {/* Added space */}
                                 {isEditingMetadata ? (
                                     <Input
                                        value={editName}
                                        onChange={(e: any) => setEditName(e.target.value)}
                                        placeholder="Session Name"
                                        className="text-lg font-semibold leading-none tracking-tight h-9 inline-block w-auto ml-1 flex-grow" /* Adjusted styles */
                                    />
                                ) : (
                                    <span className="ml-1">{session.sessionName || session.fileName}</span>
                                )}
                            </CardTitle>
                         </CardHeader>
                         <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-4 text-sm"> {/* Added top padding */}
                             {/* Client Name */}
                             <div className="flex items-center space-x-2">
                                 <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="clientNameEditView" className="w-16 flex-shrink-0">Client:</Label> {/* Fixed width label */}
                                 {isEditingMetadata ? (
                                    <Input id="clientNameEditView" value={editClientName} onChange={(e: any) => setEditClientName(e.target.value)} placeholder="Client Name" className="text-sm h-8 flex-grow"/>
                                 ) : ( <span className="font-medium">{session.clientName || 'N/A'}</span> )}
                            </div>

                             {/* Date */}
                             <div className="flex items-center space-x-2">
                                 <CalendarDays className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="sessionDateEditView" className="w-16 flex-shrink-0">Date:</Label>
                                {isEditingMetadata ? (
                                    <Input id="sessionDateEditView" type="date" value={editDate} onChange={(e: any) => setEditDate(e.target.value)} className="text-sm h-8 flex-grow"/>
                                ) : ( <span className="font-medium">{session.date || 'N/A'}</span> )}
                            </div>

                            {/* Session Type */}
                             <div className="flex items-center space-x-2">
                                 <Tag className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="sessionTypeEditView" className="w-16 flex-shrink-0">Type:</Label>
                                {isEditingMetadata ? (
                                     <Select id="sessionTypeEditView" value={editType} onChange={(e: any) => setEditType(e.target.value)} className="text-sm h-8 flex-grow">
                                        {SESSION_TYPES.map(type => ( <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium capitalize">{session.sessionType || 'N/A'}</span> )}
                            </div>

                             {/* Therapy Type */}
                             <div className="flex items-center space-x-2">
                                 <BookMarked className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="therapyEditView" className="w-16 flex-shrink-0">Therapy:</Label>
                                {isEditingMetadata ? (
                                     <Select id="therapyEditView" value={editTherapy} onChange={(e: any) => setEditTherapy(e.target.value)} className="text-sm h-8 flex-grow">
                                        {THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium">{session.therapy || 'N/A'}</span> )}
                            </div>

                            {/* Original Filename (only shown in view mode) */}
                            {session.fileName && !isEditingMetadata && (
                                 <div className="flex items-center space-x-2 text-xs text-gray-400 pt-1 md:col-span-2"> {/* Span full width on medium+ */}
                                    <FileText className="h-3 w-3" />
                                    <span>Original file: {session.fileName}</span>
                                </div>
                            )}
                         </CardContent>
                     </Card>

                     {/* Transcription Card - Make this take remaining space */}
                     <Card className="flex-grow flex flex-col min-h-0"> {/* flex-grow needed */}
                         <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between border-b">
                            <CardTitle>Transcription</CardTitle>
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
                         {/* Content needs to be flexible */}
                         <CardContent className="flex-grow pt-4 flex flex-col min-h-0">
                            {isEditingTranscript ? (
                                 <Textarea
                                    value={editTranscriptContent}
                                    onChange={(e: any) => setEditTranscriptContent(e.target.value)}
                                    className="flex-grow w-full whitespace-pre-wrap text-sm font-mono" // Use flex-grow here
                                    placeholder="Enter or paste transcription here..."
                                />
                            ) : (
                                // ScrollArea needs to fill the space
                                <ScrollArea className="flex-grow border rounded-md">
                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 p-3 font-mono">
                                        {session.transcription || <span className="italic text-gray-500">No transcription available.</span>}
                                    </pre>
                                 </ScrollArea>
                            )}
                         </CardContent>
                    </Card>
                </div>

                 {/* Right Column: Chat Interface + History List */}
                 {/* Needs to be flex-grow and flex-col to fill height */}
                 <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                     {/* Chat Interaction Card */}
                     {/* Use flex-grow and min-h-0 to make it fill remaining space */}
                     <Card className="flex-grow flex flex-col min-h-0">
                         {/* --- MODIFIED Chat Header --- */}
                         <CardHeader className="flex-shrink-0 flex flex-row justify-between items-center border-b gap-2">
                             <div className="flex items-center gap-2 flex-grow min-w-0"> {/* Allow title area to grow/shrink */}
                                <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                {renamingChatId === activeChatId && activeChat ? ( // Ensure activeChat exists for renaming mode
                                    // Rename Input Mode
                                    <>
                                        <Input
                                            value={editChatName}
                                            onChange={(e: any) => setEditChatName(e.target.value)}
                                            placeholder="Enter new chat name"
                                            className="h-8 text-sm flex-grow"
                                            autoFocus
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
                                         {/* Show Edit button only if a chat is active */}
                                         {activeChat && (
                                             <Button onClick={() => handleRenameClick(activeChat)} variant="ghost" size="icon" className="h-6 w-6 ml-1 text-gray-500 hover:text-blue-600 flex-shrink-0" title="Rename Chat">
                                                 <Edit size={14} />
                                             </Button>
                                         )}
                                     </div>
                                )}
                            </div>
                             {/* New Chat Button */}
                             <Button onClick={handleNewChatClick} variant="outline" size="sm" className="flex-shrink-0">
                                 <PlusCircle className="mr-1 h-4 w-4" /> New Chat
                             </Button>
                             {/* Remove Select Dropdown */}
                         </CardHeader>

                         {/* Chat Content: Messages + Input */}
                         <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4">
                             {/* Chat Messages Area - Must grow */}
                             <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}>
                                 <div className="space-y-3 p-3">
                                     {chatHandlers.chatMessages.length === 0 && activeChatId === null && (
                                        <p className="text-center text-gray-500 italic py-4">Start a new chat or select one from the list below.</p>
                                     )}
                                     {chatHandlers.chatMessages.length === 0 && activeChatId !== null && (
                                        <p className="text-center text-gray-500 italic py-4">No messages in this chat yet. Start typing below.</p>
                                     )}
                                    {chatHandlers.chatMessages.map((msg) => (
                                        <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                                            {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}
                                            <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words shadow-sm ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                                {msg.sender === 'user' && (
                                                     <Button
                                                         variant="ghost"
                                                         size="icon"
                                                         className="absolute -left-9 top-0 h-6 w-6 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-yellow-500"
                                                         title={msg.starred ? "Unstar message" : "Star message as template"}
                                                         onClick={() => handleStarClick(msg)}
                                                         aria-label={msg.starred ? "Unstar message" : "Star message"}
                                                     >
                                                         {/* Use filled prop for Star */}
                                                         <Star size={14} filled={!!msg.starred} className={msg.starred ? "text-yellow-500" : ""} />
                                                     </Button>
                                                 )}
                                                {msg.text}
                                            </div>
                                            {msg.sender === 'user' && <User className="h-5 w-5 text-gray-500 flex-shrink-0 mt-1" />}
                                        </div>
                                    ))}
                                    {chatHandlers.isChatting && (
                                        <div className="flex items-start space-x-2">
                                            <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />
                                            <div className="rounded-lg p-2 px-3 text-sm bg-gray-200 text-gray-800 italic flex items-center">
                                                <Loader2 className="inline mr-1 h-4 w-4 animate-spin" /> Thinking...
                                            </div>
                                        </div>
                                    )}
                                </div>
                             </ScrollArea>

                            {/* Chat Input Form - Must not grow */}
                            <form onSubmit={chatHandlers.handleChatSubmit} className="relative flex space-x-2 flex-shrink-0 pt-2 border-t">
                                 {/* Starred Templates Button & Popover */}
                                 <div className="relative"> {/* Container for positioning popover */}
                                     <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        className="h-10 w-10 flex-shrink-0"
                                        title="Show Starred Templates"
                                        onClick={() => setShowTemplates(prev => !prev)} // Toggle visibility
                                        aria-label="Show starred templates"
                                    >
                                        <Star size={18} />
                                    </Button>
                                    {/* Conditionally render the template list */}
                                    {showTemplates && (
                                        <StarredTemplatesList
                                            starredMessages={starredMessages}
                                            onSelectTemplate={handleSelectTemplate}
                                            onClose={() => setShowTemplates(false)} // Pass close handler
                                        />
                                    )}
                                 </div>

                                {/* Text Input */}
                                <Input
                                    type="text"
                                    placeholder="Ask about the session..."
                                    value={chatHandlers.currentQuery}
                                    onChange={(e: any) => chatHandlers.setCurrentQuery(e.target.value)}
                                    // Disable input only if chatting, or if no chat is active/selected
                                    disabled={chatHandlers.isChatting || activeChatId === null}
                                    className="flex-grow"
                                    aria-label="Chat input message"
                                />
                                {/* Send Button */}
                                <Button type="submit" disabled={chatHandlers.isChatting || !chatHandlers.currentQuery.trim() || activeChatId === null}>
                                     Send
                                </Button>
                            </form>
                             {/* Chat Error Message */}
                             {chatHandlers.chatError && (
                                <p className="text-sm text-red-600 text-center flex-shrink-0 mt-1">
                                    {chatHandlers.chatError}
                                </p>
                             )}
                         </CardContent>
                     </Card>

                     {/* --- NEW: Past Chats List --- */}
                     {/* Show this section only if there are chats that are NOT the active one */}
                     {sortedChats.filter(c => c.id !== activeChatId).length > 0 && (
                        <Card className="flex-shrink-0">
                             <CardHeader className="pb-2 pt-3 border-b">
                                 <CardTitle className="text-base flex items-center"><List className="mr-2 h-4 w-4 text-gray-500"/> Past Chats</CardTitle>
                             </CardHeader>
                             <CardContent className="p-2 max-h-36 overflow-y-auto"> {/* Limit height and scroll */}
                                 <ul className="space-y-1">
                                     {sortedChats
                                         .filter(chat => chat.id !== activeChatId) // Exclude the active one
                                         .map(chat => (
                                             <li key={chat.id} className="flex items-center justify-between p-1.5 hover:bg-gray-100 rounded-md">
                                                  <span className="text-sm text-gray-700 truncate mr-2" title={getChatDisplayTitle(chat)}>
                                                      {getChatDisplayTitle(chat)}
                                                  </span>
                                                  <Button
                                                      variant="ghost"
                                                      size="sm"
                                                      className="text-xs h-7 px-2 flex-shrink-0" // Added flex-shrink-0
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
