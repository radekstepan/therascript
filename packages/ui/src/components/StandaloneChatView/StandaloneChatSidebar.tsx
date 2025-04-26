// File: packages/ui/src/components/StandaloneChatView/StandaloneChatSidebar.tsx
import React, { useState, useMemo } from 'react'; // <-- Import useMemo
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai'; // <-- Import useAtom
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
    TextField, // <-- Import TextField
} from '@radix-ui/themes';
import {
    PlusCircledIcon,
    TrashIcon,
    MagnifyingGlassIcon, // <-- Add search icon
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
    standaloneSearchTermAtom // <-- Import search atom
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

    // --- Add state for search term ---
    const [standaloneSearch, setStandaloneSearch] = useAtom(standaloneSearchTermAtom);
    // --- End state ---

    // Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);


    // --- Queries & Mutations (Unchanged) ---
    const { data: standaloneChats, isLoading: isLoadingChatsQuery, error: chatsError } = useQuery<StandaloneChatListItem[], Error>({ queryKey: ['standaloneChats'], queryFn: fetchStandaloneChats, staleTime: 5*60*1000 });
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({ mutationFn: createStandaloneChatApi, onSuccess: (d)=>{setToast("New chat created."); queryClient.invalidateQueries({queryKey:['standaloneChats']}); navigate(`/chats/${d.id}`);}, onError:(e)=>{setToast(`Error creating chat: ${e.message}`);} });
    const editChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null; tags: string[] }>({ mutationFn: (v)=>editStandaloneChatApi(v.chatId,v.newName,v.tags), onSuccess: (d)=>{setToast("Chat details updated."); queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'],(old)=>old?.map(c=>c.id===d.id?{...c,name:d.name,tags:d.tags}:c)); queryClient.setQueryData<ChatSession>(['standaloneChat',d.id],(old)=>old?{...old,name:d.name??undefined, tags:d.tags??null}:old); setIsEditModalOpen(false); setChatToEdit(null);}, onError:(e)=>{setToast(`Error updating chat: ${e.message}`);} });
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

     // --- Filter Standalone Chats ---
     const filteredStandaloneChats = useMemo(() => {
        if (!standaloneChats) return [];
        const searchTermLower = standaloneSearch.toLowerCase().trim();
        if (!searchTermLower) return standaloneChats; // No search term, return all

        return standaloneChats.filter(chat => {
            const nameMatch = chat.name?.toLowerCase().includes(searchTermLower);
            const dateMatch = formatTimestamp(chat.timestamp).toLowerCase().includes(searchTermLower);
            const tagMatch = chat.tags?.some(tag => tag.toLowerCase().includes(searchTermLower));
            return !!(nameMatch || dateMatch || tagMatch);
        });
    }, [standaloneChats, standaloneSearch]);
    // --- End Filter ---

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

                 {/* --- Add Search Input --- */}
                 <Box mb="2" px="1"> {/* Added padding to align with list items */}
                     <TextField.Root
                         size="1" // Smaller size for sidebar
                         placeholder="Search chats..."
                         value={standaloneSearch}
                         onChange={(e) => setStandaloneSearch(e.target.value)}
                     >
                         <TextField.Slot>
                             <MagnifyingGlassIcon height="14" width="14" />
                         </TextField.Slot>
                     </TextField.Root>
                 </Box>
                 {/* --- End Search Input --- */}

                {isLoading ? (
                    <Flex flexGrow="1" align="center" justify="center"> <Spinner size="2"/> <Text color="gray" size="1" ml="2">Loading chats...</Text> </Flex>
                ) : error ? (
                     <Flex flexGrow="1" align="center" justify="center" p="4"> <Text color="red" size="1">Error loading chats: {error.message}</Text> </Flex>
                 ) : filteredStandaloneChats.length === 0 ? ( // Check filtered list length
                    <Flex flexGrow="1" align="center" justify="center">
                        <Text color="gray" size="1" style={{ fontStyle: 'italic' }}>
                             {standaloneSearch ? 'No matching chats.' : 'No chats yet.'} {/* Different message if searching */}
                         </Text>
                    </Flex>
                 ) : (
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, marginLeft: '-4px', marginRight: '-4px' }}>
                        {/* --- Pass filtered chats to list --- */}
                        <StandaloneChatSidebarList
                            chats={filteredStandaloneChats} // Use filtered list
                            onRenameChatRequest={handleEditDetailsRequest} // Pass edit handler
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
