// File: packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
// Path: packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai'; // Added useSetAtom
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query'; // Removed useMutation
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { ChatInterface } from '../SessionView/Chat/ChatInterface'; // Reuse ChatInterface
import { LlmManagementModal } from '../SessionView/Modals/LlmManagementModal'; // Reuse LLM Modal
import { StandaloneChatSidebar } from './StandaloneChatSidebar'; // Import the new sidebar
import {
    fetchStandaloneChatDetails,
    fetchOllamaStatus,
} from '../../api/api';
import type { ChatSession, OllamaStatus } from '../../types';
import {
    activeChatIdAtom,
    toastMessageAtom,
    clampedSidebarWidthAtom, // <-- Import sidebar atoms
    sidebarWidthAtom,        // <-- Import sidebar atoms
} from '../../store';
import { formatTimestamp } from '../../helpers'; // <-- Import formatTimestamp helper

// Minimal component for Standalone Chat View
export function StandaloneChatView() {
    const { chatId: chatIdParam } = useParams<{ chatId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [activeChatId, setActiveChatId] = useAtom(activeChatIdAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom); // <-- Sidebar width state
    const clampedSidebarWidth = useAtomValue(clampedSidebarWidthAtom); // <-- Clamped width

    const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null); // <-- Ref for sidebar element
    const isResizing = useRef(false); // <-- Ref for resizing state
    const previousChatIdRef = useRef<number | null>(null); // <-- Ref to track chat changes

    const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

    // --- Tanstack Query Hooks ---

    // Fetch Standalone Chat Details (query key corrected)
    const { data: chatData, isLoading: isLoadingChat, error: chatError, isFetching: isFetchingChat } = useQuery<ChatSession | null, Error>({
        queryKey: ['standaloneChat', chatIdNum], // Use correct query key
        queryFn: () => {
            if (!chatIdNum) return Promise.resolve(null);
            console.log(`[StandaloneChatView] Fetching standalone chat details for ID: ${chatIdNum}`);
            return fetchStandaloneChatDetails(chatIdNum);
        },
        enabled: !!chatIdNum,
        staleTime: 5 * 60 * 1000,
    });

    // Fetch Ollama Status (remains the same)
    const { data: ollamaStatus, isLoading: isLoadingOllamaStatus, error: ollamaError } = useQuery<OllamaStatus, Error>({
        queryKey: ['ollamaStatus'],
        queryFn: () => fetchOllamaStatus(),
        staleTime: 60 * 1000,
        refetchOnWindowFocus: true,
        refetchInterval: false,
    });

    // --- Effects ---

    // Effect to set active Chat ID from URL (simplified)
    useEffect(() => {
        const currentChatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;
        if (!currentChatIdNum || isNaN(currentChatIdNum)) {
            console.log("[StandaloneChatView] Invalid or missing chatIdParam, navigating home.");
            navigate('/', { replace: true });
            setActiveChatId(null);
            return;
        }
        if (currentChatIdNum !== activeChatId) {
            console.log(`[StandaloneChatView] Setting activeChatId from URL: ${currentChatIdNum}`);
            setActiveChatId(currentChatIdNum);
            previousChatIdRef.current = currentChatIdNum;
        }
    }, [chatIdParam, activeChatId, navigate, setActiveChatId]);


    // Effect to handle chat not found after loading
    useEffect(() => {
        if (!isLoadingChat && !isFetchingChat && !chatData && chatIdNum) {
            console.error(`[StandaloneChatView] Standalone chat ${chatIdNum} not found.`);
            setToast(`Error: Standalone chat ${chatIdNum} not found.`);
            navigate('/', { replace: true }); // Navigate home if chat doesn't exist
        }
    }, [isLoadingChat, isFetchingChat, chatData, chatIdNum, navigate, setToast]);

    // --- Resizing Logic (Copied & Adapted from SessionView) ---
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing.current || !sidebarRef.current) return;
        const containerRect = sidebarRef.current.parentElement?.getBoundingClientRect();
        if (!containerRect) return;
        let newWidth = e.clientX - containerRect.left;
        setSidebarWidth(newWidth); // Update width using atom setter
    }, [setSidebarWidth]); // Depend on atom setter

    const handleMouseUp = useCallback(() => {
        if (isResizing.current) {
            isResizing.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            console.log("[StandaloneChatView] Resizing finished.");
        }
    }, [handleMouseMove]); // Depend on handleMouseMove

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        isResizing.current = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        console.log("[StandaloneChatView] Resizing started.");
    }, [handleMouseMove, handleMouseUp]); // Depend on handlers

    // Cleanup Resizer Listeners (Copied & Adapted from SessionView)
    useEffect(() => {
        return () => {
            if (isResizing.current) {
                console.log("[StandaloneChatView] Cleanup: Removing resize listeners.");
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                // Reset body styles if component unmounts during resize
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                isResizing.current = false;
            }
        };
    }, [handleMouseMove, handleMouseUp]); // Depend on handlers
    // --- End Resizing Logic ---

    // --- Handlers ---
    const handleOpenLlmModal = () => setIsLlmModalOpen(true);
    const handleNavigateBack = () => navigate('/'); // Navigate back to landing page

    // --- Render Logic ---
    if (isLoadingChat && !chatData) {
        return (<Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Spinner size="3" /><Text ml="2" color="gray">Loading chat...</Text></Flex>);
    }
    // Error handled by useEffect navigation

    // Use formatTimestamp for unnamed chats
    const displayTitle = chatData?.name || (chatData ? `Chat (${formatTimestamp(chatData.timestamp)})` : 'Standalone Chat');

    return (
        <Flex flexGrow="1" style={{ height: '100vh', overflow: 'hidden' }}>
            {/* --- Sidebar (New) --- */}
            <Box
                ref={sidebarRef}
                className="relative flex-shrink-0 hidden lg:flex flex-col" // Hide on smaller screens for now
                style={{
                    width: `${clampedSidebarWidth}px`,
                    backgroundColor: 'var(--color-panel-solid)',
                    borderRight: '1px solid var(--gray-a6)'
                }}
            >
                <StandaloneChatSidebar
                    isLoading={isLoadingChat || isFetchingChat} // Pass loading state
                    error={chatError} // Pass error state
                />
            </Box>
            {/* --- End Sidebar --- */}

            {/* --- Resizer (New) --- */}
            <Box
                className="hidden lg:block flex-shrink-0 w-1.5 cursor-col-resize group hover:bg-[--gray-a4]"
                onMouseDown={handleMouseDown}
                title="Resize sidebar"
            >
                <Box className="h-full w-[1px] bg-[--gray-a5] group-hover:bg-[--accent-9] mx-auto" />
            </Box>
            {/* --- End Resizer --- */}

             {/* Main Content Area */}
            <Flex direction="column" flexGrow="1" style={{ minWidth: 0, height: '100vh', overflow: 'hidden' }}>
                {/* Header */}
                <Box px={{ initial: '5', md: '7', lg: '8' }} py="3" flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }}>
                    <Flex justify="between" align="center">
                        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
                            <Button onClick={handleNavigateBack} variant="ghost" color="gray" size="2" style={{ flexShrink: 0 }}><ArrowLeftIcon /> Home</Button>
                            <Text color="gray" size="2" style={{ flexShrink: 0 }}> / </Text>
                            <Text size="2" weight="bold" truncate title={displayTitle} style={{ flexShrink: 1 }}>{displayTitle}</Text>
                            {/* TODO: Optionally add Rename/Delete controls here later */}
                        </Flex>
                        <UserThemeDropdown />
                    </Flex>
                </Box>
                {/* Content Body */}
                <Box flexGrow="1" style={{ minHeight: 0, overflow: 'hidden', padding: 'var(--space-3)' }}>
                     <ChatInterface
                        // session prop removed
                        activeChatId={chatIdNum}
                        isStandalone={true} // Set prop to true
                        isLoadingSessionMeta={false} // No session meta for standalone
                        ollamaStatus={ollamaStatus}
                        isLoadingOllamaStatus={isLoadingOllamaStatus}
                        onOpenLlmModal={handleOpenLlmModal}
                        // isTabActive={true} // Assuming always active when in this view
                     />
                </Box>
            </Flex> {/* End Main Content Flex */}

            {/* --- LLM Management Modal --- */}
            <LlmManagementModal isOpen={isLlmModalOpen} onOpenChange={setIsLlmModalOpen} />
        </Flex> /* End Outer Flex */
    );
}

// TODO comments should not be removed
