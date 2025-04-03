import React, { useState, useCallback, useEffect, useMemo } from 'react';

// Import Components
import { LandingPage } from './components/LandingPage';
import { SessionView } from './components/SessionView';
import { UploadModal } from './components/UploadModal';

// Import Data, Types, Constants, Helpers
import { SAMPLE_SESSIONS } from './sampleData';
// Make sure View type is imported or defined here
import type { Session, ChatMessage, ChatSession, SessionMetadata, ChatHandlers, View, SessionViewProps } from './types'; // Add View, SessionViewProps

function App() {
    // Use the imported View type for state
    const [view, setView] = useState<View>('landing');
    const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
    const [activeChatId, setActiveChatId] = useState<number | null>(null);
    const [pastSessions, setPastSessions] = useState<Session[]>(SAMPLE_SESSIONS);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [transcriptionError, setTranscriptionError] = useState('');
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

    // Chat-specific state (managed here, passed down via chatHandlers)
    const [currentChatMessages, setCurrentChatMessages] = useState<ChatMessage[]>([]);
    const [currentQuery, setCurrentQuery] = useState('');
    const [isChatting, setIsChatting] = useState(false); // Loading state for AI response
    const [chatError, setChatError] = useState('');

    // Global list of starred messages (simplified: only stores id/text)
    const [starredMessages, setStarredMessages] = useState<Pick<ChatMessage, 'id' | 'text'>[]>([]);

    // --- Effects ---
    // Effect to initialize the global starred messages list from pastSessions data on mount
    useEffect(() => {
        const allStarred: Pick<ChatMessage, 'id' | 'text'>[] = [];
        pastSessions.forEach(session => {
            session.chats?.forEach(chat => {
                chat.messages?.forEach(msg => {
                    if (msg.starred) {
                        // Avoid adding duplicates if the same message ID somehow exists elsewhere
                        if (!allStarred.some(starred => starred.id === msg.id)) {
                            allStarred.push({ id: msg.id, text: msg.text });
                        }
                    }
                });
            });
        });
        setStarredMessages(allStarred);
        // This effect should run only once on initial load,
        // or if pastSessions fundamentally changes (like after loading from storage)
    }, []); // Empty dependency array means run once on mount

    // --- Navigation Callbacks ---
    const navigateBack = useCallback(() => {
        setView('landing'); // Always go back to landing page from Session view
        setActiveSessionId(null);
        setActiveChatId(null);
        // Reset chat state when navigating back to the landing page
        setCurrentChatMessages([]);
        setCurrentQuery('');
        setChatError('');
        setIsChatting(false);
    }, []); // No dependencies needed

    const navigateToSession = useCallback((sessionId: number) => {
        const session = pastSessions.find(s => s.id === sessionId);
        if (session) {
            setActiveSessionId(sessionId);
            let initialChatId: number | null = null;
            // Default to the latest chat session if available
            if (Array.isArray(session.chats) && session.chats.length > 0) {
                // Sort chats by timestamp descending (newest first)
                const latestChat = [...session.chats].sort((a, b) => b.timestamp - a.timestamp)[0];
                initialChatId = latestChat.id;
            } else {
                 initialChatId = null; // No chats exist yet
            }
            setActiveChatId(initialChatId);

            // Reset chat display state (messages will load via SessionView effect)
            setCurrentChatMessages([]);
            setCurrentQuery('');
            setChatError('');
            setIsChatting(false);
            setView('session'); // Change the view
        } else {
            console.error(`Session with ID ${sessionId} not found.`);
            // Optionally navigate back or show an error message
            navigateBack();
        }
    }, [pastSessions, navigateBack]); // Depends on session data and back navigation logic

    // Callback for SessionView to set the active chat ID
    const setActiveChatIdHandler = useCallback((chatId: number | null) => {
        setActiveChatId(chatId);
        // Reset query/error state when switching chats
        setCurrentQuery('');
        setChatError('');
        setIsChatting(false);
        // Loading of messages is handled by SessionView's useEffect based on this new chatId
    }, []); // No dependencies needed

    // --- Data Mutation Callbacks ---

    // Save updated metadata for a session
    const updateSessionMetadata = useCallback((sessionId: number, updatedMetadata: Omit<Session, 'id' | 'fileName' | 'transcription' | 'chats'>) => {
        setPastSessions(prevSessions =>
            prevSessions.map(session =>
                session.id === sessionId ? { ...session, ...updatedMetadata } : session
            )
        );
        console.log(`Metadata updated for session: ${sessionId}`);
    }, []); // No dependencies needed

    // Save updated transcription for a session
    const saveTranscript = useCallback((sessionId: number, newTranscript: string) => {
        setPastSessions(prevSessions =>
            prevSessions.map(session =>
                session.id === sessionId ? { ...session, transcription: newTranscript } : session
            )
        );
        console.log(`Transcript updated for session: ${sessionId}`);
    }, []); // No dependencies needed

    // Internal helper to save messages to the main state
     const saveChatMessagesInternal = useCallback((sessionId: number, chatId: number, newMessages: ChatMessage[]) => {
        setPastSessions(prevSessions =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                     // Ensure chats array exists
                    const currentChats = Array.isArray(session.chats) ? session.chats : [];
                    const chatExists = currentChats.some(c => c.id === chatId);

                    let updatedChats;
                    if (chatExists) {
                         updatedChats = currentChats.map(chat =>
                            chat.id === chatId ? { ...chat, messages: newMessages } : chat
                         );
                    } else {
                         // This case means we are saving messages for a newly created chat
                         // The chat structure should have been added *before* calling this
                         console.warn(`Attempting to save messages for chat ${chatId}, but chat structure wasn't found initially. Assuming it was just added.`);
                         // Find the potentially just-added chat structure
                         const newChatPlaceholder = currentChats.find(c => c.id === chatId);
                         if (newChatPlaceholder) {
                            updatedChats = currentChats.map(chat =>
                                chat.id === chatId ? { ...chat, messages: newMessages } : chat
                             );
                         } else {
                             console.error(`CRITICAL: Cannot save messages. Chat ${chatId} structure missing in session ${sessionId}.`);
                             updatedChats = currentChats; // Return unchanged chats on critical error
                         }
                    }
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
         console.log(`Messages saved for chat ${chatId} in session ${sessionId}`);
    }, []);

    // --- NEW: Start New Chat Handler ---
    const handleStartNewChat = useCallback((sessionId: number) => {
        const session = pastSessions.find(s => s.id === sessionId);
        if (!session) {
            console.error("Cannot start new chat: Session not found.");
            setChatError("Error: Could not find the current session.");
            return;
        }

        const newChatId = Date.now();
        const initialMessageId = newChatId + 1;
        const newChat: ChatSession = {
            id: newChatId,
            timestamp: Date.now(),
            // name: "New Chat", // Optionally set a default name
            messages: [
                { id: initialMessageId, sender: 'ai', text: "New chat started." }
            ]
        };

        // Add the new chat structure to the session
        setPastSessions(prevSessions =>
            prevSessions.map(s =>
                s.id === sessionId
                    ? { ...s, chats: [...(s.chats || []), newChat] }
                    : s
            )
        );

        // Switch to the new chat
        setActiveChatId(newChatId);
        // Reset chat state for the new chat
        setCurrentChatMessages(newChat.messages); // Show the initial message
        setCurrentQuery('');
        setChatError('');
        setIsChatting(false);
        console.log(`Started new chat (${newChatId}) for session ${sessionId}`);

    }, [pastSessions]); // Dependency on pastSessions to find the session

    // --- NEW: Rename Chat Handler ---
    const handleRenameChat = useCallback((sessionId: number, chatId: number, newName: string) => {
        setPastSessions(prevSessions =>
            prevSessions.map(session => {
                if (session.id === sessionId) {
                    const updatedChats = (session.chats || []).map(chat =>
                        chat.id === chatId
                            ? { ...chat, name: newName.trim() || undefined } // Set name, or undefined if empty after trim
                            : chat
                    );
                    return { ...session, chats: updatedChats };
                }
                return session;
            })
        );
        console.log(`Renamed chat ${chatId} in session ${sessionId} to: ${newName.trim()}`);
    }, []); // No dependencies needed

    // Handle starting the transcription process (simulated)
    const handleStartTranscription = useCallback(async (file: File, metadata: SessionMetadata): Promise<void> => {
        setIsTranscribing(true);
        setTranscriptionError('');
        console.log("Starting transcription simulation for:", file.name, metadata);

        // Simulate network delay and processing time
        await new Promise(resolve => setTimeout(resolve, 1500 + Math.random() * 1000));

        // Simulate success/failure
        const success = Math.random() > 0.1; // 90% chance of success

        if (success) {
            const dummyTranscription = `Therapist: Okay ${metadata.clientName}, let's begin session "${metadata.sessionName}" from ${metadata.date}. What's been on your mind?\nPatient: Well, it's been a challenging week...\nTherapist: Tell me more about that.\n(Simulated transcription content...)`;
            const newSessionId = Date.now(); // Use timestamp as a simple unique ID
            const initialChatId = Date.now() + 1;
            const initialMessageId = Date.now() + 2;

            // Create the initial chat structure for the new session
            const initialChat: ChatSession = {
                id: initialChatId,
                timestamp: Date.now(),
                messages: [{
                    id: initialMessageId,
                    sender: 'ai',
                    text: `Session "${metadata.sessionName}" (${metadata.date}) transcribed and loaded. Ask me anything.`
                }]
            };

            // Create the full new session object
            const newSession: Session = {
                id: newSessionId,
                fileName: file.name,
                ...metadata, // Spread the collected metadata
                transcription: dummyTranscription,
                chats: [initialChat] // Include the initial chat
            };

            // Add the new session to the beginning of the list
            setPastSessions(prevSessions => [newSession, ...prevSessions]);
            setIsUploadModalOpen(false); // Close the modal on success
            console.log("Transcription successful. New session added:", newSessionId);

            // Navigate to the newly created session after a brief delay for state update
            setTimeout(() => navigateToSession(newSessionId), 50);

        } else {
            const errorMsg = 'Simulated transcription failed. Please check the file or try again.';
            setTranscriptionError(errorMsg);
            console.error("Transcription failed (simulated).");
        }
        setIsTranscribing(false); // End loading state regardless of outcome
    }, [navigateToSession]); // Dependency


    // --- Chat Interaction Callbacks ---

    // --- MODIFIED: handleChatSubmit ---
    const handleChatSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
        event.preventDefault();
        const session = pastSessions.find(s => s.id === activeSessionId);

        // --- Input Validation ---
        if (!currentQuery.trim()) { setChatError("Cannot send an empty message."); return; }
        if (isChatting) { setChatError("Please wait for the previous response."); return; }
        if (!session) { setChatError("Error: No active session found."); return; }
        // --- Ensure a chat is active ---
        if (activeChatId === null) {
             setChatError("Please start a new chat or select a past chat before sending a message.");
             return;
         }

        // Find the existing active chat
        const existingChat = session.chats?.find(c => c.id === activeChatId);
        if (!existingChat) {
            setChatError(`Error: Active chat (ID: ${activeChatId}) not found in session. Please select another chat or start a new one.`);
            setActiveChatId(null); // Reset active chat ID as it's invalid
            return;
        }

        const currentMessages = existingChat.messages || [];

        // --- Prepare and Send User Message ---
        const userMessageId = Date.now() + 1; // Simple unique ID generation
        const newUserMessage: ChatMessage = { id: userMessageId, sender: 'user', text: currentQuery, starred: false };

        // Update local display immediately with user message
        const messagesWithUser = [...currentMessages, newUserMessage];
        setCurrentChatMessages(messagesWithUser);
        const querySentToApi = currentQuery; // Capture query before clearing
        setCurrentQuery(''); // Clear input field
        setIsChatting(true); // Set loading state
        setChatError(''); // Clear previous errors

        // --- Simulate API Call ---
        await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 800)); // Simulate delay

        try {
            // Simulate successful AI response
            const aiResponseText = `Simulated analysis of "${querySentToApi.substring(0, 50)}${querySentToApi.length > 50 ? '...' : ''}". Based on the transcript, the patient seems... [Simulated response]`;
            const aiMessageId = Date.now() + 2;
            const aiResponseMessage: ChatMessage = { id: aiMessageId, sender: 'ai', text: aiResponseText };

            // Update local display with AI response
            const finalMessages = [...messagesWithUser, aiResponseMessage];
            setCurrentChatMessages(finalMessages);

            // Save the complete conversation (user + AI) to the main state
            // Use non-null assertion as we checked activeChatId and activeSessionId above
            saveChatMessagesInternal(activeSessionId!, activeChatId!, finalMessages);

        } catch (error) {
            console.error("Chat API simulation error:", error);
            setChatError("Failed to get response from AI (simulated error).");
            // Optional: Revert local state by removing the user's message if API fails
            // setCurrentChatMessages(messagesWithUser.slice(0, -1));
        } finally {
            setIsChatting(false); // End loading state
        }

    }, [
        currentQuery, isChatting, activeSessionId, activeChatId, pastSessions,
        saveChatMessagesInternal // Dependencies
    ]);

    // Handle starring or unstarring a message
    const handleStarMessage = useCallback((chatIdToUpdate: number, messageId: number, messageText: string, shouldStar: boolean) => {
        // 1. Update the global list of starred templates
        if (shouldStar) {
            // Add only if it doesn't already exist (based on ID)
            setStarredMessages(prevStarred => {
                if (!prevStarred.some(msg => msg.id === messageId)) {
                    return [...prevStarred, { id: messageId, text: messageText }];
                }
                return prevStarred; // Already exists, return unchanged
            });
        } else {
            // Remove from the global list
            setStarredMessages(prevStarred => prevStarred.filter(msg => msg.id !== messageId));
        }

        // 2. Update the starred status within the main `pastSessions` state
        setPastSessions(prevSessions =>
            prevSessions.map(session => {
                // Find the correct session
                if (session.id === activeSessionId) {
                    // Map through its chats
                    const updatedChats = (session.chats || []).map(chat => {
                        // Find the correct chat
                        if (chat.id === chatIdToUpdate) {
                            // Map through its messages
                            const updatedMessages = (chat.messages || []).map(msg =>
                                msg.id === messageId
                                    ? { ...msg, starred: shouldStar } // Update the starred status
                                    : msg
                            );
                            // Return the chat with updated messages
                            return { ...chat, messages: updatedMessages };
                        }
                        // Return other chats unchanged
                        return chat;
                    });
                    // Return the session with updated chats
                    return { ...session, chats: updatedChats };
                }
                // Return other sessions unchanged
                return session;
            })
        );

        // 3. Update the `currentChatMessages` state *if* the change happened in the currently displayed chat
        // This ensures the UI updates instantly without waiting for a re-render triggered by pastSessions change.
        if (chatIdToUpdate === activeChatId) {
            setCurrentChatMessages(prevMsgs =>
                prevMsgs.map(msg =>
                    msg.id === messageId ? { ...msg, starred: shouldStar } : msg
                )
            );
        }
         console.log(`Message ${messageId} in chat ${chatIdToUpdate} ${shouldStar ? 'starred' : 'unstarred'}`);

    }, [activeSessionId, activeChatId]); // Dependencies


    // --- Prepare Props for SessionView ---
    // Bundle chat-related state and handlers into a single object
    const chatHandlers: ChatHandlers = {
        chatMessages: currentChatMessages,
        loadChatMessages: setCurrentChatMessages, // Pass the state setter directly
        currentQuery,
        setCurrentQuery,
        isChatting,
        chatError,
        handleChatSubmit,
    };

    // --- Render ---
    return (
        // Main application container div
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
            {/* Header */}
            <header style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #e5e7eb', backgroundColor: '#ffffff', flexShrink: 0 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', color: '#111827' }}>
                     Therapy Session Analyzer
                 </h1>
            </header>

            {/* Main Content Area */}
            {/* Use flex-grow to fill space, overflow-auto for scrolling if content exceeds viewport */}
            <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflowY: 'auto' }}>
                {view === 'landing' && (
                    <LandingPage
                        pastSessions={pastSessions}
                        navigateToSession={navigateToSession}
                        openUploadModal={() => {
                            setTranscriptionError(''); // Clear previous errors when opening
                            setIsUploadModalOpen(true);
                        }}
                    />
                )}
                {view === 'session' && activeSessionId !== null && (
                    <SessionView
                        key={activeSessionId} // Add key: forces re-mount on session change, resetting SessionView's internal state
                        sessionId={activeSessionId}
                        activeChatId={activeChatId}
                        setActiveChatIdHandler={setActiveChatIdHandler}
                        pastSessions={pastSessions} // Pass the full list for context
                        navigateBack={navigateBack}
                        chatHandlers={chatHandlers} // Pass the bundled handlers/state
                        onSaveMetadata={updateSessionMetadata}
                        onSaveTranscript={saveTranscript}
                        starredMessages={starredMessages} // Pass global list
                        onStarMessage={handleStarMessage} // Pass star handler
                        // Pass new handlers
                        onStartNewChat={handleStartNewChat}
                        onRenameChat={handleRenameChat}
                    />
                )}
                 {/* Handle case where view is 'session' but ID is null (shouldn't normally happen) */}
                 {view === 'session' && activeSessionId === null && (
                    <div className="text-center text-red-500 p-10">Error: Session view requested but no session ID is active. <button onClick={navigateBack} className="text-blue-600 underline">Go Back</button></div>
                 )}
            </main>

            {/* Upload Modal (Rendered conditionally by its own logic) */}
            <UploadModal
                isOpen={isUploadModalOpen}
                onClose={() => setIsUploadModalOpen(false)} // Allow closing if not transcribing
                onStartTranscription={handleStartTranscription}
                isTranscribing={isTranscribing}
                transcriptionError={transcriptionError}
            />
        </div>
    );
}

export default App; // Default export the App component
