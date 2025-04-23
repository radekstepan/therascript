import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom'; // Import useNavigate
import { useAtomValue, useSetAtom } from 'jotai';
import {
    CounterClockwiseClockIcon, PlusCircledIcon, TrashIcon,
    Pencil1Icon, // Added for Rename Modal
    ChatBubbleIcon, // Added for Standalone Chats
    Cross2Icon, CheckIcon, // Added for Modals
} from '@radix-ui/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionListTable } from './SessionListTable';
import { StandaloneChatListTable } from './StandaloneChatListTable'; // Import new table
import {
    Button, Card, Flex, Heading, Text, Box, Container, Spinner, AlertDialog,
    Dialog, TextField, // Added Dialog, TextField for Rename Modal
} from '@radix-ui/themes';
import { UserThemeDropdown } from '../User/UserThemeDropdown';
import { EditDetailsModal } from '../SessionView/Modals/EditDetailsModal';
import {
    fetchSessions, deleteSession as deleteSessionApi,
    fetchStandaloneChats, // Import API for standalone chats
    createStandaloneChat as createStandaloneChatApi,
    renameStandaloneChat as renameStandaloneChatApi,
    deleteStandaloneChat as deleteStandaloneChatApi,
    StandaloneChatListItem, // Import type
} from '../../api/api';
import {
    openUploadModalAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria,
    toastMessageAtom
} from '../../store';
import type { Session, SessionMetadata } from '../../types';
// Removed unused import: import type { StandaloneChatListItem } from '../../api/api';
import { formatTimestamp } from '../../helpers'; // Import helper for timestamp

