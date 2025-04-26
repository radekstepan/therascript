// File: packages/ui/src/components/StandaloneChatView/StandaloneChatSidebar.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Box,
    Flex,
    Text,
    Heading,
    Button,
    ScrollArea,
    Spinner,
    AlertDialog,
    // Dialog, // Replaced by EditStandaloneChatModal
    // TextField, // Moved to EditStandaloneChatModal
} from '@radix-ui/themes';
import {
    PlusCircledIcon,
    // Cross2Icon, // Moved to EditStandaloneChatModal
    // CheckIcon, // Moved to EditStandaloneChatModal
    TrashIcon,
} from '@radix-ui/react-icons';
import { StandaloneChatSidebarList } from './StandaloneChatSidebarList';
// --- Import the new Edit Modal ---
import { EditStandaloneChatModal } from './EditStandaloneChatModal';
// --- End Import ---
import {
    fetchStandaloneChats,
    createStandaloneChat as createStandaloneChatApi,
    renameStandaloneChat as editStandaloneChatApi, // Rename API function import conceptually
    deleteStandaloneChat as deleteStandaloneChatApi,
    StandaloneChatListItem,
} from '../../api/api';
import {
    activeChatIdAtom,
    toastMessageAtom
} from '../../store';
import type { ChatSession } from '../../types';

interface StandaloneChatSidebarProps {
    isLoading?: boolean; // Optional loading state from parent
    error?: Error | null; // Optional error state from parent
}

export function StandaloneChatSidebar({ isLoading: isLoadingParent, error: parentError }: StandaloneChatSidebarProps) {
    const navigate = useNavigate();
    const setToast = useSetAtom(toastMessageAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Get active ID for highlighting
    const queryClient = useQueryClient();

    // --- Modal State ---
    // Replace rename modal state with edit details modal state
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(null);
    // Delete modal state remains
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);
    // --- End Modal State ---


    // --- Queries ---
    // Fetch Standalone Chats (unchanged)
    const { data: standaloneChats, isLoading: isLoadingChatsQuery, error: chatsError } = useQuery<StandaloneChatListItem[], Error>({
        queryKey: ['standaloneChats'],
        queryFn: fetchStandaloneChats,
        staleTime: 5 * 60 * 1000, // Keep data fresh for 5 minutes
    });

    // --- Mutations ---

    // Create Mutation (unchanged)
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

    // Edit (Rename + Tags) Mutation
    // Updated mutation signature and logic
    const editChatMutation = useMutation<
        StandaloneChatListItem, // Success response type (updated metadata)
        Error, // Error type
        { chatId: number; newName: string | null; tags: string[] } // Variables type
    >({
        mutationFn: (variables) =>
            editStandaloneChatApi(variables.chatId, variables.newName, variables.tags), // Call updated API function
        onSuccess: (updatedChat) => {
            setToast("Chat details updated.");
            // Optimistically update the list query data
            queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'], (oldData) =>
                oldData?.map(chat => chat.id === updatedChat.id ? { ...chat, name: updatedChat.name, tags: updatedChat.tags } : chat)
            );
            // Optimistically update the single chat query data
            queryClient.setQueryData<ChatSession>(['standaloneChat', updatedChat.id], (oldChatData) => {
                 if (!oldChatData) return oldChatData;
                 // Ensure tags is handled correctly (null vs undefined)
                 return { ...oldChatData, name: updatedChat.name ?? undefined, tags: updatedChat.tags ?? null };
            });
            setIsEditModalOpen(false); // Close the modal on success
            setChatToEdit(null);
        },
        onError: (error: Error) => {
             setToast(`Error updating chat details: ${error.message}`);
             // Keep modal open to show error if needed by not calling setIsEditModalOpen(false)
        }
    });

    // Delete Mutation (unchanged)
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({
         mutationFn: (chatId: number) => deleteStandaloneChatApi(chatId),
         onSuccess: (data, deletedChatId) => {
             setToast(data.message || `Standalone chat deleted.`);
             let nextChatId: number | null = null;
             const chatsBeforeDelete = queryClient.getQueryData<StandaloneChatListItem[]>(['standaloneChats']);
             const remainingChats = chatsBeforeDelete?.filter(c => c.id !== deletedChatId) || [];

             queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'], remainingChats);

             if (activeChatId === deletedChatId) {
                 if (remainingChats.length > 0) {
                     const newestChat = [...remainingChats].sort((a, b) => b.timestamp - a.timestamp)[0];
                     nextChatId = newestChat.id;
                     navigate(`/chats/${nextChatId}`, { replace: true });
                 } else {
                     navigate('/', { replace: true });
                 }
             }
             queryClient.removeQueries({ queryKey: ['standaloneChat', deletedChatId] });
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
    const handleNewChatClick = () => { createStandaloneChatMutation.mutate(); };
    // Update rename handler to open edit modal
    const handleEditDetailsRequest = (chat: StandaloneChatListItem) => {
        setChatToEdit(chat);
        setIsEditModalOpen(true);
    };
    // Update confirm handler to use edit mutation
    const handleConfirmEdit = (chatId: number, newName: string | null, newTags: string[]) => {
        if (editChatMutation.isPending) return;
        editChatMutation.mutate({ chatId, newName, tags: newTags });
    };
    // Delete handlers remain
    const handleDeleteRequest = (chat: StandaloneChatListItem) => { setChatToDelete(chat); setIsDeleteConfirmOpen(true); };
    const handleConfirmDelete = () => { if (!chatToDelete || deleteChatMutation.isPending) return; deleteChatMutation.mutate(chatToDelete.id); };
    const handleCancelDelete = () => { setIsDeleteConfirmOpen(false); setChatToDelete(null); deleteChatMutation.reset(); };

    // --- Derived State (unchanged) ---
    const isLoading = isLoadingParent || isLoadingChatsQuery;
    const error = parentError || chatsError;
    const chats = standaloneChats || [];

    // --- Render ---
    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                 {/* Header Section (unchanged) */}
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
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, marginLeft: '-4px', marginRight: '-4px' }}>
                        {/* Use the Sidebar List Component, pass new handler */}
                        <StandaloneChatSidebarList
                            chats={chats}
                            onRenameChatRequest={handleEditDetailsRequest} // Pass the edit handler here
                            onDeleteChatRequest={handleDeleteRequest}
                            activeChatId={activeChatId}
                        />
                    </ScrollArea>
                 )}
            </Box>

            {/* --- Edit Details Modal --- */}
            <EditStandaloneChatModal
                isOpen={isEditModalOpen}
                onOpenChange={setIsEditModalOpen}
                chat={chatToEdit}
                onSave={handleConfirmEdit}
                isSaving={editChatMutation.isPending}
                saveError={editChatMutation.error?.message}
            />
            {/* --- End Edit Modal --- */}


            {/* Delete Confirmation Modal (unchanged) */}
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
