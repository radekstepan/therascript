import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query'; // Removed useQuery
import {
    activeChatIdAtom, // Keep for knowing current selection
    // activeSessionIdAtom, // Keep for knowing current selection - NO, rely on sessionId from props
} from '../../../store';
// Removed fetchSession import
// Added fetchChatDetails import
import { deleteChat as deleteChatApi, renameChat as renameChatApi, startNewChat as startNewChatApi, fetchChatDetails } from '../../../api/api';
import {
    DotsHorizontalIcon,
    Pencil1Icon,
    TrashIcon,
    PlusCircledIcon,
    Cross2Icon, // Added for Cancel buttons
    CheckIcon, // Added for Save button
} from '@radix-ui/react-icons';
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
    hideHeader?: boolean;    // New prop to hide the header
}

// Accept props
export function SessionSidebar({ session, isLoading: isLoadingSession, error: sessionError, hideHeader = false }: SessionSidebarProps) {
    const { chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>(); // Only need chatIdParam here
    const navigate = useNavigate();
    // Determine current active chat ID from URL param, falling back to Jotai if needed (though URL should be canonical)
    const currentActiveChatId = chatIdParam ? parseInt(chatIdParam, 10) : useAtomValue(activeChatIdAtom);
    // const currentActiveSessionId = useAtomValue(activeSessionIdAtom); // Session ID comes from props now
    const queryClient = useQueryClient();

    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    // const [renameError, setRenameError] = useState<string | null>(null); // Handled by mutation state

    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);
    // const [deleteError, setDeleteError] = useState<string | null>(null); // Handled by mutation state

    // Get session ID from the session prop
    const sessionId = session?.id ?? null;

    // REMOVED the useQuery hook for sessionMeta here

    // Mutation: Start New Chat
    const startNewChatMutation = useMutation({
        mutationFn: () => {
            if (!sessionId) throw new Error("Session ID missing");
            return startNewChatApi(sessionId);
        },
        onSuccess: (newChat) => {
            // Update session meta cache optimistically or invalidate
            queryClient.setQueryData<Session>(['sessionMeta', sessionId], (oldData) => {
                 if (!oldData) return oldData;
                 const existingChats = Array.isArray(oldData.chats) ? oldData.chats : [];
                 // Add only metadata of new chat
                 // Ensure the object added conforms to ChatSession metadata part
                 const newChatMetadata: ChatSession = {
                    id: newChat.id,
                    sessionId: newChat.sessionId, // Use sessionId from newChat response
                    timestamp: newChat.timestamp,
                    name: newChat.name,
                    messages: [] // Start with empty messages
                 };
                 return { ...oldData, chats: [...existingChats, newChatMetadata] };
            });
            // OR invalidate: queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });

             // Pre-fetch the new chat's details
            queryClient.prefetchQuery({
                queryKey: ['chat', sessionId, newChat.id],
                // Use fetchChatDetails with correct IDs from newChat response
                queryFn: () => fetchChatDetails(newChat.sessionId, newChat.id),
            });

            // Navigate to the new chat immediately
            navigate(`/sessions/${sessionId}/chats/${newChat.id}`);
        },
        onError: (error) => console.error("Failed to start new chat:", error), // TODO: User feedback (Toast?)
    });

    // Mutation: Rename Chat
    const renameChatMutation = useMutation({
        mutationFn: (variables: { chatId: number; newName: string | null }) => {
            if (!sessionId) throw new Error("Session ID missing");
            return renameChatApi(sessionId, variables.chatId, variables.newName);
        },
        onSuccess: (updatedChatMetadata) => {
             // Update session meta cache optimistically
             queryClient.setQueryData<Session>(['sessionMeta', sessionId], (oldData) => {
                 if (!oldData) return oldData;
                 return {
                     ...oldData,
                     chats: (oldData.chats || []).map(chat =>
                         chat.id === updatedChatMetadata.id ? { ...chat, name: updatedChatMetadata.name } : chat
                     ),
                 };
             });
             // OR invalidate: queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });

              // Also update the specific chat query cache if it exists
              queryClient.setQueryData<ChatSession>(['chat', sessionId, updatedChatMetadata.id], (oldChatData) => {
                   if (!oldChatData) return oldChatData;
                   return { ...oldChatData, name: updatedChatMetadata.name };
              });
            cancelRename(); // Close modal on success
        },
        onError: (error) => console.error("Failed to rename chat:", error), // Error message shown in modal via mutation state
    });

    // Mutation: Delete Chat
    const deleteChatMutation = useMutation({
        mutationFn: (chatId: number) => {
            if (!sessionId) throw new Error("Session ID missing");
            return deleteChatApi(sessionId, chatId);
        },
        onSuccess: (data, deletedChatId) => {
            let nextChatId: number | null = null;
            // Determine next navigation target *before* modifying cache
            const sessionDataBeforeDelete = queryClient.getQueryData<Session>(['sessionMeta', sessionId]);
            const remainingChats = sessionDataBeforeDelete?.chats?.filter(c => c.id !== deletedChatId) || [];

            if (currentActiveChatId === deletedChatId) { // Only navigate if the *deleted* chat was active
                if (remainingChats.length > 0) {
                    const newestChat = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0];
                    nextChatId = newestChat.id;
                }
            }

            // Update session meta cache optimistically
            queryClient.setQueryData<Session>(['sessionMeta', sessionId], (oldData) => {
                 if (!oldData) return oldData;
                 return {
                     ...oldData,
                     chats: oldData.chats?.filter(c => c.id !== deletedChatId) || [],
                 };
            });
            // OR invalidate: queryClient.invalidateQueries({ queryKey: ['sessionMeta', sessionId] });

            // Remove the specific chat query from cache
            queryClient.removeQueries({ queryKey: ['chat', sessionId, deletedChatId] });

            // Perform navigation if needed
            if (currentActiveChatId === deletedChatId) {
                if (nextChatId !== null) {
                    navigate(`/sessions/${sessionId}/chats/${nextChatId}`, { replace: true });
                } else {
                    navigate(`/sessions/${sessionId}`, { replace: true });
                }
            }
             cancelDelete(); // Close modal on success
        },
        onError: (error) => console.error("Failed to delete chat:", error), // Error message shown in modal via mutation state
    });


    if (isLoadingSession) {
        return (
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
               <Spinner size="2" /> <Text size="1" color="gray" mt="2">Loading session...</Text>
            </Box>
        );
    }
    if (sessionError || !session) {
        return (
             <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                <Text size="1" color="red">Error: {sessionError?.message || "Could not load session."}</Text>
             </Box>
        );
    }

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
        if (!renamingChat || renameChatMutation.isPending) return;
        renameChatMutation.mutate({ chatId: renamingChat.id, newName: currentRenameValue.trim() || null });
        // Don't close modal here, onSuccess will handle it
    };
    const cancelRename = () => { setIsRenameModalOpen(false); setRenamingChat(null); setCurrentRenameValue(''); renameChatMutation.reset(); };

    const handleDeleteClick = (chat: ChatSession) => { setDeletingChat(chat); setIsDeleteConfirmOpen(true); };
    const confirmDelete = () => {
        if (!deletingChat || deleteChatMutation.isPending) return;
        deleteChatMutation.mutate(deletingChat.id);
         // Don't close modal here, onSuccess will handle it
    };
    const cancelDelete = () => { setIsDeleteConfirmOpen(false); setDeletingChat(null); deleteChatMutation.reset(); };

    const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
        const base = "block w-full px-2 py-1.5 rounded-md group";
        const inactive = "text-[--gray-a11] hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7]";
        const active = "bg-[--accent-a4] text-[--accent-11] font-medium";
        return cn(base, isActive ? active : inactive);
    };

    return (
        <>
            {/* Apply padding based on whether header is shown */}
            <Box p={hideHeader ? "1" : "4"} className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                {/* Conditionally render the header */}
                {!hideHeader && (
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
                 )}

                 {/* Always render the new chat button if header is hidden (for tab view) */}
                 {hideHeader && (
                     <Flex justify="end" align="center" flexShrink="0" mb="2">
                        <Button
                            onClick={handleNewChatClick}
                            variant="soft" size="1" highContrast
                            title="Start New Chat"
                            disabled={startNewChatMutation.isPending}
                        >
                            {startNewChatMutation.isPending ? <Spinner size="1"/> : <PlusCircledIcon width="16" height="16" />}
                        </Button>
                    </Flex>
                 )}


                {isLoadingSession ? (
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
                                    <Box key={chat.id} className="relative">
                                        <NavLink
                                            to={`/sessions/${session.id}/chats/${chat.id}`}
                                            className={getNavLinkClass}
                                            title={getChatDisplayTitle(chat)}
                                            end
                                        >
                                            <Flex align="center" justify="between" gap="1" width="100%">
                                                <Text size="2" truncate className="flex-grow pr-1">
                                                    {getChatDisplayTitle(chat)}
                                                </Text>
                                                <DropdownMenu.Root>
                                                    <DropdownMenu.Trigger>
                                                        <IconButton
                                                            variant="ghost"
                                                            color="gray"
                                                            size="1"
                                                            className="flex-shrink-0 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-[--accent-a4] transition-opacity"
                                                            aria-label="Chat options"
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            onMouseDown={(e) => e.stopPropagation()}
                                                        >
                                                            <DotsHorizontalIcon />
                                                        </IconButton>
                                                    </DropdownMenu.Trigger>
                                                    <DropdownMenu.Content
                                                        size="1"
                                                        align="end"
                                                        sideOffset={2}
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                    >
                                                        <DropdownMenu.Item onSelect={() => handleRenameClick(chat)} disabled={renameChatMutation.isPending}><Pencil1Icon className="mr-2 h-4 w-4" />Rename</DropdownMenu.Item>
                                                        <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)} disabled={deleteChatMutation.isPending}><TrashIcon className="mr-2 h-4 w-4" />Delete</DropdownMenu.Item>
                                                    </DropdownMenu.Content>
                                                </DropdownMenu.Root>
                                            </Flex>
                                        </NavLink>
                                    </Box>
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
                        {/* Use Button with onClick for Cancel, not AlertDialog.Cancel to prevent closing while pending */}
                         <Button variant="soft" color="gray" onClick={cancelRename} disabled={renameChatMutation.isPending}>
                            <Cross2Icon /> Cancel
                         </Button>
                         {/* Use Button with onClick for Action */}
                         <Button onClick={handleSaveRename} disabled={renameChatMutation.isPending}>
                            {renameChatMutation.isPending ? (
                                <> <Spinner size="2"/> <Text ml="1">Saving...</Text> </>
                            ) : (
                                <> <CheckIcon /> Save </>
                            )}
                         </Button>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>

            {/* Delete Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && cancelDelete()}>
                <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Delete Chat</AlertDialog.Title>
                    {deletingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.</AlertDialog.Description>}
                    {deleteChatMutation.isError && <Text color="red" size="1" mb="3">Error: {deleteChatMutation.error.message}</Text>}
                    <Flex gap="3" mt="4" justify="end">
                        {/* Use Button with onClick for Cancel */}
                         <Button variant="soft" color="gray" onClick={cancelDelete} disabled={deleteChatMutation.isPending}>
                            <Cross2Icon /> Cancel
                         </Button>
                         {/* Use Button with onClick for Action */}
                         <Button color="red" onClick={confirmDelete} disabled={deleteChatMutation.isPending}>
                            {deleteChatMutation.isPending ? (
                                <> <Spinner size="2"/> <Text ml="1">Deleting...</Text> </>
                            ) : (
                                <> <TrashIcon /> Delete </>
                            )}
                         </Button>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
