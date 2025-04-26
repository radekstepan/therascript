/*
 * packages/ui/src/components/StandaloneChatView/StandaloneChatSidebar.tsx
 *
 * This file contains the StandaloneChatSidebar component, which displays
 * a list of standalone chats and allows creating new ones.
 */
import React, { useState, useMemo } from 'react';
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
    // TextField removed as search is being removed
} from '@radix-ui/themes';
import {
    PlusCircledIcon,
    TrashIcon,
    // MagnifyingGlassIcon removed as search is being removed
} from '@radix-ui/react-icons';
import { StandaloneChatSidebarList } from './StandaloneChatSidebarList';
import { EditStandaloneChatModal } from './EditStandaloneChatModal';
import {
    fetchStandaloneChats,
    createStandaloneChat as createStandaloneChatApi,
    renameStandaloneChat as editStandaloneChatApi,
    deleteStandaloneChat as deleteStandaloneChatApi,
    StandaloneChatListItem,
} from '../../api/api';
import {
    activeChatIdAtom,
    toastMessageAtom,
    // standaloneSearchTermAtom removed as search is being removed
} from '../../store';
import type { ChatSession } from '../../types';
import { formatTimestamp } from '../../helpers';

interface StandaloneChatSidebarProps {
    isLoading?: boolean; // Optional loading state from parent
    error?: Error | null; // Optional error state from parent
}

