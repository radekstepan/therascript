import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query'; // Removed useQuery
import {
    activeChatIdAtom, // Keep for knowing current selection
    activeSessionIdAtom, // Keep for knowing current selection
} from '../../../store';
// Removed fetchSession import
import { deleteChat as deleteChatApi, renameChat as renameChatApi, startNewChat as startNewChatApi } from '../../../api/api';
import { DotsHorizontalIcon, Pencil1Icon, TrashIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import {
    Box,
    Flex,
    Text, // Use Text component
    Heading,
    Button,
    IconButton,
    TextField,
    DropdownMenu,
    AlertDialog,
    ScrollArea,
    Spinner
} from '@radix-ui/themes';
// import * as Toast from '@radix-ui/react-toast'; // For error feedback maybe
import { formatTimestamp } from '../../../helpers';
import type { ChatSession, Session } from '../../../types';
import { cn } from '../../../utils';

interface SessionSidebarProps {
    session: Session | null; // Receive session data
    isLoading: boolean;      // Receive loading state
    error: Error | null;     // Receive error state
}

// Accept props
export function SessionSidebar({ session, isLoading: isLoadingSession, error: sessionError }: SessionSidebarProps) {
    const { sessionId: sessionIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const currentActiveChatId = useAtomValue(activeChatIdAtom);
    const currentActiveSessionId = useAtomValue(activeSessionIdAtom); // Get session ID from Jotai too
    const queryClient = useQueryClient();

    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    // const [renameError, setRenameError] = useState<string | null>(null); // Handled by mutation state

    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);
    // const [deleteError, setDeleteError] = useState<string | null>(null); // Handled by mutation state

    const sessionId = sessionIdParam ? parseInt(sessionIdParam, 10) : null;

    // REMOVED the useQuery hook for sessionMeta here

    // Mutation: Start New Chat
    const startNewChatMutation = useMutation({
        mutationFn: () => {
            if (!sessionId) throw new Error("Session ID missing");
            return startNewChatApi(sessionId);
        },
        onSuccess: (newChat) => {
            // Update cache or invalidate
            queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });
            // Navigate to the new chat immediately
            navigate(`/sessions/${sessionId}/chats/${newChat.id}`);
        },
        onError: (error) => console.error("Failed to start new chat:", error), // TODO: User feedback
    });

    // Mutation: Rename Chat
    const renameChatMutation = useMutation({
        mutationFn: (variables: { chatId: number; newName: string | null }) => {
            if (!sessionId) throw new Error("Session ID missing");
            return renameChatApi(sessionId, variables.chatId, variables.newName);
        },
        // Optimistic Update Example:
        // onMutate: async (variables) => {
        //     await queryClient.cancelQueries({ queryKey: ['sessionMeta', sessionId] });
        //     const previousSessionData = queryClient.getQueryData<Session>(['sessionMeta', sessionId]);
        //     queryClient.setQueryData<Session>(['sessionMeta', sessionId], old => {
        //         if (!old) return old;
        //         return {
        //             ...old,
        //             chats: (old.chats || []).map(c =>
        //                 c.id === variables.chatId ? { ...c, name: variables.newName || undefined } : c
        //             ),
        //         };
        //     });
        //     return { previousSessionData };
        // },
        // onError: (err, variables, context) => {
        //     if (context?.previousSessionData) {
        //         queryClient.setQueryData(['sessionMeta', sessionId], context.previousSessionData);
        //     }
        //     console.error("Failed to rename chat:", err); // TODO: User feedback
        // },
        // onSuccess: () => { /* Already updated optimistically */ },
        // onSettled: () => {
        //     queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });
        // },
        // Non-Optimistic (simpler):
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] }),
        onError: (error) => console.error("Failed to rename chat:", error), // TODO: User feedback
    });

    // Mutation: Delete Chat
    const deleteChatMutation = useMutation({
        mutationFn: (chatId: number) => {
            if (!sessionId) throw new Error("Session ID missing");
            return deleteChatApi(sessionId, chatId);
        },
        onSuccess: (data, deletedChatId) => {
            // Determine the next chat to navigate to *before* invalidating,
            // as invalidation might trigger a state update that changes currentActiveChatId
            let nextChatId: number | null = null;
            if (currentActiveChatId === deletedChatId) {
                const sessionData = queryClient.getQueryData<Session>(['sessionMeta', sessionId]);
                const remainingChats = sessionData?.chats?.filter(c => c.id !== deletedChatId) || [];
                if (remainingChats.length > 0) {
                    const newestChat = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0];
                    nextChatId = newestChat.id;
                }
            }

            // Invalidate to refetch the chat list
            queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });
             // Also remove the specific chat query data if it exists
            queryClient.removeQueries({ queryKey: ['chat', sessionId, deletedChatId] });

            // Perform navigation if needed
            if (currentActiveChatId === deletedChatId) {
                if (nextChatId !== null) {
                    navigate(`/sessions/${sessionId}/chats/${nextChatId}`, { replace: true });
                } else {
                    navigate(`/sessions/${sessionId}`, { replace: true }); // Navigate to base session if no chats left
                }
            }
        },
        onError: (error) => console.error("Failed to delete chat:", error), // TODO: User feedback
    });


    if (isLoadingSession) { // Use the isLoading prop
        return (
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
               <Spinner size="2" /> <Text size="1" color="gray" mt="2">Loading session...</Text>
            </Box>
        );
    }
    // Use the error and session props
    if (sessionError || !session) {
        return (
             <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                <Text size="1" color="red">Error: {sessionError?.message || "Could not load session."}</Text>
             </Box>
        );
    }

    // Ensure chats is an array, default to empty if not present or not array
    const chatsDefinedAndIsArray = Array.isArray(session?.chats);
    const sortedChats = chatsDefinedAndIsArray
        ? [...session.chats].sort((a, b) => b.timestamp - a.timestamp)
        : [];

    const getChatDisplayTitle = (chat: ChatSession | null): string => {
         if (!chat) return 'Unknown Chat';
         return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    const handleNewChatClick = () => startNewChatMutation.mutate();
    const handleRenameClick = (chat: ChatSession) => { setRenamingChat(chat); setCurrentRenameValue(chat.name || ''); setIsRenameModalOpen(true); };
    const handleSaveRename = () => {
        if (!renamingChat) return;
        renameChatMutation.mutate({ chatId: renamingChat.id, newName: currentRenameValue.trim() || null });
        cancelRename();
    };
    const cancelRename = () => { setIsRenameModalOpen(false); setRenamingChat(null); setCurrentRenameValue(''); };

    const handleDeleteClick = (chat: ChatSession) => { setDeletingChat(chat); setIsDeleteConfirmOpen(true); };
    const confirmDelete = () => {
        if (!deletingChat) return;
        deleteChatMutation.mutate(deletingChat.id);
        cancelDelete();
    };
    const cancelDelete = () => { setIsDeleteConfirmOpen(false); setDeletingChat(null); };

    const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
        const base = "block w-full px-2 py-1.5 rounded-md truncate";
        const inactive = "text-[--gray-a11] hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7]";
        const active = "bg-[--accent-a4] text-[--accent-11] font-medium";
        return cn(base, isActive ? active : inactive);
    };

    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                <Flex justify="between" align="center" flexShrink="0" mb="2">
                    <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
                    <Button
                        onClick={handleNewChatClick}
                        variant="soft" size="1" highContrast
                        title="Start New Chat"
                        disabled={startNewChatMutation.isPending}
                    >
                        {startNewChatMutation.isPending ? <Spinner size="1"/> : <PlusCircledIcon width="16" height="16" />}
                    </Button>
                </Flex>

                {isLoadingSession ? ( // Still show loading if session meta is loading (using prop)
                    <Flex flexGrow="1" align="center" justify="center">
                        <Spinner size="2"/>
                        <Text color="gray" size="2" style={{ fontStyle: 'italic' }} ml="2">Loading chats...</Text>
                    </Flex>
                ) :
                sortedChats.length === 0 ? (
                    <Flex flexGrow="1" align="center" justify="center">
                        <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
                    </Flex>
                ) : (
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
                        <Flex direction="column" gap="1" asChild>
                            <nav>
                                {sortedChats.map((chat) => (
                                    <Flex key={chat.id} align="center" justify="between" className="group relative">
                                        <NavLink to={`/sessions/${session.id}/chats/${chat.id}`} className={getNavLinkClass} title={getChatDisplayTitle(chat)} end>
                                            <Text size="2" truncate className="flex-grow">{getChatDisplayTitle(chat)}</Text>
                                        </NavLink>
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger>
                                                <IconButton variant="ghost" color="gray" size="1" className="flex-shrink-0 ml-1 mr-1 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-[--accent-a4] transition-opacity" aria-label="Chat options" onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
                                                    <DotsHorizontalIcon />
                                                </IconButton>
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Content size="1" align="start" sideOffset={5} onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
                                                <DropdownMenu.Item onSelect={() => handleRenameClick(chat)} disabled={renameChatMutation.isPending}><Pencil1Icon className="mr-2 h-4 w-4" />Rename</DropdownMenu.Item>
                                                <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)} disabled={deleteChatMutation.isPending}><TrashIcon className="mr-2 h-4 w-4" />Delete</DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Root>
                                    </Flex>
                                ))}
                            </nav>
                        </Flex>
                    </ScrollArea>
                )}
            </Box>

            {/* Rename Modal */}
            <AlertDialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && cancelRename()}>
                 <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Rename Chat</AlertDialog.Title>
                    {renamingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave empty to remove the name.</AlertDialog.Description>}
                    <Flex direction="column" gap="3">
                        <TextField.Root
                            size="2" value={currentRenameValue}
                            onChange={(e) => setCurrentRenameValue(e.target.value)}
                            placeholder="Enter new name (optional)" autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveRename(); } }}
                            disabled={renameChatMutation.isPending} />
                        {renameChatMutation.isError && <Text color="red" size="1">Error: {renameChatMutation.error.message}</Text>}
                    </Flex>
                    <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelRename} disabled={renameChatMutation.isPending}>Cancel</Button></AlertDialog.Cancel>
                        <AlertDialog.Action><Button onClick={handleSaveRename} disabled={renameChatMutation.isPending}>
                            {renameChatMutation.isPending && <Spinner size="2"/>}
                            Save
                        </Button></AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>

            {/* Delete Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && cancelDelete()}>
                <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Delete Chat</AlertDialog.Title>
                    {deletingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.</AlertDialog.Description>}
                    <Flex gap="3" mt="4" justify="end">
                        {deleteChatMutation.isError && <Text color="red" size="1" mr="auto">Error: {deleteChatMutation.error.message}</Text>}
                        <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelDelete} disabled={deleteChatMutation.isPending}>Cancel</Button></AlertDialog.Cancel>
                        <AlertDialog.Action><Button color="red" onClick={confirmDelete} disabled={deleteChatMutation.isPending}>
                             {deleteChatMutation.isPending && <Spinner size="2"/>}
                             Delete
                        </Button></AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
