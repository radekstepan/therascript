// File: packages/ui/src/components/StandaloneChatView/StandaloneChatSidebar.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Box,
    Flex,
    Text,
    Heading, // <-- Re-add Heading
    Button, // <-- Re-add Button
    ScrollArea,
    Spinner,
    AlertDialog,
    Dialog,
    TextField,
} from '@radix-ui/themes';
import {
    // ChatBubbleIcon, // Removed
    PlusCircledIcon, // <-- Re-add PlusCircledIcon
    Cross2Icon,
    CheckIcon,
    TrashIcon,
} from '@radix-ui/react-icons';
import { StandaloneChatListTable } from '../LandingPage/StandaloneChatListTable'; // Reuse the table
import {
    fetchStandaloneChats,
    createStandaloneChat as createStandaloneChatApi,
    renameStandaloneChat as renameStandaloneChatApi,
    deleteStandaloneChat as deleteStandaloneChatApi,
    StandaloneChatListItem,
} from '../../api/api';
import {
    activeChatIdAtom,
    toastMessageAtom
} from '../../store';
import type { ChatSession } from '../../types'; // <-- Import ChatSession type

interface StandaloneChatSidebarProps {
    isLoading?: boolean; // Optional loading state from parent
    error?: Error | null; // Optional error state from parent
}

