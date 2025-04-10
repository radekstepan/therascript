// src/components/SessionView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../components/UserThemeDropdown';
import { SessionSidebar } from './SessionView/SessionSidebar';
import { SessionContent } from './SessionView/SessionContent';
import { EditDetailsModal } from './SessionView/EditDetailsModal';
import { fetchSession, startNewChat, updateTranscript } from '../api/api';
import { Session } from '../types';
import {
  activeSessionIdAtom,
  activeChatIdAtom,
  chatErrorAtom,
  clampedSidebarWidthAtom,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  pastSessionsAtom, // Make sure this is imported
} from '../store';

export function SessionView() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
  const navigate = useNavigate();
  const sessionIdNum = sessionIdParam ? parseInt(sessionIdParam, 10) : null;
  const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

  const setActiveSessionId = useSetAtom(activeSessionIdAtom);
  const setActiveChatId = useSetAtom(activeChatIdAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const chatError = useAtomValue(chatErrorAtom);
  const activeChatId = useAtomValue(activeChatIdAtom); // Read the current active chat ID
  const [sidebarWidth, setSidebarWidth] = useAtom(clampedSidebarWidthAtom);
  const setPastSessions = useSetAtom(pastSessionsAtom); // Get the setter for the global list

  const [session, setSession] = useState<Session | null>(null); // Local state for the view
  const [isLoading, setIsLoading] = useState(true);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [editTranscriptContent, setEditTranscriptContent] = useState(''); // Editable transcript state

  const sidebarRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  // --- Effect for loading session data ---
  useEffect(() => {
    let isMounted = true; // Flag to track mount status
    if (!sessionIdNum) return;

    console.log(`Effect running for sessionId: ${sessionIdNum}, chatId: ${chatIdNum}`);

    const loadSession = async () => {
      setIsLoading(true); // Set loading at the start
      setChatError(''); // Clear previous errors

      try {
        if (isNaN(sessionIdNum)) {
          console.error("Invalid Session ID detected in useEffect:", sessionIdNum);
          if (isMounted) navigate('/', { replace: true });
          return;
        }

        // --- Fetch the full session data ---
        console.log(`Fetching session ${sessionIdNum}...`);
        const fetchedData = await fetchSession(sessionIdNum);
        console.log(`Fetched Session Data for ${sessionIdNum}:`, JSON.stringify(fetchedData, null, 2)); // Log the raw fetched data

        // --- Check mount status before proceeding ---
        if (!isMounted) {
          console.log(`Component unmounted before session ${sessionIdNum} data could be processed.`);
          return;
        }

        // --- Validate fetched data (Basic check) ---
        if (!fetchedData || typeof fetchedData !== 'object') {
            throw new Error("Invalid data received from API.");
        }

        // --- Update local state (for components receiving session prop) ---
        setSession(fetchedData);
        console.log(`Local session state set for ${sessionIdNum}.`);

        // --- Update Global State (pastSessionsAtom) ---
        setPastSessions(prevSessions => {
          console.log(`Updating pastSessionsAtom for ${sessionIdNum}...`);
          const updatedSessions = prevSessions.map(s => {
            if (s.id === sessionIdNum) {
              // Explicitly merge fields, ensuring arrays/defaults
              const mergedSession = {
                ...s, // Keep existing metadata if fetch was partial (though it shouldn't be)
                ...fetchedData, // Overwrite with fetched data
                chats: Array.isArray(fetchedData.chats) ? fetchedData.chats : [], // Ensure chats is an array
                transcriptContent: fetchedData.transcriptContent || '', // Ensure transcriptContent exists
              };
              console.log(`Merging session ${s.id}. Chats found in fetched: ${mergedSession.chats.length}`);
              return mergedSession;
            }
            return s;
          });
           // Check if the session was found and updated
           if (!updatedSessions.some(s => s.id === sessionIdNum)) {
               console.warn(`Session ${sessionIdNum} was not found in prevSessions during update. Adding fetched data.`);
               // If somehow the session wasn't in the list (e.g., direct navigation), add it.
               // This might indicate an issue elsewhere, but ensures data is present.
               updatedSessions.push({
                   // Provide defaults if needed, assuming fetchedData has all required fields
                   ...fetchedData, // Spread fetched data again
                   chats: Array.isArray(fetchedData.chats) ? fetchedData.chats : [],
                   transcriptContent: fetchedData.transcriptContent || '',
               });
           }
           console.log(`pastSessionsAtom updated. Total sessions: ${updatedSessions.length}`);
          return updatedSessions;
        });

        // --- Set Active Session ID (redundant if already set, but safe) ---
        setActiveSessionId(sessionIdNum);

        // --- Determine and Set Active Chat ID ---
        const chats = Array.isArray(fetchedData.chats) ? fetchedData.chats : [];
        let targetChatId: number | null = chatIdNum || null; // Use ID from URL if present

        if (targetChatId !== null) {
          // Validate URL chat ID against fetched chats
          if (!chats.some(c => c.id === targetChatId)) {
            console.log(`ChatId ${targetChatId} from URL not found in session ${sessionIdNum}. Resetting.`);
            targetChatId = null; // Invalid ID
            if (isMounted) navigate(`/sessions/${sessionIdNum}`, { replace: true }); // Go to session base
          }
        }

        // If no valid chat ID yet (none in URL, or URL one was invalid), and chats exist...
        if (targetChatId === null && chats.length > 0) {
          // ...select the most recent chat
          targetChatId = [...chats].sort((a, b) => b.timestamp - a.timestamp)[0].id;
          console.log(`No valid chatId, defaulting to most recent: ${targetChatId}`);
          // Update URL if it doesn't match the selected target
          if (isMounted && String(targetChatId) !== chatIdParam) {
            navigate(`/sessions/${sessionIdNum}/chats/${targetChatId}`, { replace: true });
          }
        }

        // Set the final active chat ID
        setActiveChatId(targetChatId);
        console.log(`Final Active Chat ID set to: ${targetChatId}`);

        // --- Initialize Editable Transcript State ---
        const fetchedTranscript = fetchedData.transcriptContent || '';
        setEditTranscriptContent(prevEditContent => {
          if (fetchedTranscript !== prevEditContent) {
            console.log("Initializing editTranscriptContent state.");
            return fetchedTranscript;
          }
          return prevEditContent;
        });

      } catch (err) {
        console.error(`Error loading session ${sessionIdNum}:`, err);
        if (isMounted) {
          // Set error state for user feedback
          setChatError(err instanceof Error ? err.message : "Failed to load session details.");
          // Optionally clear local session state on error
          setSession(null);
        }
      } finally {
        // Ensure loading is set to false only if mounted
        if (isMounted) {
          console.log(`Finished loading attempt for session ${sessionIdNum}.`);
          setIsLoading(false);
        }
      }
    };

    loadSession();

    // Cleanup function
    return () => {
      console.log(`Unmounting SessionView or deps changed for ${sessionIdNum}. Setting isMounted=false.`);
      isMounted = false;
    };
    // Dependencies: Re-run if the session or chat ID in the URL changes.
  }, [sessionIdNum, chatIdParam, navigate, setActiveSessionId, setActiveChatId, setChatError, setPastSessions]); // Removed chatIdNum, using chatIdParam directly


  // --- Sidebar Resize Handlers ---
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current || !sidebarRef.current) return;
    const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    let newWidth = e.clientX - containerRect.left;
    newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
    setSidebarWidth(newWidth);
  }, [setSidebarWidth]);

  const handleMouseUp = useCallback(() => {
    if (isResizing.current) {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [handleMouseMove]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [handleMouseMove, handleMouseUp]);

  // --- Effect for cleaning up resize listeners ---
  useEffect(() => {
    return () => {
      if (isResizing.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  // --- Other Event Handlers ---
  const handleStartFirstChat = async () => {
    if (!session) return;
    console.log(`Starting first chat for session ${session.id}`);
    try {
      const newChat = await startNewChat(session.id);
      console.log("New chat created:", newChat);
      // Ensure newChat has messages array if expected by type
      const chatWithMessages = { ...newChat, messages: newChat.messages || [] };
      // Update local state AND global state
      const updatedSession = { ...session, chats: [...(session.chats || []), chatWithMessages] };
      setSession(updatedSession);
      setPastSessions(prevSessions =>
        prevSessions.map(s => s.id === session.id ? updatedSession : s)
      );
      setActiveChatId(chatWithMessages.id); // Set active chat immediately
      navigate(`/sessions/${session.id}/chats/${chatWithMessages.id}`); // Navigate after state updates
    } catch (err) {
      setChatError('Failed to start new chat.');
      console.error("Failed to start new chat:", err);
    }
  };

  const handleOpenEditMetadataModal = () => setIsEditingMetadata(true);

  const handleTranscriptContentChange = (newContent: string) => {
    setEditTranscriptContent(newContent);
  };

  const handleNavigateBack = () => navigate('/');

  // --- Render Logic ---
  if (isLoading) {
    return (
      <Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}>
        <Spinner size="3" />
        <Text ml="2" color="gray">Loading session...</Text>
      </Flex>
    );
  }

  // Display error if loading finished but failed to get session
  if (chatError && !session) {
       return (
           <Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}>
               <Text color="red" mb="4">Error: {chatError}</Text>
               <Button onClick={handleNavigateBack}>Go back to Sessions</Button>
           </Flex>
       );
   }

  // If loading finished, no error, but still no session (e.g., invalid ID redirect failed)
  if (!session || !sessionIdNum) {
    console.warn("SessionView rendering Navigate to / because session is null or sessionIdNum is invalid.");
    return <Navigate to="/" replace />;
  }

  // Now we know session is valid
  const displayTitle = session.sessionName || session.fileName;
  const hasChats = Array.isArray(session.chats) && session.chats.length > 0;
  console.log(`Rendering SessionView for ${session.id}. Has Chats: ${hasChats}`);

  return (
    <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <Box
        ref={sidebarRef}
        className="relative flex-shrink-0 hidden lg:flex flex-col"
        style={{ width: `${sidebarWidth}px`, backgroundColor: 'var(--color-panel-solid)' }}
      >
        {/* SessionSidebar reads derived activeSessionAtom */}
        <SessionSidebar />
      </Box>
      {/* Resizer */}
      <Box
        className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
        onMouseDown={handleMouseDown}
        title="Resize sidebar"
      >
        <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
      </Box>
      {/* Main Content Area */}
      <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <Box
          px={{ initial: '5', md: '7', lg: '8' }}
          py="3"
          flexShrink="0"
          style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}
        >
          <Flex justify="between" align="center">
             <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                 <Button onClick={handleNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}>
                    <ArrowLeftIcon /> Sessions
                </Button>
                <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
                <Text size="2" weight="bold" truncate title={displayTitle} style={{ flexShrink: 1 }}>
                    {displayTitle}
                </Text>
            </Flex>
            <UserThemeDropdown />
          </Flex>
        </Box>
         {/* Content */}
        <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden' }}>
            {/* Pass the local 'session' and 'editTranscriptContent' state */}
            <SessionContent
                session={session} // Pass the locally held session state
                onEditDetailsClick={handleOpenEditMetadataModal}
                editTranscriptContent={editTranscriptContent} // Pass the dedicated state
                onTranscriptContentChange={handleTranscriptContentChange}
                activeChatId={activeChatId} // Pass the determined activeChatId
                hasChats={hasChats}
                onStartFirstChat={handleStartFirstChat}
            />
        </Box>
      </Flex>
       {/* Modals */}
      <EditDetailsModal
           isOpen={isEditingMetadata}
           onOpenChange={setIsEditingMetadata}
           session={session}
           // Consider adding onSuccess to refetch or update state if metadata changes
      />
    </Flex>
  );
}
