import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    FileText, MessageSquare, Bot, Loader2, List, Star
} from './icons/Icons';
// Import Other Components
import { StarredTemplatesList } from './StarredTemplates'; // Corrected import name
// Import Constants, Helpers, Types
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { formatTimestamp } from '../helpers';
import type { Session, ChatMessage, ChatSession, SessionViewProps } from '../types'; // Use specific props type

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
    onStarMessage
}: SessionViewProps) {
    // Find the current session from the list passed down
    const session = pastSessions.find(s => s.id === sessionId);
    // Ref for the ScrollArea div containing chat messages
    const chatScrollRef = useRef<HTMLDivElement>(null);

    // --- State for Editing ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false);
    const [editClientName, setEditClientName] = useState('');
    const [editName, setEditName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');

    const [isEditingTranscript, setIsEditingTranscript] = useState(false);
    const [editTranscriptContent, setEditTranscriptContent] = useState('');

    // State for showing/hiding starred templates popover/list
    const [showTemplates, setShowTemplates] = useState(false);

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
        if (session) {
            setEditTranscriptContent(session.transcription || '');
        }
        // If edit mode is turned OFF, reset the textarea content to the current session transcript
        if (!isEditingTranscript && session) {
            setEditTranscriptContent(session.transcription || '');
        }
    }, [session, isEditingTranscript]); // Re-run when session or transcript edit mode changes

     // Effect to scroll chat ScrollArea to the bottom when messages update
    useEffect(() => {
        if (chatScrollRef.current) {
            // Scroll the referenced div to its maximum scroll height
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatHandlers.chatMessages]); // Trigger scroll whenever chatMessages array changes


    // Load messages for the currently active chat when activeChatId changes
    useEffect(() => {
        if (session && activeChatId !== null) {
            const currentChat = session.chats?.find(c => c.id === activeChatId);
            chatHandlers.loadChatMessages(currentChat?.messages || []);
        } else if (!session || activeChatId === null) {
            // If no session or no chat selected, clear messages
            chatHandlers.loadChatMessages([]);
        }
        // Also hide templates when chat changes
        setShowTemplates(false);
    }, [session, activeChatId, chatHandlers.loadChatMessages]); // Dependencies

    // --- Edit Handlers ---

    const handleEditMetadataToggle = () => {
        const nextEditingState = !isEditingMetadata;
        setIsEditingMetadata(nextEditingState);
        // If turning OFF edit mode, reset fields to current session data
        // (This is handled by the useEffect now, but good to be aware)
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

    // --- Chat Handlers ---

    const handleSelectChatHistory = (chatId: number) => {
        if (chatId !== activeChatId) { // Only update if different chat selected
            setActiveChatIdHandler(chatId); // Update App state
            // chatHandlers.loadChatMessages will be called by the effect watching activeChatId
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

    // Find the currently active chat object using the activeChatId prop
    const activeChat = session.chats?.find(c => c.id === activeChatId);
    // Prepare sorted chat history list for the dropdown/selector
    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp); // Newest first

    return (
        <div className="w-full max-w-4xl mx-auto space-y-6 flex-grow flex flex-col min-h-0">
            {/* Header: Back Button & Edit Metadata Controls */}
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

             {/* Session Metadata Display/Edit Card */}
             <Card className="flex-shrink-0">
                 <CardHeader className="border-b"> {/* Added border */}
                     <CardTitle className="flex items-center">
                         Details:&nbsp; {/* Added space */}
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

            {/* Transcription Display/Edit Card */}
            <Card className="flex-shrink-0">
                <CardHeader className="flex flex-row items-center justify-between border-b"> {/* Use row, add border */}
                    <CardTitle>Transcription</CardTitle>
                    <div className="space-x-2">
                        {!isEditingTranscript ? (
                            <Button onClick={handleEditTranscriptToggle} variant="outline" size="sm">
                                <Edit className="mr-2 h-4 w-4" /> Edit Transcript
                            </Button>
                        ) : (
                            <>
                                <Button onClick={handleSaveTranscriptEdit} variant="default" size="sm">
                                    <Save className="mr-2 h-4 w-4" /> Save Transcript
                                </Button>
                                <Button onClick={handleEditTranscriptToggle} variant="secondary" size="sm">
                                     Cancel
                                 </Button>
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="pt-4"> {/* Added top padding */}
                    {isEditingTranscript ? (
                         <Textarea
                            value={editTranscriptContent}
                            onChange={(e: any) => setEditTranscriptContent(e.target.value)}
                            rows={10}
                            className="whitespace-pre-wrap text-sm font-mono w-full" // Ensure full width
                            placeholder="Enter or paste transcription here..."
                        />
                    ) : (
                         // Use ScrollArea for potentially long transcripts
                         <ScrollArea className="h-40 md:h-56 border rounded-md"> {/* Added border */}
                            <pre className="whitespace-pre-wrap text-sm text-gray-700 p-3 font-mono"> {/* Use pre for formatting, add padding */}
                                {session.transcription || <span className="italic text-gray-500">No transcription available.</span>}
                            </pre>
                         </ScrollArea>
                    )}
                 </CardContent>
            </Card>

            {/* Current Chat Interface Card */}
            {/* Use flex-grow and min-h-0 to make it fill remaining space */}
            <Card className="flex-grow flex flex-col min-h-0">
                 <CardHeader className="flex-shrink-0 flex flex-row justify-between items-center border-b">
                     <CardTitle className="flex items-center">
                         <MessageSquare className="mr-2 h-5 w-5 text-blue-600" />
                         Chat {activeChat ? `(${formatTimestamp(activeChat.timestamp)})` : '(No chat selected)'}
                     </CardTitle>
                     {/* Button to toggle chat history (only show if > 1 chat exists) */}
                     {sortedChats.length > 1 && (
                         <Select
                             value={activeChatId ?? ''} // Use empty string if null
                             onChange={(e: any) => handleSelectChatHistory(Number(e.target.value))}
                             className="text-sm h-9 max-w-[200px]" // Basic styling for select
                             title="Select Chat History"
                         >
                             <option value="" disabled hidden={activeChatId !== null}>Select Chat...</option>
                             {sortedChats.map((chat) => (
                                 <option key={chat.id} value={chat.id}>
                                      Chat from: {formatTimestamp(chat.timestamp)}
                                  </option>
                              ))}
                         </Select>
                     )}
                 </CardHeader>
                 {/* Make content area flexible and scrollable */}
                 <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4"> {/* Padding for content */}
                     {/* Chat Messages Area */}
                     <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}> {/* Border, margin */}
                         {/* Inner padding for messages */}
                         <div className="space-y-3 p-3">
                             {chatHandlers.chatMessages.length === 0 && activeChatId !== null && (
                                <p className="text-center text-gray-500 italic py-4">No messages in this chat yet.</p>
                             )}
                             {chatHandlers.chatMessages.length === 0 && activeChatId === null && (
                                <p className="text-center text-gray-500 italic py-4">Select a chat from history or start typing.</p>
                             )}
                            {chatHandlers.chatMessages.map((msg) => (
                                <div key={msg.id} className={`flex items-start space-x-2 group ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                                    {/* AI Icon */}
                                    {msg.sender === 'ai' && <Bot className="h-5 w-5 text-blue-600 flex-shrink-0 mt-1" />}

                                    {/* Message Bubble */}
                                    <div className={`relative rounded-lg p-2 px-3 text-sm max-w-[85%] break-words shadow-sm ${msg.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                        {/* Star Button (User only, on hover) */}
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

                                     {/* User Icon */}
                                    {msg.sender === 'user' && <User className="h-5 w-5 text-gray-500 flex-shrink-0 mt-1" />}
                                </div>
                            ))}
                            {/* Loading Indicator */}
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

                    {/* Chat Input Form */}
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
                            disabled={chatHandlers.isChatting || activeChatId === null} // Also disable if no chat selected
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

             {/* Chat History Card (Alternative Display) */}
             {/* This is redundant if using the dropdown select in the chat header */}
             {/* You can keep this OR the dropdown, probably not both */}
            {/*
             {sortedChats.length > 1 && (
                 <Card className="flex-shrink-0">
                      <CardHeader className="border-b">
                          <CardTitle className="flex items-center"><List className="mr-2 h-5 w-5 text-gray-600"/> Chat History</CardTitle>
                      </CardHeader>
                      <CardContent className="pt-3">
                          <ScrollArea className="max-h-32 border rounded-md">
                              <ul className="space-y-1 p-1">
                                  {sortedChats.map((chat) => (
                                      <li key={chat.id}>
                                          <Button
                                              variant="ghost"
                                              onClick={() => handleSelectChatHistory(chat.id)}
                                              className={`w-full justify-start text-left h-auto py-1 px-2 text-sm ${chat.id === activeChatId ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-100'}`}
                                              title={`View chat from ${formatTimestamp(chat.timestamp)}`}
                                              disabled={chat.id === activeChatId}
                                          >
                                             Chat from: {formatTimestamp(chat.timestamp)}
                                          </Button>
                                      </li>
                                  ))}
                              </ul>
                          </ScrollArea>
                      </CardContent>
                 </Card>
             )}
             */}
        </div>
    );
}