export function StandaloneChatSidebar({ isLoading: isLoadingParent, error: parentError }: StandaloneChatSidebarProps) {
    const navigate = useNavigate();
    const setToast = useSetAtom(toastMessageAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const queryClient = useQueryClient();

    // --- Remove state for search term ---
    // const [standaloneSearch, setStandaloneSearch] = useAtom(standaloneSearchTermAtom);
    // --- End remove state ---

    // Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false); // Correct state setter name
    const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);


    // --- Queries & Mutations (Unchanged) ---
    const { data: standaloneChats, isLoading: isLoadingChatsQuery, error: chatsError } = useQuery<StandaloneChatListItem[], Error>({ queryKey: ['standaloneChats'], queryFn: fetchStandaloneChats, staleTime: 5*60*1000 });
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({ mutationFn: createStandaloneChatApi, onSuccess: (d)=>{setToast("New chat created."); queryClient.invalidateQueries({queryKey:['standaloneChats']}); navigate(`/chats/${d.id}`);}, onError:(e)=>{setToast(`Error creating chat: ${e.message}`);} });
    // Corrected onSuccess in editChatMutation
    const editChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null; tags: string[] }>({ mutationFn: (v)=>editStandaloneChatApi(v.chatId,v.newName,v.tags), onSuccess: (d)=>{setToast("Chat details updated."); queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'],(old)=>old?.map(c=>c.id===d.id?{...c,name:d.name,tags:d.tags}:c)); queryClient.setQueryData<ChatSession>(['standaloneChat',d.id],(old)=>old?{...old,name:d.name??undefined, tags:d.tags??null}:old); setIsEditModalOpen(false); setChatToEdit(null);}, onError:(e)=>{setToast(`Error updating chat: ${e.message}`);} }); // FIX: Used setIsEditModalOpen
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({ mutationFn: deleteStandaloneChatApi, onSuccess: (d, delId)=>{ setToast(d.message||`Chat deleted.`); let nextId:number|null=null; const before=queryClient.getQueryData<StandaloneChatListItem[]>(['standaloneChats']); const remaining=before?.filter(c=>c.id!==delId)||[]; queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'],remaining); if(activeChatId===delId){ if(remaining.length>0){nextId=[...remaining].sort((a,b)=>b.timestamp-a.timestamp)[0].id; navigate(`/chats/${nextId}`,{replace:true});} else {navigate('/',{replace:true});} } queryClient.removeQueries({queryKey:['standaloneChat',delId]}); }, onError:(e,id)=>{setToast(`Error deleting chat ${id}: ${e.message}`);}, onSettled:()=>{setIsDeleteConfirmOpen(false);setChatToDelete(null);} });

    // --- Handlers ---
    const handleNewChatClick = () => { createStandaloneChatMutation.mutate(); };
    const handleEditDetailsRequest = (chat: StandaloneChatListItem) => { setChatToEdit(chat); setIsEditModalOpen(true); };
    const handleConfirmEdit = (chatId: number, newName: string | null, newTags: string[]) => { if (editChatMutation.isPending) return; editChatMutation.mutate({ chatId, newName, tags: newTags }); };
    const handleDeleteRequest = (chat: StandaloneChatListItem) => { setChatToDelete(chat); setIsDeleteConfirmOpen(true); };
    const handleConfirmDelete = () => { if (!chatToDelete || deleteChatMutation.isPending) return; deleteChatMutation.mutate(chatToDelete.id); };
    const handleCancelDelete = () => { setIsDeleteConfirmOpen(false); setChatToDelete(null); deleteChatMutation.reset(); };

    // --- Derived State ---
    const isLoading = isLoadingParent || isLoadingChatsQuery;
    const error = parentError || chatsError;

     // --- Remove Filtering Logic ---
     // Directly use standaloneChats from the query
     const chatsToShow = standaloneChats || [];
     // --- End Removal ---

    // --- Render ---
    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                 {/* Header Section */}
                 <Flex justify="between" align="center" flexShrink="0" mb="2">
                     <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
                     <Button onClick={handleNewChatClick} variant="soft" size="1" highContrast title="Start New Standalone Chat" disabled={createStandaloneChatMutation.isPending} >
                         {createStandaloneChatMutation.isPending ? <Spinner size="1"/> : <PlusCircledIcon width="16" height="16" />}
                     </Button>
                 </Flex>
                 {/* End Header Section */}

                 {/* --- Remove Search Input --- */}
                 {/*
                 <Box mb="2" px="1">
                     <TextField.Root
                         size="1"
                         placeholder="Search chats..."
                         value={standaloneSearch}
                         onChange={(e) => setStandaloneSearch(e.target.value)}
                     >
                         <TextField.Slot>
                             <MagnifyingGlassIcon height="14" width="14" />
                         </TextField.Slot>
                     </TextField.Root>
                 </Box>
                 */}
                 {/* --- End Removal --- */}

                {isLoading ? (
                    <Flex flexGrow="1" align="center" justify="center"> <Spinner size="2"/> <Text color="gray" size="1" ml="2">Loading chats...</Text> </Flex>
                ) : error ? (
                     <Flex flexGrow="1" align="center" justify="center" p="4"> <Text color="red" size="1">Error loading chats: {error.message}</Text> </Flex>
                 ) : chatsToShow.length === 0 ? ( // Use chatsToShow directly
                    <Flex flexGrow="1" align="center" justify="center">
                        <Text color="gray" size="1" style={{ fontStyle: 'italic' }}>
                             {/* Remove check for standaloneSearch */}
                             'No chats yet.'
                         </Text>
                    </Flex>
                 ) : (
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, marginLeft: '-4px', marginRight: '-4px' }}>
                        {/* --- Pass chatsToShow to list --- */}
                        <StandaloneChatSidebarList
                            chats={chatsToShow} // Use unfiltered list
                            onRenameChatRequest={handleEditDetailsRequest}
                            onDeleteChatRequest={handleDeleteRequest}
                            activeChatId={activeChatId}
                        />
                        {/* --- End Change --- */}
                    </ScrollArea>
                 )}
            </Box>

            {/* Edit Details Modal */}
            <EditStandaloneChatModal isOpen={isEditModalOpen} onOpenChange={setIsEditModalOpen} chat={chatToEdit} onSave={handleConfirmEdit} isSaving={editChatMutation.isPending} saveError={editChatMutation.error?.message} />

            {/* Delete Confirmation Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && handleCancelDelete()}> <AlertDialog.Content style={{maxWidth:450}}> <AlertDialog.Title>Delete Chat</AlertDialog.Title> <AlertDialog.Description size="2"> Are you sure you want to permanently delete this chat? This action cannot be undone. </AlertDialog.Description> {deleteChatMutation.isError && <Text color="red" size="1" my="2">Error: {deleteChatMutation.error.message}</Text>} <Flex gap="3" mt="4" justify="end"> <AlertDialog.Cancel> <Button variant="soft" color="gray" onClick={handleCancelDelete} disabled={deleteChatMutation.isPending}>Cancel</Button> </AlertDialog.Cancel> <AlertDialog.Action> <Button color="red" onClick={handleConfirmDelete} disabled={deleteChatMutation.isPending}> {deleteChatMutation.isPending ? <Spinner size="1"/> : <TrashIcon />} <Text ml="1">Delete Chat</Text> </Button> </AlertDialog.Action> </Flex> </AlertDialog.Content> </AlertDialog.Root>
        </>
    );
}

// TODO comments should not be removed
