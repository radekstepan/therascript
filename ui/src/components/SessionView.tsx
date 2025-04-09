// src/components/SessionView.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate, useLocation } from 'react-router-dom';

// UI Components & Icons
import { Card } from './ui/Card'; // Keep Card if used for loading state
import { Button } from './ui/Button'; // Keep Button if used for loading state
import { ReloadIcon } from '@radix-ui/react-icons'; // Keep ReloadIcon for loading

// Sidebar
// No longer need direct SessionSidebar import here

// New Sub-components
import { SessionHeader } from './SessionView/SessionHeader';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';

// Constants, Types
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
    startNewChatAtom, // Import atom to start a chat
} from '../store';

// Sub-components
// No longer need direct imports of Transcription, ChatInterface, StartChatPrompt here

export function SessionView() {
    const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const location = useLocation();

    // Atoms - Keep the ones needed for coordination and data fetching
    const allSessions = useAtomValue(pastSessionsAtom);
    const setActiveSessionId = useSetAtom(activeSessionIdAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom);
    const session = useAtomValue(activeSessionAtom); // Use 'session' for clarity
    const setChatError = useSetAtom(chatErrorAtom);
    const updateMetadataAction = useSetAtom(updateSessionMetadataAtom);
    const saveTranscriptAction = useSetAtom(saveTranscriptAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom); // Get the action setter

    // --- Sidebar Resizing State ---
    // This logic is moved to SessionContent.tsx

    // --- State for Editing Details ---
    const [isEditingMetadata, setIsEditingMetadata] = useState(false); // State to control the modal visibility
    // --- Transcript State ---
    const [editTranscriptContent, setEditTranscriptContent] = useState(''); // Still needed to pass down
    const [isLoading, setIsLoading] = useState(true);

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
        if (session) {
            // Initialize transcript edit state
            setEditTranscriptContent(session.transcription || ''); // Initialize content directly
        }
    }, [session]); // Depend on session now


    // --- Handlers ---

    // --- Start First Chat Handler ---
    const handleStartFirstChat = async () => {
        if (!session) return;
        const currentSessionId = session.id;
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
        setIsEditingMetadata(true); // Open the modal
    };

    // Handler to close the Edit Details modal (remains the same)
     const handleCloseEditMetadataModal = () => {
        setIsEditingMetadata(false);
    };

    // Saving metadata is now handled INSIDE EditDetailsModal.tsx

    // This handler updates the state when a paragraph is saved in Transcription.tsx (remains the same)
    const handleTranscriptContentChange = (newContent: string) => {
        if (!session) return;
        saveTranscriptAction({
            sessionId: session.id,
            transcript: newContent // Use the content passed up from the component
        });
         setEditTranscriptContent(newContent); // Also update local state if needed for consistency
    }

    const handleNavigateBack = () => navigate('/'); // Keep this

    // Resizing logic is moved to SessionContent.tsx


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
    if (!session) { return <Navigate to="/" replace />; }

    // Determine if there are any chats for the current session
    const hasChats = Array.isArray(session.chats) && session.chats.length > 0;

    return (
      // Use a simpler container, layout handled by children
      <div className="flex flex-col flex-grow min-h-0 h-screen">
          {/* Render Session Header */}
          <SessionHeader
              session={session}
              onEditDetailsClick={handleOpenEditMetadataModal}
              onNavigateBack={handleNavigateBack}
          />

          {/* Render Session Content (handles sidebar, resizer, main panels) */}
          <SessionContent
                session={session}
                editTranscriptContent={editTranscriptContent}
                onTranscriptContentChange={handleTranscriptContentChange}
                activeChatId={activeChatId}
                hasChats={hasChats}
                onStartFirstChat={handleStartFirstChat}
          />

          {/* Render Edit Details Modal */}
          <EditDetailsModal
              isOpen={isEditingMetadata}
              onOpenChange={setIsEditingMetadata} // Pass setter directly or use handleCloseEditMetadataModal
              session={session}
          />

          </div>
    );
}
