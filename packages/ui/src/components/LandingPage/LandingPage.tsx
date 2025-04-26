import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    CounterClockwiseClockIcon, PlusCircledIcon, TrashIcon,
    Pencil1Icon,
    ChatBubbleIcon,
    MagnifyingGlassIcon,
} from '@radix-ui/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionListTable } from './SessionListTable';
import { StandaloneChatListTable } from './StandaloneChatListTable';
import {
    Button, Card, Flex, Heading, Text, Box, Container, Spinner, AlertDialog,
    TextField
} from '@radix-ui/themes';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { EditDetailsModal } from '../SessionView/Modals/EditDetailsModal';
import { EditStandaloneChatModal } from '../StandaloneChatView/EditStandaloneChatModal';
import {
    fetchSessions, deleteSession as deleteSessionApi,
    fetchStandaloneChats,
    createStandaloneChat as createStandaloneChatApi,
    renameStandaloneChat as editStandaloneChatApi,
    deleteStandaloneChat as deleteStandaloneChatApi,
    StandaloneChatListItem,
} from '../../api/api';
import {
    openUploadModalAtom,
    // Session Sort
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria,
    // Standalone Chat Sort
    standaloneChatSortCriteriaAtom, // <-- Import standalone sort state
    standaloneChatSortDirectionAtom, // <-- Import standalone sort state
    setStandaloneChatSortAtom, // <-- Import standalone sort setter
    StandaloneChatSortCriteria, // <-- Import standalone sort type
    // Others
    toastMessageAtom,
    standaloneSearchTermAtom
} from '../../store';
import type { Session, SessionMetadata, ChatSession } from '../../types';
import { formatTimestamp } from '../../helpers';