export function LandingPage() {
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSort = useSetAtom(setSessionSortAtom);
    const queryClient = useQueryClient();
    const navigate = useNavigate(); // Get navigate function

    // Session Modal State
    const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
    const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);

    // Standalone Chat Modal State
    const [isRenameChatModalOpen, setIsRenameChatModalOpen] = useState(false);
    const [chatToRename, setChatToRename] = useState<StandaloneChatListItem | null>(null);
    const [currentChatRenameValue, setCurrentChatRenameValue] = useState('');
    const [isDeleteChatConfirmOpen, setIsDeleteChatConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);

    // --- Tanstack Queries ---
    const { data: sessions, isLoading: isLoadingSessions, error: sessionsError, refetch: refetchSessions } = useQuery<Session[], Error>({
        queryKey: ['sessions'],
        queryFn: fetchSessions,
    });

    const { data: standaloneChats, isLoading: isLoadingStandaloneChats, error: standaloneChatsError, refetch: refetchStandaloneChats } = useQuery<StandaloneChatListItem[], Error>({
        queryKey: ['standaloneChats'],
        queryFn: fetchStandaloneChats,
    });

    // --- Mutations ---

    // Session Delete Mutation
    const deleteSessionMutation = useMutation<{ message: string }, Error, number>({ // Explicit types
        mutationFn: (sessionId: number) => deleteSessionApi(sessionId),
        onSuccess: (data, deletedSessionId) => {
            setToast(data.message || `Session ${deletedSessionId} deleted successfully.`);
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
        onError: (error: Error, deletedSessionId) => {
            console.error(`Failed to delete session ${deletedSessionId}:`, error);
            setToast(`Error deleting session: ${error.message}`);
        },
        onSettled: () => {
            setIsDeleteConfirmOpen(false);
            setSessionToDelete(null);
        }
     });

    // Standalone Chat Create Mutation
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({ // Explicit types
        mutationFn: () => createStandaloneChatApi(),
        onSuccess: (newChat) => { // Type newChat explicitly
            setToast("New standalone chat created.");
            queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
            // Navigate to the new chat view
            navigate(`/chats/${newChat.id}`);
        },
        onError: (error: Error) => {
             setToast(`Error creating chat: ${error.message}`);
        }
    });

    // Standalone Chat Rename Mutation
    const renameChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null }>({ // Explicit types
        mutationFn: (variables: { chatId: number; newName: string | null }) =>
            renameStandaloneChatApi(variables.chatId, variables.newName),
        onSuccess: () => {
            setToast("Standalone chat renamed.");
            queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
            setIsRenameChatModalOpen(false);
            setChatToRename(null);
        },
        onError: (error: Error) => {
             setToast(`Error renaming chat: ${error.message}`);
             // Keep modal open to show error if needed
        }
    });

    // Standalone Chat Delete Mutation
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({ // Explicit types
         mutationFn: (chatId: number) => deleteStandaloneChatApi(chatId),
         onSuccess: (data, deletedChatId) => {
             setToast(data.message || `Standalone chat ${deletedChatId} deleted.`);
             queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
         },
         onError: (error: Error, deletedChatId) => {
              setToast(`Error deleting chat ${deletedChatId}: ${error.message}`);
         },
         onSettled: () => {
              setIsDeleteChatConfirmOpen(false);
              setChatToDelete(null);
         }
    });

    // Memoized sorting logic for sessions (unchanged)
    const sortedSessions = useMemo(() => {
        if (!sessions) return [];
        const criteria = currentSortCriteria;
        const direction = currentSortDirection;
        console.log(`[LandingPage] Sorting ${sessions.length} sessions by ${criteria} (${direction})`);
        const sorted = [...sessions].sort((a, b) => {
            let compareResult = 0;
            switch (criteria) {
                case 'sessionName':
                    const nameA = a.sessionName || a.fileName || '';
                    const nameB = b.sessionName || b.fileName || '';
                    compareResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
                    break;
                case 'clientName':
                    const clientA = a.clientName || '';
                    const clientB = b.clientName || '';
                    compareResult = clientA.localeCompare(clientB, undefined, { sensitivity: 'base' });
                    break;
                case 'sessionType':
                    const typeA = a.sessionType || '';
                    const typeB = b.sessionType || '';
                    compareResult = typeA.localeCompare(typeB, undefined, { sensitivity: 'base' });
                    break;
                case 'therapy':
                    const therapyA = a.therapy || '';
                    const therapyB = b.therapy || '';
                    compareResult = therapyA.localeCompare(therapyB, undefined, { sensitivity: 'base' });
                    break;
                case 'date':
                    const dateStrA = a.date || '';
                    const dateStrB = b.date || '';
                    compareResult = dateStrB.localeCompare(dateStrA);
                    break;
                case 'id':
                    compareResult = a.id - b.id;
                    break;
                default:
                    const _exhaustiveCheck: never = criteria;
                    console.warn(`[sortedSessions] Unknown sort criteria: ${criteria}`);
                    return 0;
            }
            if (direction === 'desc') {
                 if (!(criteria === 'date')) { compareResult *= -1; }
            } else {
                 if (criteria === 'date') { compareResult *= -1; }
            }
            return compareResult;
        });
        return sorted;
     }, [sessions, currentSortCriteria, currentSortDirection]);

     // --- Handlers ---

    // Session Handlers
    const handleSort = (criteria: SessionSortCriteria) => setSort(criteria);
    const handleEditSession = (session: Session) => { setSessionToEdit(session); setIsEditingModalOpen(true); };
    const handleEditSaveSuccess = () => { setIsEditingModalOpen(false); setSessionToEdit(null); };
    const handleDeleteSessionRequest = (session: Session) => { setSessionToDelete(session); setIsDeleteConfirmOpen(true); };
    const handleConfirmDeleteSession = () => { if (!sessionToDelete || deleteSessionMutation.isPending) return; deleteSessionMutation.mutate(sessionToDelete.id); };

    // Standalone Chat Handlers
    const handleNewStandaloneChat = () => { createStandaloneChatMutation.mutate(); };
    const handleRenameChatRequest = (chat: StandaloneChatListItem) => { setChatToRename(chat); setCurrentChatRenameValue(chat.name || ''); setIsRenameChatModalOpen(true); };
    const handleConfirmRenameChat = () => { if (!chatToRename || renameChatMutation.isPending) return; renameChatMutation.mutate({ chatId: chatToRename.id, newName: currentChatRenameValue.trim() || null }); };
    const handleDeleteChatRequest = (chat: StandaloneChatListItem) => { setChatToDelete(chat); setIsDeleteChatConfirmOpen(true); };
    const handleConfirmDeleteChat = () => { if (!chatToDelete || deleteChatMutation.isPending) return; deleteChatMutation.mutate(chatToDelete.id); };

    // --- Loading and Error States ---
    const isLoading = isLoadingSessions || isLoadingStandaloneChats;
    const error = sessionsError || standaloneChatsError;

    if (isLoading) {
        return (
            <Flex justify="center" align="center" style={{ height: '100vh' }}>
                <Spinner size="3" />
                <Text ml="2">Loading data...</Text>
            </Flex>
        );
    }
    if (error) {
         return (
            <Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}>
                <Text color="red" mb="4">{error?.message || 'Failed to load data.'}</Text>
                 <Button onClick={() => { refetchSessions(); refetchStandaloneChats(); }} variant="soft"> Try Again </Button>
            </Flex>
         );
     }

    return (
        <> {/* Fragment for content + modals */}
            <Box className="w-full flex-grow flex flex-col">
                {/* Header Bar */}
                <Box py="2" px={{ initial: '4', md: '6', lg: '8' }} flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }} >
                    <Flex justify="between">
                        {/* Placeholder for potential logo or title */}
                        <Box></Box>
                        <Flex gap="3" align="center">
                             <Button variant="outline" size="2" onClick={handleNewStandaloneChat} title="Start a new standalone chat" aria-label="Start new chat" disabled={createStandaloneChatMutation.isPending}>
                                {createStandaloneChatMutation.isPending ? <Spinner size="1"/> : <ChatBubbleIcon width="16" height="16" />}
                                <Text ml="2">New Chat</Text>
                             </Button>
                            <Button variant="soft" size="2" onClick={openUploadModal} title="Upload New Session" aria-label="Upload New Session">
                                <PlusCircledIcon width="16" height="16" /><Text ml="2">New Session</Text>
                            </Button>
                            <UserThemeDropdown />
                        </Flex>
                    </Flex>
                </Box>

                {/* Main Content Area */}
                <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8 overflow-y-auto">
                    <Container size="4" className="flex-grow flex flex-col">

                        {/* --- Standalone Chats Section --- */}
                        <Card size="3" className="flex flex-col overflow-hidden mb-6">
                            <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                                <Heading as="h2" size="5" weight="medium">
                                    <Flex align="center" gap="2"><ChatBubbleIcon />Standalone Chats</Flex>
                                </Heading>
                                {/* Button moved to top bar */}
                            </Flex>
                            <Box className="flex-grow flex flex-col overflow-hidden" style={{ minHeight: '200px' }}> {/* Ensure min height */}
                                {standaloneChats && standaloneChats.length > 0 ? (
                                    <StandaloneChatListTable
                                        chats={standaloneChats}
                                        onRenameChatRequest={handleRenameChatRequest}
                                        onDeleteChatRequest={handleDeleteChatRequest}
                                    />
                                ) : (
                                    <Flex flexGrow="1" align="center" justify="center" p="6">
                                        <Text color="gray">No standalone chats yet. Click "New Chat" to start one.</Text>
                                    </Flex>
                                )}
                             </Box>
                        </Card>
                        {/* --- End Standalone Chats Section --- */}

                        {/* --- Session History Section --- */}
                        <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                            <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                                <Heading as="h2" size="5" weight="medium">
                                    <Flex align="center" gap="2"><CounterClockwiseClockIcon />Session History</Flex>
                                </Heading>
                                {/* Button moved to top bar */}
                            </Flex>
                            <Box className="flex-grow flex flex-col overflow-hidden">
                                {sortedSessions.length === 0 ? (
                                    <Flex flexGrow="1" align="center" justify="center" p="6"><Text color="gray">No sessions found. Upload one to get started!</Text></Flex>
                                ) : (
                                    <SessionListTable
                                        sessions={sortedSessions}
                                        sortCriteria={currentSortCriteria}
                                        sortDirection={currentSortDirection}
                                        onSort={handleSort}
                                        onEditSession={handleEditSession}
                                        onDeleteSessionRequest={handleDeleteSessionRequest}
                                    />
                                )}
                            </Box>
                        </Card>
                         {/* --- End Session History Section --- */}

                    </Container>
                </Box>
            </Box>

            {/* Session Edit Modal */}
            <EditDetailsModal
                isOpen={isEditingModalOpen}
                onOpenChange={(open) => { setIsEditingModalOpen(open); if (!open) setSessionToEdit(null); }}
                session={sessionToEdit}
                onSaveSuccess={handleEditSaveSuccess}
            />

            {/* Session Delete Confirmation Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                 <AlertDialog.Content style={{ maxWidth: 450 }}>
                     <AlertDialog.Title>Delete Session</AlertDialog.Title>
                     <AlertDialog.Description size="2">
                         Are you sure you want to permanently delete the session
                         "<Text weight="bold">{sessionToDelete?.sessionName || sessionToDelete?.fileName || 'this session'}</Text>"?
                         <br/><br/>
                         This will remove the session record, original audio file, transcript, and all associated chats.
                         <Text weight="bold" color="red"> This action cannot be undone.</Text>
                     </AlertDialog.Description>
                     <Flex gap="3" mt="4" justify="end">
                          <AlertDialog.Cancel>
                              <Button variant="soft" color="gray" disabled={deleteSessionMutation.isPending}> Cancel </Button>
                          </AlertDialog.Cancel>
                          <AlertDialog.Action>
                              <Button color="red" onClick={handleConfirmDeleteSession} disabled={deleteSessionMutation.isPending}>
                                 {deleteSessionMutation.isPending ? <Spinner size="1"/> : <TrashIcon />}
                                 <Text ml="1">Delete Session</Text>
                              </Button>
                          </AlertDialog.Action>
                     </Flex>
                  </AlertDialog.Content>
            </AlertDialog.Root>

            {/* Standalone Chat Rename Modal */}
            <Dialog.Root open={isRenameChatModalOpen} onOpenChange={(open) => { if (!open) { setIsRenameChatModalOpen(false); setChatToRename(null); renameChatMutation.reset(); } else { setIsRenameChatModalOpen(true); } }}>
                 <Dialog.Content style={{ maxWidth: 450 }}>
                    <Dialog.Title>Rename Chat</Dialog.Title>
                    <Dialog.Description size="2" mb="4"> Enter a new name for this chat. Leave empty to remove the name. </Dialog.Description>
                    <TextField.Root
                        placeholder="Enter chat name (optional)"
                        value={currentChatRenameValue}
                        onChange={(e) => setCurrentChatRenameValue(e.target.value)}
                        disabled={renameChatMutation.isPending}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmRenameChat(); }}
                        autoFocus
                    />
                    {renameChatMutation.isError && <Text color="red" size="1" mt="2">Error: {renameChatMutation.error.message}</Text>}
                    <Flex gap="3" mt="4" justify="end">
                        <Button variant="soft" color="gray" onClick={() => setIsRenameChatModalOpen(false)} disabled={renameChatMutation.isPending}> <Cross2Icon /> Cancel </Button>
                        <Button onClick={handleConfirmRenameChat} disabled={renameChatMutation.isPending}> {renameChatMutation.isPending ? <Spinner size="1"/> : <CheckIcon />} Save Name </Button>
                    </Flex>
                 </Dialog.Content>
            </Dialog.Root>

            {/* Standalone Chat Delete Confirmation Modal */}
            <AlertDialog.Root open={isDeleteChatConfirmOpen} onOpenChange={setIsDeleteChatConfirmOpen}>
                 <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>Delete Chat</AlertDialog.Title>
                    <AlertDialog.Description size="2">
                        Are you sure you want to permanently delete the chat
                        "<Text weight="bold">{chatToDelete?.name || `Chat (${formatTimestamp(chatToDelete?.timestamp || 0)})`}</Text>"?
                        <Text weight="bold" color="red"> This action cannot be undone.</Text>
                    </AlertDialog.Description>
                     {deleteChatMutation.isError && <Text color="red" size="1" my="2">Error: {deleteChatMutation.error.message}</Text>}
                    <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel> <Button variant="soft" color="gray" disabled={deleteChatMutation.isPending}>Cancel</Button> </AlertDialog.Cancel>
                        <AlertDialog.Action>
                             <Button color="red" onClick={handleConfirmDeleteChat} disabled={deleteChatMutation.isPending}>
                                {deleteChatMutation.isPending ? <Spinner size="1"/> : <TrashIcon />} <Text ml="1">Delete Chat</Text>
                             </Button>
                         </AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
