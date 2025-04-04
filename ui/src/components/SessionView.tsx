import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom'; // Import routing hooks

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
import type { ChatMessage, ChatSession, Session } from '../types';
// Import Atoms
import {
    pastSessionsAtom, // Need this to find the session data based on ID
    activeSessionAtom, // Keep this derived atom
    activeChatIdAtom, // Still used to reflect the URL state
    activeSessionIdAtom, // Still used to reflect the URL state
    activeChatAtom, // Keep this derived atom
    currentChatMessagesAtom, // Keep this derived atom
    currentQueryAtom,
    isChattingAtom,
    chatErrorAtom, // Need the atom itself for useAtom
    starredMessagesAtom,
    updateSessionMetadataAtom,
    saveTranscriptAtom,
    starMessageAtom,
    startNewChatAtom,
    renameChatAtom,
    handleChatSubmitAtom,
} from '../store'; // Adjust path

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId: string }>();
    const navigate = useNavigate();

    // Atoms for reading derived state or setting shared state
    const allSessions = useAtomValue(pastSessionsAtom); // Need the full list
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const [activeChatId, setActiveChatId] = useAtom(activeChatIdAtom); // Read and Write
    const activeChat = useAtomValue(activeChatAtom); // Read derived
    const chatMessages = useAtomValue(currentChatMessagesAtom); // Read derived
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    // FIX: Use useAtom to get both value and setter for chatError
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const starredMessages = useAtomValue(starredMessagesAtom);

    // Atom setters for actions
    const updateMetadata = useSetAtom(updateSessionMetadataAtom);
    const saveTranscript = useSetAtom(saveTranscriptAtom);
    const starMessage = useSetAtom(starMessageAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom); // Get the action setter
    const renameChat = useSetAtom(renameChatAtom);
    const handleChatSubmit = useSetAtom(handleChatSubmitAtom);

    const chatScrollRef = useRef<HTMLDivElement>(null);

    // Local UI State
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
    const [isLoading, setIsLoading] = useState(true); // For initial load based on params
    const [derivedSession, setDerivedSession] = useState<Session | null>(null); // Hold session derived from URL
    const derivedActiveSession = useAtomValue(activeSessionAtom); // Use the derived atom AFTER activeSessionId is set

    // --- Effect to Sync URL Params with Jotai State ---
    useEffect(() => {
        setIsLoading(true);
        const currentSessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : NaN;

        if (isNaN(currentSessionIdNum)) {
            console.error("Invalid session ID in URL:", sessionIdParam);
            navigate('/', { replace: true }); // Redirect to landing if session ID is invalid
            return;
        }

        const sessionFromParam = allSessions.find(s => s.id === currentSessionIdNum);

        if (!sessionFromParam) {
            console.error(`Session with ID ${currentSessionIdNum} not found.`);
            navigate('/', { replace: true });
            return;
        }

        setDerivedSession(sessionFromParam);
        setActiveSessionId(currentSessionIdNum); // Update global atom

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
             // Update the URL only if it doesn't match the target
            if (isNaN(currentChatIdNum) || currentChatIdNum !== targetChatId) {
                navigate(`/sessions/${currentSessionIdNum}/chats/${targetChatId}`, { replace: true });
            }
        } else if (targetChatId === null && chats.length === 0) {
             targetChatId = null;
        }

        setActiveChatId(targetChatId);

        // Reset chat input/errors when session/chat context potentially changes
        setCurrentQuery('');
        setChatError(''); // Now this uses the setter obtained from useAtom

        setIsLoading(false);

    // Add setChatError to dependency array
    }, [sessionIdParam, chatIdParam, allSessions, navigate, setActiveSessionId, setActiveChatId, setCurrentQuery, setChatError]);


    // --- Effects for local editing state ---
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

    // Scroll chat to bottom
    useEffect(() => {
        if (chatScrollRef.current) {
            chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
        }
    }, [chatMessages]);

    // Reset renaming state
    useEffect(() => {
        setRenamingChatId(null); setEditChatName(''); setShowTemplates(false);
    }, [activeChatId]);

    // --- Handlers ---

    const handleNavigateBack = () => {
        navigate('/');
    };

    const handleEditMetadataToggle = () => setIsEditingMetadata(prev => !prev);
    const handleEditTranscriptToggle = () => setIsEditingTranscript(prev => !prev);

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

    const handleSaveTranscriptEdit = () => {
        if (derivedSession) {
            saveTranscript({ sessionId: derivedSession.id, transcript: editTranscriptContent });
            setIsEditingTranscript(false);
        }
    };

    const handleSelectChatHistory = (chatId: number) => {
        if (derivedSession && chatId !== activeChatId) {
            navigate(`/sessions/${derivedSession.id}/chats/${chatId}`);
        }
    };

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
    };

    const handleStarClick = (message: ChatMessage) => {
        if (activeChatId !== null) {
            starMessage({
                chatId: activeChatId,
                messageId: message.id,
                shouldStar: !message.starred
            });
        } else {
            console.warn("Cannot star message: No active chat selected.");
        }
    };

    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChatId(chat.id);
        setEditChatName(chat.name || '');
    };

    const handleCancelRename = () => {
        setRenamingChatId(null);
        setEditChatName('');
    };

    const handleSaveRename = () => {
        if (renamingChatId !== null && derivedSession) {
            const trimmedName = editChatName.trim();
            if (trimmedName || activeChat?.name) {
                renameChat({ chatId: renamingChatId, newName: trimmedName });
            }
        }
        setRenamingChatId(null); setEditChatName('');
    };

    const handleNewChatClick = async () => {
        const currentSessionId = derivedSession?.id;
        if (currentSessionId) {
            const result = await startNewChatAction({ sessionId: currentSessionId });
            if (result.success) {
                navigate(`/sessions/${currentSessionId}/chats/${result.newChatId}`);
            } else {
                console.error("Failed to start new chat:", result.error);
                // chatError atom is set within the action itself
            }
        } else {
            console.error("Cannot start new chat: Session ID not available from derived session.");
            setChatError("Cannot start new chat: Session context is missing.");
        }
    };

     const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleChatSubmit();
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

    if (!derivedSession) {
        return <Navigate to="/" replace />;
    }

    const session = derivedSession; // Alias for clarity

    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    const getChatDisplayTitle = (chat: ChatSession | undefined | null): string => {
        if (!chat) return 'No Chat Selected';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };
    const activeChatTitle = getChatDisplayTitle(activeChat);

    // --- RETURN JSX ---
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

                {/* Left Column: Details & Transcript */}
                <div className="lg:w-1/2 flex flex-col space-y-4 min-h-0">
                     {/* Session Metadata Card */}
                     <Card className="flex-shrink-0">
                         <CardHeader className="border-b">
                             <CardTitle className="flex items-center">
                                 Details:&nbsp; {/* Use &nbsp; for non-breaking space */}
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
                             {/* Client Name */}
                             <div className="flex items-center space-x-2">
                                 <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="clientNameEditView" className="w-16 flex-shrink-0">Client:</Label>
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
                             {/* Type */}
                             <div className="flex items-center space-x-2">
                                 <Tag className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="sessionTypeEditView" className="w-16 flex-shrink-0">Type:</Label>
                                {isEditingMetadata ? (
                                     <Select id="sessionTypeEditView" value={editType} onChange={(e: any) => setEditType(e.target.value)} className="text-sm h-8 flex-grow">
                                        {SESSION_TYPES.map(type => ( <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium capitalize">{session.sessionType || 'N/A'}</span> )}
                            </div>
                             {/* Therapy */}
                             <div className="flex items-center space-x-2">
                                 <BookMarked className="h-4 w-4 text-gray-500 flex-shrink-0" />
                                 <Label htmlFor="therapyEditView" className="w-16 flex-shrink-0">Therapy:</Label>
                                {isEditingMetadata ? (
                                     <Select id="therapyEditView" value={editTherapy} onChange={(e: any) => setEditTherapy(e.target.value)} className="text-sm h-8 flex-grow">
                                        {THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}
                                    </Select>
                                 ) : ( <span className="font-medium">{session.therapy || 'N/A'}</span> )}
                            </div>
                             {/* File Name */}
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
                                    value={editTranscriptContent}
                                    onChange={(e: any) => setEditTranscriptContent(e.target.value)}
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
                             <div className="flex items-center gap-2 flex-grow min-w-0">
                                <MessageSquare className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                {renamingChatId === activeChatId && activeChat ? (
                                    <>
                                         <Input
                                            value={editChatName}
                                            onChange={(e: any) => setEditChatName(e.target.value)}
                                            placeholder="Enter new chat name"
                                            className="h-8 text-sm flex-grow" autoFocus
                                            onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                                        />
                                        <Button onClick={handleSaveRename} variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-100" title="Save Name"><Check size={18} /></Button>
                                        <Button onClick={handleCancelRename} variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-100" title="Cancel Rename"><X size={18} /></Button>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-1 min-w-0">
                                         <CardTitle className="truncate" title={activeChatTitle}>
                                             {activeChatTitle}
                                         </CardTitle>
                                         {activeChat && (
                                             <Button onClick={() => handleRenameClick(activeChat)} variant="ghost" size="icon" className="h-6 w-6 ml-1 text-gray-500 hover:text-blue-600 flex-shrink-0" title="Rename Chat">
                                                 <Edit size={14} />
                                             </Button>
                                         )}
                                     </div>
                                )}
                            </div>
                             <Button onClick={handleNewChatClick} variant="outline" size="sm" className="flex-shrink-0">
                                 <PlusCircle className="mr-1 h-4 w-4" /> New Chat
                             </Button>
                         </CardHeader>

                         {/* Chat Content: Messages + Input */}
                         <CardContent className="flex-grow flex flex-col space-y-4 overflow-hidden min-h-0 p-4">
                             {/* Chat Messages Area */}
                             <ScrollArea className="flex-grow border rounded-md mb-4" elRef={chatScrollRef}>
                                 <div className="space-y-3 p-3">
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
                            <form onSubmit={onSubmit} className="relative flex space-x-2 flex-shrink-0 pt-2 border-t">
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
                                        <StarredTemplatesList
                                            onSelectTemplate={handleSelectTemplate}
                                            onClose={() => setShowTemplates(false)}
                                        />
                                    )}
                                 </div>
                                <Input
                                    type="text"
                                    placeholder="Ask about the session..."
                                    value={currentQuery}
                                    onChange={(e: any) => setCurrentQuery(e.target.value)}
                                    disabled={isChatting || activeChatId === null}
                                    className="flex-grow"
                                    aria-label="Chat input message"
                                />
                                <Button type="submit" disabled={isChatting || !currentQuery.trim() || activeChatId === null}>
                                     Send
                                </Button>
                            </form>
                             {/* Display chatError value */}
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