export function LandingPage() {
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [standaloneSearch, setStandaloneSearch] = useAtom(standaloneSearchTermAtom);

    // Session Sort State
    const currentSessionSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSessionSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSessionSort = useSetAtom(setSessionSortAtom);

    // Standalone Chat Sort State
    const currentStandaloneChatSortCriteria = useAtomValue(standaloneChatSortCriteriaAtom);
    const currentStandaloneChatSortDirection = useAtomValue(standaloneChatSortDirectionAtom);
    const setStandaloneChatSort = useSetAtom(setStandaloneChatSortAtom);

    // Modal States (Session)
    const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
    const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);

    // Modal States (Standalone Chat)
    const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
    const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(null);
    const [isDeleteChatConfirmOpen, setIsDeleteChatConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);

    // Queries
    const { data: sessions, isLoading: isLoadingSessions, error: sessionsError, refetch: refetchSessions } = useQuery<Session[], Error>({ queryKey: ['sessions'], queryFn: fetchSessions });
    const { data: standaloneChats, isLoading: isLoadingStandaloneChats, error: standaloneChatsError, refetch: refetchStandaloneChats } = useQuery<StandaloneChatListItem[], Error>({ queryKey: ['standaloneChats'], queryFn: fetchStandaloneChats });

    // Mutations (Unchanged)
    const deleteSessionMutation = useMutation<{ message: string }, Error, number>({ mutationFn: deleteSessionApi, onSuccess: (d,id)=>{setToast(d.message||`Session ${id} deleted`); queryClient.invalidateQueries({queryKey:['sessions']});}, onError:(e,id)=>{setToast(`Error deleting session ${id}: ${e.message}`);}, onSettled:()=>{setIsDeleteConfirmOpen(false);setSessionToDelete(null);} });
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({ mutationFn: createStandaloneChatApi, onSuccess: (d)=>{setToast("New chat created."); queryClient.invalidateQueries({queryKey:['standaloneChats']}); navigate(`/chats/${d.id}`);}, onError:(e)=>{setToast(`Error creating chat: ${e.message}`);} });
    const editChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null; tags: string[] }>({ mutationFn: (v)=>editStandaloneChatApi(v.chatId,v.newName,v.tags), onSuccess: (d)=>{setToast("Chat details updated."); queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'],(old)=>old?.map(c=>c.id===d.id?{...c,name:d.name,tags:d.tags}:c)); queryClient.setQueryData<ChatSession>(['standaloneChat',d.id],(old)=>old?{...old,name:d.name??undefined, tags:d.tags??null}:old); setIsEditChatModalOpen(false); setChatToEdit(null);}, onError:(e)=>{setToast(`Error updating chat: ${e.message}`);} });
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({ mutationFn: deleteStandaloneChatApi, onSuccess: (d,id)=>{setToast(d.message||`Chat ${id} deleted.`); queryClient.invalidateQueries({queryKey:['standaloneChats']});}, onError:(e,id)=>{setToast(`Error deleting chat ${id}: ${e.message}`);}, onSettled:()=>{setIsDeleteChatConfirmOpen(false);setChatToDelete(null);} });

    // Session Sorting Logic (Unchanged)
    const sortedSessions = useMemo(() => {
        if (!sessions) return [];
        const criteria = currentSessionSortCriteria;
        const direction = currentSessionSortDirection;
        const getString = (value: string | null | undefined): string => value ?? '';
        return [...sessions].sort((a, b) => { let compareResult = 0; try { switch (criteria) { case 'sessionName': const nameA = getString(a.sessionName) || getString(a.fileName); const nameB = getString(b.sessionName) || getString(b.fileName); compareResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'clientName': compareResult = getString(a.clientName).localeCompare(getString(b.clientName), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'sessionType': compareResult = getString(a.sessionType).localeCompare(getString(b.sessionType), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'therapy': compareResult = getString(a.therapy).localeCompare(getString(b.therapy), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'date': compareResult = getString(b.date).localeCompare(getString(a.date)); break; case 'id': compareResult = (a.id ?? 0) - (b.id ?? 0); break; default: const _exhaustiveCheck: never = criteria; console.warn(`[sortedSessions] Unknown sort criteria: ${criteria}`); return 0; } } catch (e) { console.error(`Error during localeCompare for criteria "${criteria}":`, e); console.error("Comparing A:", a); console.error("Comparing B:", b); return 0; } if (direction === 'desc' && criteria !== 'date') { compareResult *= -1; } else if (direction === 'asc' && criteria === 'date') { compareResult *= -1; } return compareResult; });
     }, [sessions, currentSessionSortCriteria, currentSessionSortDirection]);

     // Standalone Chat Filtering and Sorting
     const sortedAndFilteredStandaloneChats = useMemo(() => {
        if (!standaloneChats) return [];
        const searchTermLower = standaloneSearch.toLowerCase().trim();
        const criteria = currentStandaloneChatSortCriteria;
        const direction = currentStandaloneChatSortDirection;

        // 1. Filter
        const filtered = searchTermLower
            ? standaloneChats.filter(chat =>
                (chat.name?.toLowerCase().includes(searchTermLower)) ||
                (formatTimestamp(chat.timestamp).toLowerCase().includes(searchTermLower)) ||
                (chat.tags?.some(tag => tag.toLowerCase().includes(searchTermLower)))
              )
            : standaloneChats;

        // 2. Sort
        const getString = (value: string | null | undefined): string => value ?? '';
        const getTagsString = (tags: string[] | null | undefined): string => (tags ?? []).join(', '); // Use joined tags for basic sort

        return [...filtered].sort((a, b) => {
            let compareResult = 0;
            try {
                switch (criteria) {
                    case 'name':
                        // Use name, fallback to formatted timestamp if name is null/undefined
                        // --- FIX: Use backticks for template literal ---
                        const nameA = getString(a.name) || `Chat (${formatTimestamp(a.timestamp)})`;
                        const nameB = getString(b.name) || `Chat (${formatTimestamp(b.timestamp)})`;
                        // --- END FIX ---
                        compareResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', usage: 'sort' });
                        break;
                    case 'date':
                        // --- FIX: Add missing semicolon ---
                        compareResult = b.timestamp - a.timestamp; // Descending by default
                        break;
                        // --- END FIX ---
                    case 'tags':
                        compareResult = getTagsString(a.tags).localeCompare(getTagsString(b.tags), undefined, { sensitivity: 'base', usage: 'sort' });
                        break;
                    default:
                        const _exhaustiveCheck: never = criteria;
                        console.warn(`[sortedAndFilteredStandaloneChats] Unknown sort criteria: ${criteria}`);
                        return 0;
                }
            } catch (e) {
                console.error(`Error during localeCompare for criteria "${criteria}":`, e);
                return 0;
            }

            // Adjust direction (Date is handled by initial compare direction)
            if (direction === 'desc' && criteria !== 'date') {
                compareResult *= -1;
            } else if (direction === 'asc' && criteria === 'date') {
                compareResult *= -1; // Reverse date sort for ascending
            }
            return compareResult;
        });
     }, [standaloneChats, standaloneSearch, currentStandaloneChatSortCriteria, currentStandaloneChatSortDirection]);


     // Handlers
    const handleSessionSort = (criteria: SessionSortCriteria) => setSessionSort(criteria);
    const handleStandaloneChatSort = (criteria: StandaloneChatSortCriteria) => setStandaloneChatSort(criteria);
    const handleEditSession = (session: Session) => { setSessionToEdit(session); setIsEditingModalOpen(true); };
    const handleEditSaveSuccess = () => { setIsEditingModalOpen(false); setSessionToEdit(null); };
    const handleDeleteSessionRequest = (session: Session) => { setSessionToDelete(session); setIsDeleteConfirmOpen(true); };
    const handleConfirmDeleteSession = () => { if (!sessionToDelete || deleteSessionMutation.isPending) return; deleteSessionMutation.mutate(sessionToDelete.id); };
    const handleNewStandaloneChat = () => { createStandaloneChatMutation.mutate(); };
    const handleEditChatRequest = (chat: StandaloneChatListItem) => { setChatToEdit(chat); setIsEditChatModalOpen(true); };
    const handleConfirmEditChat = (chatId: number, newName: string | null, newTags: string[]) => { if (editChatMutation.isPending) return; editChatMutation.mutate({ chatId, newName, tags: newTags }); };
    const handleDeleteChatRequest = (chat: StandaloneChatListItem) => { setChatToDelete(chat); setIsDeleteChatConfirmOpen(true); };
    const handleConfirmDeleteChat = () => { if (!chatToDelete || deleteChatMutation.isPending) return; deleteChatMutation.mutate(chatToDelete.id); };

    // Loading and Error States (Unchanged)
    const isLoading = isLoadingSessions || isLoadingStandaloneChats;
    const error = sessionsError || standaloneChatsError;

    if (isLoading) { return (<Flex justify="center" align="center" style={{ height: '100vh' }}><Spinner size="3" /><Text ml="2">Loading data...</Text></Flex>); }
    if (error) { return (<Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}><Text color="red" mb="4">{error?.message||'Failed load data.'}</Text><Button onClick={()=>{refetchSessions();refetchStandaloneChats();}} variant="soft">Try Again</Button></Flex>); }

    return (
        <> {/* Fragment for content + modals */}
            <Box className="w-full flex-grow flex flex-col">
                {/* Header Bar (Unchanged) */}
                <Box py="2" px={{ initial: '4', md: '6', lg: '8' }} flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }} >
                    <Flex justify="between"> <Box></Box> <Flex gap="3" align="center"> <Button variant="outline" size="2" onClick={handleNewStandaloneChat} disabled={createStandaloneChatMutation.isPending}><ChatBubbleIcon width="16" height="16" /><Text ml="2">New Chat</Text></Button> <Button variant="soft" size="2" onClick={openUploadModal}><PlusCircledIcon width="16" height="16" /><Text ml="2">New Session</Text></Button> <UserThemeDropdown /> </Flex> </Flex>
                </Box>

                {/* Main Content Area */}
                <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8 overflow-y-auto">
                    <Container size="4" className="flex-grow flex flex-col">

                        {/* Standalone Chats Section */}
                        <Card size="3" className="flex flex-col overflow-hidden mb-6">
                            <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                                <Heading as="h2" size="5" weight="medium"><Flex align="center" gap="2"><ChatBubbleIcon />Standalone Chats</Flex></Heading>
                                <Box style={{ maxWidth: '250px', width: '100%' }}>
                                    <TextField.Root size="2" placeholder="Search chats (name, date, tag)..." value={standaloneSearch} onChange={(e) => setStandaloneSearch(e.target.value)} >
                                        <TextField.Slot> <MagnifyingGlassIcon height="16" width="16" /> </TextField.Slot>
                                    </TextField.Root>
                                </Box>
                            </Flex>
                            <Box className="flex-grow flex flex-col overflow-hidden" style={{ minHeight: '200px' }}>
                                {/* Pass sorted/filtered data and sort props */}
                                {sortedAndFilteredStandaloneChats && sortedAndFilteredStandaloneChats.length > 0 ? (
                                    <StandaloneChatListTable
                                        chats={sortedAndFilteredStandaloneChats}
                                        sortCriteria={currentStandaloneChatSortCriteria}
                                        sortDirection={currentStandaloneChatSortDirection}
                                        onSort={handleStandaloneChatSort}
                                        onEditChatRequest={handleEditChatRequest}
                                        onDeleteChatRequest={handleDeleteChatRequest}
                                    />
                                ) : (
                                    <Flex flexGrow="1" align="center" justify="center" p="6"> <Text color="gray"> {standaloneSearch ? 'No matching chats found.' : 'No standalone chats yet. Click "New Chat".'} </Text> </Flex>
                                )}
                             </Box>
                        </Card>

                        {/* Session History Section */}
                        <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                            <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}> <Heading as="h2" size="5" weight="medium"><Flex align="center" gap="2"><CounterClockwiseClockIcon />Session History</Flex></Heading> </Flex>
                            <Box className="flex-grow flex flex-col overflow-hidden"> {sortedSessions.length === 0 ? ( <Flex flexGrow="1" align="center" justify="center" p="6"><Text color="gray">No sessions found.</Text></Flex> ) : ( <SessionListTable sessions={sortedSessions} sortCriteria={currentSessionSortCriteria} sortDirection={currentSessionSortDirection} onSort={handleSessionSort} onEditSession={handleEditSession} onDeleteSessionRequest={handleDeleteSessionRequest} /> )} </Box>
                        </Card>

                    </Container>
                </Box>
            </Box>

            {/* Modals (Unchanged) */}
            <EditDetailsModal isOpen={isEditingModalOpen} onOpenChange={(open)=>{setIsEditingModalOpen(open);if(!open)setSessionToEdit(null);}} session={sessionToEdit} onSaveSuccess={handleEditSaveSuccess} />
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}> <AlertDialog.Content style={{maxWidth:450}}> <AlertDialog.Title>Delete Session</AlertDialog.Title> <AlertDialog.Description size="2"> Are you sure you want to permanently delete the session "<Text weight="bold">{sessionToDelete?.sessionName||sessionToDelete?.fileName||'this session'}</Text>"?<br/><br/> This will remove the session record, original audio file, transcript, and all associated chats. <Text weight="bold" color="red"> This action cannot be undone.</Text> </AlertDialog.Description> <Flex gap="3" mt="4" justify="end"> <AlertDialog.Cancel> <Button variant="soft" color="gray" disabled={deleteSessionMutation.isPending}> Cancel </Button> </AlertDialog.Cancel> <AlertDialog.Action> <Button color="red" onClick={handleConfirmDeleteSession} disabled={deleteSessionMutation.isPending}> {deleteSessionMutation.isPending ? <Spinner size="1"/> : <TrashIcon />} <Text ml="1">Delete Session</Text> </Button> </AlertDialog.Action> </Flex> </AlertDialog.Content> </AlertDialog.Root>
            <EditStandaloneChatModal isOpen={isEditChatModalOpen} onOpenChange={setIsEditChatModalOpen} chat={chatToEdit} onSave={handleConfirmEditChat} isSaving={editChatMutation.isPending} saveError={editChatMutation.error?.message} />
            <AlertDialog.Root open={isDeleteChatConfirmOpen} onOpenChange={setIsDeleteChatConfirmOpen}> <AlertDialog.Content style={{maxWidth:450}}> <AlertDialog.Title>Delete Chat</AlertDialog.Title> <AlertDialog.Description size="2"> Are you sure you want to permanently delete the chat "<Text weight="bold">{chatToDelete?.name||`Chat (${formatTimestamp(chatToDelete?.timestamp||0)})`}</Text>"? <Text weight="bold" color="red"> This action cannot be undone.</Text> </AlertDialog.Description> {deleteChatMutation.isError && <Text color="red" size="1" my="2">Error: {deleteChatMutation.error.message}</Text>} <Flex gap="3" mt="4" justify="end"> <AlertDialog.Cancel> <Button variant="soft" color="gray" disabled={deleteChatMutation.isPending}>Cancel</Button> </AlertDialog.Cancel> <AlertDialog.Action> <Button color="red" onClick={handleConfirmDeleteChat} disabled={deleteChatMutation.isPending}> {deleteChatMutation.isPending ? <Spinner size="1"/> : <TrashIcon />} <Text ml="1">Delete Chat</Text> </Button> </AlertDialog.Action> </Flex> </AlertDialog.Content> </AlertDialog.Root>
        </>
    );
}

// TODO comments should not be removed