export function StandaloneChatSidebar({ isLoading: isLoadingParent, error: parentError }: StandaloneChatSidebarProps) {
    const navigate = useNavigate();
    const setToast = useSetAtom(toastMessageAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Get active ID for highlighting
    const queryClient = useQueryClient();

    // Local state for modals
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [chatToRename, setChatToRename] = useState<StandaloneChatListItem | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);

    // --- Queries & Mutations ---

    // Fetch Standalone Chats (using query key from LandingPage for cache reuse)
    const { data: standaloneChats, isLoading: isLoadingChatsQuery, error: chatsError } = useQuery<StandaloneChatListItem[], Error>({
        queryKey: ['standaloneChats'],
        queryFn: fetchStandaloneChats,
        staleTime: 5 * 60 * 1000, // Keep data fresh for 5 minutes
    });

    // Create Mutation
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({
        mutationFn: () => createStandaloneChatApi(),
        onSuccess: (newChat) => {
            setToast("New standalone chat created.");
            queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
            navigate(`/chats/${newChat.id}`); // Navigate to the new chat
        },
        onError: (error: Error) => {
             setToast(`Error creating chat: ${error.message}`);
        }
    });

    // Rename Mutation
    const renameChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null }>({
        mutationFn: (variables: { chatId: number; newName: string | null }) =>
            renameStandaloneChatApi(variables.chatId, variables.newName),
        onSuccess: (updatedChat) => {
            setToast("Standalone chat renamed.");
            // Optimistically update the list query data
            queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'], (oldData) =>
                oldData?.map(chat => chat.id === updatedChat.id ? { ...chat, name: updatedChat.name } : chat)
            );
            // *** ADDED: Optimistically update the single chat query data ***
            queryClient.setQueryData<ChatSession>(['standaloneChat', updatedChat.id], (oldChatData) => {
                 if (!oldChatData) return oldChatData;
                 return { ...oldChatData, name: updatedChat.name ?? undefined }; // Use ?? undefined for optional name
            });
            // *** END ADDED ***
            // Also invalidate to ensure consistency if needed, but optimistic update is faster
            // queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
            setIsRenameModalOpen(false);
            setChatToRename(null);
        },
        onError: (error: Error) => {
             setToast(`Error renaming chat: ${error.message}`);
        }
    });

    // Delete Mutation
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({
         mutationFn: (chatId: number) => deleteStandaloneChatApi(chatId),
         onSuccess: (data, deletedChatId) => {
             setToast(data.message || `Standalone chat deleted.`);
             // Optimistically remove from list
             let nextChatId: number | null = null;
             const chatsBeforeDelete = queryClient.getQueryData<StandaloneChatListItem[]>(['standaloneChats']);
             const remainingChats = chatsBeforeDelete?.filter(c => c.id !== deletedChatId) || [];

             queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'], remainingChats);

             // If the deleted chat was active, navigate to the newest remaining or home
             if (activeChatId === deletedChatId) {
                 if (remainingChats.length > 0) {
                     const newestChat = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0];
                     nextChatId = newestChat.id;
                     navigate(`/chats/${nextChatId}`, { replace: true });
                 } else {
                     navigate('/', { replace: true }); // Navigate home if no chats left
                 }
             }
             queryClient.removeQueries({ queryKey: ['standaloneChat', deletedChatId] }); // Remove cached details
         },
         onError: (error: Error, deletedChatId) => {
              setToast(`Error deleting chat ${deletedChatId}: ${error.message}`);
         },
         onSettled: () => {
              setIsDeleteConfirmOpen(false);
              setChatToDelete(null);
         }
    });

    // --- Handlers ---
    const handleNewChatClick = () => { createStandaloneChatMutation.mutate(); }; // Re-add handler
    const handleRenameRequest = (chat: StandaloneChatListItem) => { setChatToRename(chat); setCurrentRenameValue(chat.name || ''); setIsRenameModalOpen(true); };
    const handleConfirmRename = () => { if (!chatToRename || renameChatMutation.isPending) return; renameChatMutation.mutate({ chatId: chatToRename.id, newName: currentRenameValue.trim() || null }); };
    const handleCancelRename = () => { setIsRenameModalOpen(false); setChatToRename(null); setCurrentRenameValue(''); renameChatMutation.reset(); };
    const handleDeleteRequest = (chat: StandaloneChatListItem) => { setChatToDelete(chat); setIsDeleteConfirmOpen(true); };
    const handleConfirmDelete = () => { if (!chatToDelete || deleteChatMutation.isPending) return; deleteChatMutation.mutate(chatToDelete.id); };
    const handleCancelDelete = () => { setIsDeleteConfirmOpen(false); setChatToDelete(null); deleteChatMutation.reset(); };

    // --- Derived State ---
    const isLoading = isLoadingParent || isLoadingChatsQuery;
    const error = parentError || chatsError;
    const chats = standaloneChats || [];

    // --- Render ---
    return (
        <>
            {/* Re-add padding */}
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                 {/* Re-add Header Section */}
                 <Flex justify="between" align="center" flexShrink="0" mb="2">
                     <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
                     <Button
                         onClick={handleNewChatClick}
                         variant="soft" size="1" highContrast
                         title="Start New Standalone Chat"
                         disabled={createStandaloneChatMutation.isPending}
                     >
                         {createStandaloneChatMutation.isPending ? <Spinner size="1"/> : <PlusCircledIcon width="16" height="16" />}
                     </Button>
                 </Flex>
                 {/* End Header Section */}

                {isLoading ? (
                    <Flex flexGrow="1" align="center" justify="center">
                        <Spinner size="2"/> <Text color="gray" size="1" ml="2">Loading chats...</Text>
                    </Flex>
                ) : error ? (
                     <Flex flexGrow="1" align="center" justify="center" p="4">
                         <Text color="red" size="1">Error loading chats: {error.message}</Text>
                     </Flex>
                 ) : chats.length === 0 ? (
                    <Flex flexGrow="1" align="center" justify="center">
                        <Text color="gray" size="1" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
                    </Flex>
                 ) : (
                    // Apply ScrollArea directly to the table container
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
                        <StandaloneChatListTable
                            chats={chats}
                            onRenameChatRequest={handleRenameRequest}
                            onDeleteChatRequest={handleDeleteRequest}
                            activeChatId={activeChatId} // Pass activeChatId for highlighting
                        />
                    </ScrollArea>
                 )}
            </Box>

            {/* Rename Modal */}
            <Dialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && handleCancelRename()}>
                 <Dialog.Content style={{ maxWidth: 450 }}>
                    <Dialog.Title>Rename Chat</Dialog.Title>
                    <Dialog.Description size="2" mb="4"> Enter a new name for this chat. Leave empty to remove the name. </Dialog.Description>
                    <TextField.Root
                        placeholder="Enter chat name (optional)"
                        value={currentRenameValue}
                        onChange={(e) => setCurrentRenameValue(e.target.value)}
                        disabled={renameChatMutation.isPending}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmRename(); }}
                        autoFocus
                    />
                    {renameChatMutation.isError && <Text color="red" size="1" mt="2">Error: {renameChatMutation.error.message}</Text>}
                    <Flex gap="3" mt="4" justify="end">
                        <Button variant="soft" color="gray" onClick={handleCancelRename} disabled={renameChatMutation.isPending}> <Cross2Icon /> Cancel </Button>
                        <Button onClick={handleConfirmRename} disabled={renameChatMutation.isPending}> {renameChatMutation.isPending ? <Spinner size="1"/> : <CheckIcon />} Save Name </Button>
                    </Flex>
                 </Dialog.Content>
            </Dialog.Root>

            {/* Delete Confirmation Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && handleCancelDelete()}>
                 <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Delete Chat</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        Are you sure you want to permanently delete this chat? This action cannot be undone.
                    </AlertDialog.Description>
                     {deleteChatMutation.isError && <Text color="red" size="1" my="2">Error: {deleteChatMutation.error.message}</Text>}
                    <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel> <Button variant="soft" color="gray" onClick={handleCancelDelete} disabled={deleteChatMutation.isPending}>Cancel</Button> </AlertDialog.Cancel>
                        <AlertDialog.Action>
                             <Button color="red" onClick={handleConfirmDelete} disabled={deleteChatMutation.isPending}>
                                {deleteChatMutation.isPending ? <Spinner size="1"/> : <TrashIcon />} <Text ml="1">Delete Chat</Text>
                             </Button>
                         </AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}

// TODO comments should not be removed
