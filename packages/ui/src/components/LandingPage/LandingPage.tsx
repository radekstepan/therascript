import React, { useMemo, useState } from 'react'; // <-- Import useState
import { useAtomValue, useSetAtom } from 'jotai';
import { CounterClockwiseClockIcon, PlusCircledIcon, TrashIcon } from '@radix-ui/react-icons'; // <-- Added TrashIcon
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'; // <-- Import useMutation
import { SessionListTable } from './SessionListTable';
import { Button, Card, Flex, Heading, Text, Box, Container, Spinner, AlertDialog } from '@radix-ui/themes'; // <-- Added AlertDialog
import { UserThemeDropdown } from '../User/UserThemeDropdown';
// <-- Import EditDetailsModal
import { EditDetailsModal } from '../SessionView/Modals/EditDetailsModal';
import { fetchSessions, deleteSession as deleteSessionApi } from '../../api/api'; // <-- Import deleteSession API
import {
    openUploadModalAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria,
    toastMessageAtom // <-- Import toast atom
} from '../../store';
// <-- Import SessionMetadata type
import type { Session, SessionMetadata } from '../../types';

export function LandingPage() {
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const setToast = useSetAtom(toastMessageAtom); // <-- For toast feedback
    const currentSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSort = useSetAtom(setSessionSortAtom);
    const queryClient = useQueryClient(); // <-- Get query client instance

    // *** State for Edit Modal ***
    const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
    const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);

    // *** State for Delete Confirmation Modal ***
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);

    // Fetch sessions using Tanstack Query
    const { data: sessions, isLoading, error, refetch } = useQuery<Session[], Error>({
        queryKey: ['sessions'],
        queryFn: fetchSessions,
    });

    // --- Delete Session Mutation ---
    const deleteSessionMutation = useMutation({
        mutationFn: (sessionId: number) => deleteSessionApi(sessionId),
        onSuccess: (data, deletedSessionId) => {
            setToast(data.message || `Session ${deletedSessionId} deleted successfully.`);
            // Invalidate the sessions list query to refresh the table
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            // Optionally, remove specific session details if cached elsewhere, though unlikely for landing page
            // queryClient.removeQueries({ queryKey: ['sessionMeta', deletedSessionId] });
            // queryClient.removeQueries({ queryKey: ['transcript', deletedSessionId] });
            // queryClient.removeQueries({ queryKey: ['chat', deletedSessionId], exact: false }); // Remove all chats for that session
        },
        onError: (error: Error, deletedSessionId) => {
            console.error(`Failed to delete session ${deletedSessionId}:`, error);
            setToast(`Error deleting session: ${error.message}`);
        },
        onSettled: () => {
            // Close the confirmation modal regardless of outcome
            setIsDeleteConfirmOpen(false);
            setSessionToDelete(null);
        }
    });
    // --- End Delete Mutation ---


    // Memoized sorting logic (no changes needed here)
    const sortedSessions = useMemo(() => { /* ... sorting logic ... */
        if (!sessions) return [];
        const criteria = currentSortCriteria;
        const direction = currentSortDirection;
        console.log(`[LandingPage] Sorting ${sessions.length} sessions by ${criteria} (${direction})`);
        const sorted = [...sessions].sort((a, b) => {
            let compareResult = 0;
            switch (criteria) {
                // ... cases for sessionName, clientName, sessionType, therapy ...
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
                    // if (compareResult === 0) { compareResult = b.id - a.id; } // Optional tie-breaker
                    break;
                case 'id':
                    compareResult = a.id - b.id;
                    break;
                default:
                    const _exhaustiveCheck: never = criteria;
                    console.warn(`[sortedSessions] Unknown sort criteria: ${criteria}`);
                    return 0;
            }
            // Apply direction reversal if needed
            if (direction === 'desc') {
                 if (!(criteria === 'date')) { compareResult *= -1; }
            } else { // direction === 'asc'
                 if (criteria === 'date') { compareResult *= -1; }
            }
            return compareResult;
        });
        return sorted;
     }, [sessions, currentSortCriteria, currentSortDirection]);


    // Handler for sorting (passed to table)
    const handleSort = (criteria: SessionSortCriteria) => {
        console.log("[LandingPage] handleSort called with criteria:", criteria);
        setSort(criteria);
    };

    // *** Handler to open the edit modal ***
    const handleEditSession = (session: Session) => {
        setSessionToEdit(session);
        setIsEditingModalOpen(true);
    };

    // *** Handler for successful save from modal ***
    const handleEditSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
        console.log("[LandingPage] Edit modal saved:", updatedMetadata);
        // The modal's mutation already invalidates queries, so UI should update.
        // Optionally, manually update cache here if needed, but invalidation is usually sufficient.
        // queryClient.invalidateQueries({ queryKey: ['sessions'] }); // Already done by modal mutation
        setIsEditingModalOpen(false); // Close modal
        setSessionToEdit(null);
    };

    // *** Handler to open the delete confirmation modal ***
    const handleDeleteSessionRequest = (session: Session) => {
        setSessionToDelete(session);
        setIsDeleteConfirmOpen(true);
    };

    // *** Handler to confirm deletion ***
    const handleConfirmDelete = () => {
        if (!sessionToDelete || deleteSessionMutation.isPending) return;
        deleteSessionMutation.mutate(sessionToDelete.id);
        // Don't close modal here, mutation's onSettled will handle it
    };


    if (isLoading) { /* ... loading state ... */
        return (
            <Flex justify="center" align="center" style={{ height: '100vh' }}>
                <Spinner size="3" />
                <Text ml="2">Loading sessions...</Text>
            </Flex>
        );
    }
    if (error || (!sessions && !isLoading)) { /* ... error state ... */
         return (
            <Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}>
                <Text color="red" mb="4">{error?.message || 'Failed to load sessions.'}</Text>
                 <Button onClick={() => refetch()} variant="soft">
                    Try Again
                </Button>
            </Flex>
         );
     }

    // Main content render
    return (
        <> {/* Fragment to contain main content and modals */}
            <Box className="w-full flex-grow flex flex-col">
                {/* Header Bar */}
                <Box py="2" px={{ initial: '4', md: '6', lg: '8' }} flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }} >
                    <Flex justify="end">
                        <UserThemeDropdown />
                    </Flex>
                </Box>
                {/* Main Content Area */}
                <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8">
                    <Container size="4" className="flex-grow flex flex-col">
                        {/* Session List Card */}
                        <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                            {/* Card Header */}
                            <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                                <Heading as="h2" size="5" weight="medium">
                                    <Flex align="center" gap="2"><CounterClockwiseClockIcon />Session History</Flex>
                                </Heading>
                                <Button variant="soft" size="2" onClick={openUploadModal} title="Upload New Session" aria-label="Upload New Session">
                                    <PlusCircledIcon width="16" height="16" /><Text ml="2">New Session</Text>
                                </Button>
                            </Flex>
                            {/* Card Body - Table or Empty State */}
                            <Box className="flex-grow flex flex-col overflow-hidden">
                                {sortedSessions.length === 0 && !isLoading ? (
                                    <Flex flexGrow="1" align="center" justify="center" p="6"><Text color="gray">No sessions found. Upload one to get started!</Text></Flex>
                                ) : (
                                    <SessionListTable
                                        sessions={sortedSessions}
                                        sortCriteria={currentSortCriteria}
                                        sortDirection={currentSortDirection}
                                        onSort={handleSort}
                                        onEditSession={handleEditSession}
                                        // *** Pass delete request handler down ***
                                        onDeleteSessionRequest={handleDeleteSessionRequest}
                                    />
                                )}
                            </Box>
                        </Card>
                    </Container>
                </Box>
            </Box>

            {/* *** Render Edit Modal *** */}
            <EditDetailsModal
                isOpen={isEditingModalOpen}
                onOpenChange={(open) => {
                    setIsEditingModalOpen(open);
                    if (!open) setSessionToEdit(null); // Clear session when closing
                }}
                session={sessionToEdit}
                onSaveSuccess={handleEditSaveSuccess}
            />

            {/* *** Render Delete Confirmation Modal *** */}
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
                             <Button color="red" onClick={handleConfirmDelete} disabled={deleteSessionMutation.isPending}>
                                {deleteSessionMutation.isPending ? <Spinner size="1"/> : <TrashIcon />}
                                <Text ml="1">Delete Session</Text>
                             </Button>
                         </AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
