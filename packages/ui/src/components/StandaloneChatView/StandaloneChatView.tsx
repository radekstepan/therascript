// Path: packages/ui/src/components/StandaloneChatView/StandaloneChatView.tsx
import React, { useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Flex, Box, Button, Text, Spinner } from '@radix-ui/themes';
import { ArrowLeftIcon } from '@radix-ui/react-icons';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { ChatInterface } from '../SessionView/Chat/ChatInterface'; // Reuse ChatInterface
import { LlmManagementModal } from '../SessionView/Modals/LlmManagementModal'; // Reuse LLM Modal
import {
    fetchStandaloneChatDetails, // API for standalone chats
    // addStandaloneChatMessageStream, // No longer needed here, handled by ChatInterface
    fetchOllamaStatus,
} from '../../api/api';
import type { ChatSession, OllamaStatus } from '../../types';
import {
    activeChatIdAtom, // We still need to know the active chat ID
    toastMessageAtom,
} from '../../store';

// Minimal component for Standalone Chat View
export function StandaloneChatView() {
    const { chatId: chatIdParam } = useParams<{ chatId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [activeChatId, setActiveChatId] = useAtom(activeChatIdAtom);
    const setToast = useSetAtom(toastMessageAtom);

    const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);

    const chatIdNum = chatIdParam ? parseInt(chatIdParam, 10) : null;

    // --- Tanstack Query Hooks ---

    // Fetch Standalone Chat Details
    const { data: chatData, isLoading: isLoadingChat, error: chatError, isFetching: isFetchingChat } = useQuery<ChatSession | null, Error>({
        queryKey: ['standaloneChat', chatIdNum], // Use a different query key prefix
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

    // Effect to set active Chat ID from URL
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


    // --- Handlers ---
    const handleOpenLlmModal = () => setIsLlmModalOpen(true);
    const handleNavigateBack = () => navigate('/'); // Navigate back to landing page

    // --- Render Logic ---
    if (isLoadingChat && !chatData) {
        return (<Flex justify="center" align="center" style={{ height: '100vh', backgroundColor: 'var(--color-panel-solid)' }}><Spinner size="3" /><Text ml="2" color="gray">Loading chat...</Text></Flex>);
    }
    // Error handled by useEffect navigation

    const displayTitle = chatData?.name || (chatIdNum ? `Chat ${chatIdNum}` : 'Standalone Chat');

    return (
        <Flex direction="column" style={{ height: '100vh', overflow: 'hidden' }}>
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

            {/* Main Content Area - Only the Chat Interface */}
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

            {/* --- LLM Management Modal --- */}
            <LlmManagementModal isOpen={isLlmModalOpen} onOpenChange={setIsLlmModalOpen} />
        </Flex>
    );
}
