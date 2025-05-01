// =========================================
// File: packages/ui/src/components/LandingPage/LandingPage.tsx
// =========================================
/*
 * packages/ui/src/components/LandingPage/LandingPage.tsx
 */
import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    CounterClockwiseClockIcon, PlusCircledIcon, TrashIcon,
    Pencil1Icon,
    ChatBubbleIcon,
    MagnifyingGlassIcon,
    Cross1Icon,
} from '@radix-ui/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionListTable } from './SessionListTable';
import { StandaloneChatListTable } from './StandaloneChatListTable';
import { SearchResultList } from '../Search/SearchResultList';
import { FilterControls } from './FilterControls'; // <-- Import FilterControls
import {
    Button, Card, Flex, Heading, Text, Box, Container, Spinner, AlertDialog,
    TextField,
    IconButton,
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
    searchMessages,
} from '../../api/api'; // <-- Use the barrel file
import {
    openUploadModalAtom,
    sessionSortCriteriaAtom,
    sessionSortDirectionAtom,
    setSessionSortAtom,
    SessionSortCriteria,
    standaloneChatSortCriteriaAtom,
    standaloneChatSortDirectionAtom,
    setStandaloneChatSortAtom,
    StandaloneChatSortCriteria,
    toastMessageAtom,
} from '../../store';
import type { Session, SessionMetadata, ChatSession, SearchApiResponse, SearchResultItem, StandaloneChatListItem } from '../../types'; // <-- Import StandaloneChatListItem from types
import { formatTimestamp } from '../../helpers';


export function LandingPage() {
    const openUploadModal = useSetAtom(openUploadModalAtom);
    const setToast = useSetAtom(toastMessageAtom);
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    // --- Search State ---
    const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
    const [activeSearchQuery, setActiveSearchQuery] = useState(searchParams.get('q') || '');
    const searchInputRef = useRef<HTMLInputElement>(null);

    // --- Filter State ---
    const [clientFilter, setClientFilter] = useState('');
    const [filterTags, setFilterTags] = useState<string[]>([]);
    const [newFilterTagInput, setNewFilterTagInput] = useState('');
    const currentSessionSortCriteria = useAtomValue(sessionSortCriteriaAtom);
    const currentSessionSortDirection = useAtomValue(sessionSortDirectionAtom);
    const setSessionSort = useSetAtom(setSessionSortAtom);

    // Standalone Chat Sort State
    const currentStandaloneChatSortCriteria = useAtomValue(standaloneChatSortCriteriaAtom);
    const currentStandaloneChatSortDirection = useAtomValue(standaloneChatSortDirectionAtom);
    const setStandaloneChatSort = useSetAtom(setStandaloneChatSortAtom);

    // Modal States
    const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
    const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
    const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
    const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(null);
    const [isDeleteChatConfirmOpen, setIsDeleteChatConfirmOpen] = useState(false);
    const [chatToDelete, setChatToDelete] = useState<StandaloneChatListItem | null>(null);

    // Queries
    const { data: sessions, isLoading: isLoadingSessions, error: sessionsError, refetch: refetchSessions } = useQuery<Session[], Error>({ queryKey: ['sessions'], queryFn: fetchSessions });
    const { data: standaloneChats, isLoading: isLoadingStandaloneChats, error: standaloneChatsError, refetch: refetchStandaloneChats } = useQuery<StandaloneChatListItem[], Error>({ queryKey: ['standaloneChats'], queryFn: fetchStandaloneChats });

    // --- Search Query (Triggers when activeSearchQuery changes) ---
    const { data: searchResultsData, isLoading: isLoadingSearch, error: searchError, isFetching: isFetchingSearch } = useQuery<SearchApiResponse, Error>({
        queryKey: ['searchMessages', activeSearchQuery],
        queryFn: () => {
            if (!activeSearchQuery) return Promise.resolve({ query: '', results: [] });
            console.log(`[Search Query] Fetching results for: "${activeSearchQuery}"`);
            return searchMessages(activeSearchQuery);
        },
        enabled: !!activeSearchQuery,
        staleTime: 5 * 60 * 1000,
    });
    // Accurate Client-Side Filtering
    const filteredSearchResults = useMemo(() => { // Filter logic remains here
        if (!searchResultsData?.results) return [];
        const lowerClientFilter = clientFilter.toLowerCase().trim();
        const lowerFilterTags = filterTags.map(tag => tag.toLowerCase());

        if (!lowerClientFilter && lowerFilterTags.length === 0) {
            return searchResultsData.results; // No filters applied
        }

        return searchResultsData.results.filter(item => { // Adjusted filtering logic
            const clientMatch = lowerClientFilter
                ? item.clientName?.toLowerCase() === lowerClientFilter
                : true;

            const tagsMatch = lowerFilterTags.length > 0
                ? lowerFilterTags.every(filterTag =>
                      item.tags?.some(itemTag => itemTag.toLowerCase() === filterTag)
                  )
                : true;

            return clientMatch && tagsMatch;
        });
    }, [searchResultsData, clientFilter, filterTags]);

    // Mutations (Unchanged)
    const deleteSessionMutation = useMutation<{ message: string }, Error, number>({ mutationFn: deleteSessionApi, onSuccess: (d,id)=>{setToast(d.message||`Session ${id} deleted`); queryClient.invalidateQueries({queryKey:['sessions']});}, onError:(e,id)=>{setToast(`Error deleting session ${id}: ${e.message}`);}, onSettled:()=>{setIsDeleteConfirmOpen(false);setSessionToDelete(null);} });
    const createStandaloneChatMutation = useMutation<StandaloneChatListItem, Error>({ mutationFn: createStandaloneChatApi, onSuccess: (d)=>{setToast("New chat created."); queryClient.invalidateQueries({queryKey:['standaloneChats']}); navigate(`/chats/${d.id}`);}, onError:(e)=>{setToast(`Error creating chat: ${e.message}`);} });
    const editChatMutation = useMutation<StandaloneChatListItem, Error, { chatId: number; newName: string | null; tags: string[] }>({ mutationFn: (v)=>editStandaloneChatApi(v.chatId,v.newName,v.tags), onSuccess: (d)=>{setToast("Chat details updated."); queryClient.setQueryData<StandaloneChatListItem[]>(['standaloneChats'],(old)=>old?.map(c=>c.id===d.id?{...c,name:d.name,tags:d.tags}:c)); queryClient.setQueryData<ChatSession>(['standaloneChat',d.id],(old)=>old?{...old,name:d.name??undefined, tags:d.tags??null}:old); setIsEditChatModalOpen(false); setChatToEdit(null);}, onError:(e)=>{setToast(`Error updating chat: ${e.message}`);} });
    const deleteChatMutation = useMutation<{ message: string }, Error, number>({ mutationFn: deleteStandaloneChatApi, onSuccess: (d,id)=>{setToast(d.message||`Chat ${id} deleted.`); queryClient.invalidateQueries({queryKey:['standaloneChats']});}, onError:(e,id)=>{setToast(`Error deleting chat ${id}: ${e.message}`);}, onSettled:()=>{setIsDeleteChatConfirmOpen(false);setChatToDelete(null);} });

    // Session Sorting Logic (Unchanged)
    const sortedSessions = useMemo(() => { /* ... */
         if (!sessions) return [];
         const criteria = currentSessionSortCriteria;
         const direction = currentSessionSortDirection;
         const getString = (value: string | null | undefined): string => value ?? '';
         return [...sessions].sort((a, b) => { let compareResult = 0; try { switch (criteria) { case 'sessionName': const nameA = getString(a.sessionName) || getString(a.fileName); const nameB = getString(b.sessionName) || getString(b.fileName); compareResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'clientName': compareResult = getString(a.clientName).localeCompare(getString(b.clientName), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'sessionType': compareResult = getString(a.sessionType).localeCompare(getString(b.sessionType), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'therapy': compareResult = getString(a.therapy).localeCompare(getString(b.therapy), undefined, { sensitivity: 'base', usage: 'sort' }); break; case 'date': compareResult = getString(b.date).localeCompare(getString(a.date)); break; case 'id': compareResult = (a.id ?? 0) - (b.id ?? 0); break; default: const _exhaustiveCheck: never = criteria; console.warn(`[sortedSessions] Unknown sort criteria: ${criteria}`); return 0; } } catch (e) { console.error(`Error during localeCompare for criteria "${criteria}":`, e); console.error("Comparing A:", a); console.error("Comparing B:", b); return 0; } if (direction === 'desc' && criteria !== 'date') { compareResult *= -1; } else if (direction === 'asc' && criteria === 'date') { compareResult *= -1; } return compareResult; });
      }, [sessions, currentSessionSortCriteria, currentSessionSortDirection]);

      // Standalone Chat Sorting (Unchanged)
      const sortedStandaloneChats = useMemo(() => { /* ... */
         if (!standaloneChats) return [];
         const criteria = currentStandaloneChatSortCriteria;
         const direction = currentStandaloneChatSortDirection;
         const chatsToSort = standaloneChats;
         const getString = (value: string | null | undefined): string => value ?? '';
         const getTagsString = (tags: string[] | null | undefined): string => (tags ?? []).join(', ');
         return [...chatsToSort].sort((a, b) => {
             let compareResult = 0;
             try {
                 switch (criteria) {
                     case 'name': const nameA = getString(a.name) || `Chat (${formatTimestamp(a.timestamp)})`; const nameB = getString(b.name) || `Chat (${formatTimestamp(b.timestamp)})`; compareResult = nameA.localeCompare(nameB, undefined, { sensitivity: 'base', usage: 'sort' }); break;
                     case 'date': compareResult = b.timestamp - a.timestamp; break;
                     case 'tags': compareResult = getTagsString(a.tags).localeCompare(getTagsString(b.tags), undefined, { sensitivity: 'base', usage: 'sort' }); break;
                     default: const _exhaustiveCheck: never = criteria; console.warn(`[sortedStandaloneChats] Unknown sort criteria: ${criteria}`); return 0;
                 }
             } catch (e) { console.error(`Error during localeCompare for criteria "${criteria}":`, e); return 0; }
             if (direction === 'desc' && criteria !== 'date') { compareResult *= -1; } else if (direction === 'asc' && criteria === 'date') { compareResult *= -1; } return compareResult;
         });
      }, [standaloneChats, currentStandaloneChatSortCriteria, currentStandaloneChatSortDirection]); // Dependencies unchanged


     // Handlers (Update search handlers)
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

    // --- Search Handlers ---
    const handleSearchInputChange = (event: React.ChangeEvent<HTMLInputElement>) => { // Logic unchanged
        setSearchInput(event.target.value);
    };

    const handleSearchSubmit = (event?: React.FormEvent<HTMLFormElement> | React.KeyboardEvent<HTMLInputElement>) => { // Logic unchanged
        if (event) event.preventDefault();
        const trimmedQuery = searchInput.trim();
        setActiveSearchQuery(trimmedQuery);

        if (trimmedQuery) {
            setSearchParams({ q: trimmedQuery }, { replace: true });
        } else {
            searchParams.delete('q');
            setSearchParams(searchParams, { replace: true });
        }
        requestAnimationFrame(() => searchInputRef.current?.focus());
    };

    const handleClearSearch = useCallback(() => { // Logic unchanged
        setSearchInput('');
        setActiveSearchQuery('');
        setClientFilter('');
        setFilterTags([]);
        setNewFilterTagInput('');
        searchParams.delete('q');
        setSearchParams(searchParams, { replace: true });
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, [searchParams, setSearchParams]);

    const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => { // Logic unchanged
        if (event.key === 'Enter') {
            handleSearchSubmit(event);
        } else if (event.key === 'Escape') {
            handleClearSearch();
        }
    };
    // --- End Search Handlers ---

    // --- Tag Filter Handlers ---
    const handleAddFilterTag = useCallback(() => { // Logic unchanged
        const tagToAdd = newFilterTagInput.trim();
        if (tagToAdd && !filterTags.some(tag => tag.toLowerCase() === tagToAdd.toLowerCase())) {
            if (filterTags.length < 5) {
                setFilterTags(prev => [...prev, tagToAdd]);
                setNewFilterTagInput('');
            } else {
                setToast("Maximum of 5 filter tags allowed.");
            }
        }
        setNewFilterTagInput('');
    }, [newFilterTagInput, filterTags, setToast]);

    const handleRemoveFilterTag = useCallback((tagToRemove: string) => {
        setFilterTags(prev => prev.filter(tag => tag !== tagToRemove)); // Logic unchanged
    }, []);

    const handleFilterTagInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => { // Logic unchanged
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            handleAddFilterTag();
        }
    }, [handleAddFilterTag]);
    // --- End Tag Filter Handlers ---

    // --- Escape Key Listener ---
    useEffect(() => { // Logic unchanged
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !!activeSearchQuery) {
                handleClearSearch();
            }
        };
        if (activeSearchQuery) {
            document.addEventListener('keydown', handleKeyDown);
        } else {
            document.removeEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeSearchQuery, handleClearSearch]);
    // --- End Escape Key Listener ---

    // --- Auto Focus Effect ---
    useEffect(() => { // Logic unchanged
        if (activeSearchQuery && searchInputRef.current) {
             requestAnimationFrame(() => {
                searchInputRef.current?.focus();
            });
        }
        // No change needed here
    }, [activeSearchQuery]);
    // --- End Auto Focus Effect ---


    // Loading and Error States (Unchanged)
    const isLoading = isLoadingSessions || isLoadingStandaloneChats;
    const error = sessionsError || standaloneChatsError;

    if (isLoading) { return (<Flex justify="center" align="center" style={{ height: '100vh' }}><Spinner size="3" /><Text ml="2">Loading data...</Text></Flex>); }
    if (error) { return (<Flex direction="column" justify="center" align="center" style={{ height: '100vh', padding: '2rem' }}><Text color="red" mb="4">{error?.message||'Failed load data.'}</Text><Button onClick={()=>{refetchSessions();refetchStandaloneChats();}} variant="soft">Try Again</Button></Flex>); }

    // Show search results if an active search query exists
    const showSearchResults = !!activeSearchQuery;
    const hasInitialResults = searchResultsData?.results && searchResultsData.results.length > 0;

    return (
        <> {/* Fragment for content + modals */}
            <Box className="w-full flex-grow flex flex-col">
                {/* Header Bar */}
                <Box py="2" px={{ initial: '4', md: '6', lg: '8' }} flexShrink="0" style={{ backgroundColor: 'var(--color-panel-solid)', borderBottom: '1px solid var(--gray-a6)' }} >
                    <Container>
                        {/* Search Input */}
                        <Flex justify="between" align="center" gap="4">
                            <Box style={{ flexGrow: 1 }}>
                                <TextField.Root
                                    ref={searchInputRef}
                                    size="2"
                                    placeholder="Search all messages and transcripts..."
                                    value={searchInput}
                                    onChange={handleSearchInputChange}
                                    onKeyDown={handleSearchKeyDown}
                                    disabled={isFetchingSearch}
                                >
                                    <TextField.Slot>
                                        <MagnifyingGlassIcon height="16" width="16" />
                                    </TextField.Slot>
                                    {(isLoadingSearch || isFetchingSearch) && <TextField.Slot><Spinner size="1"/></TextField.Slot>}
                                    {searchInput && !(isLoadingSearch || isFetchingSearch) && (
                                        <TextField.Slot pr="2">
                                            <IconButton size="1" variant="ghost" color="gray" onClick={handleClearSearch} aria-label="Clear search" title="Clear search (Esc)">
                                                <Cross1Icon />
                                            </IconButton>
                                        </TextField.Slot>
                                    )}
                                </TextField.Root>
                            </Box>
                            {/* Right side buttons (unchanged) */}
                            <Flex gap="3" align="center" flexShrink="0">
                                <Button variant="outline" size="2" onClick={handleNewStandaloneChat} disabled={createStandaloneChatMutation.isPending}><ChatBubbleIcon width="16" height="16" /><Text ml="2">New Chat</Text></Button>
                                <Button variant="soft" size="2" onClick={openUploadModal}><PlusCircledIcon width="16" height="16" /><Text ml="2">New Session</Text></Button>
                                <UserThemeDropdown />
                            </Flex>
                        </Flex>
                         {/* --- Render FilterControls Component --- */}
                        {showSearchResults && (
                            <FilterControls sessions={sessions} clientFilter={clientFilter} setClientFilter={setClientFilter} filterTags={filterTags} setFilterTags={setFilterTags} newFilterTagInput={newFilterTagInput} setNewFilterTagInput={setNewFilterTagInput} onAddFilterTag={handleAddFilterTag} onRemoveFilterTag={handleRemoveFilterTag} onFilterTagInputKeyDown={handleFilterTagInputKeyDown} />
                          )}
                    </Container>
                </Box>

                {/* Main Content Area */}
                <Box className="flex-grow flex flex-col py-4 md:py-6 lg:py-8 overflow-y-auto">
                    <Container size="4" className="flex-grow flex flex-col">

                        {/* Conditional Rendering: Search Results or Default View */}
                        {showSearchResults ? (
                            <>
                                {(isLoadingSearch || isFetchingSearch) && !searchError && (
                                    <Flex justify="center" align="center" p="6">
                                        <Spinner size="3" />
                                        <Text ml="2" color="gray">Searching...</Text>
                                    </Flex>
                                )}
                                {searchError && (
                                    <Card size="2" mb="4">
                                        <Text color="red">Error searching: {searchError.message}</Text>
                                    </Card>
                                )}
                                {/* Render SearchResultList only if initial results exist */}
                                {hasInitialResults && !isLoadingSearch && !isFetchingSearch && (
                                    <SearchResultList results={filteredSearchResults} query={activeSearchQuery} />
                                )}
                                {/* Show "No results found" if initial fetch returned empty */}
                                {!searchError && !isLoadingSearch && !isFetchingSearch && !hasInitialResults && (
                                    <Card size="2" mb="4">
                                        <Text color="gray">No results found for "{activeSearchQuery}".</Text>
                                    </Card>
                                )}
                                 {/* Show "No results match filters" only if initial results existed but filters hide them all */}
                                 {!searchError && !isLoadingSearch && !isFetchingSearch && hasInitialResults && filteredSearchResults.length === 0 && (
                                    <Card size="2" mb="4">
                                        <Text color="gray">No results match the current filters for "{activeSearchQuery}".</Text>
                                    </Card>
                                 )}
                             </>
                        ) : (
                            <>
                                {/* Standalone Chats Section (Original) */}
                                <Card size="3" className="flex flex-col overflow-hidden mb-6">
                                    <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}>
                                        <Heading as="h2" size="5" weight="medium"><Flex align="center" gap="2"><ChatBubbleIcon />Standalone Chats</Flex></Heading>
                                    </Flex>
                                    <Box className="flex-grow flex flex-col overflow-hidden" style={{ minHeight: '200px' }}>
                                        {sortedStandaloneChats && sortedStandaloneChats.length > 0 ? (
                                            <StandaloneChatListTable
                                                chats={sortedStandaloneChats}
                                                sortCriteria={currentStandaloneChatSortCriteria}
                                                sortDirection={currentStandaloneChatSortDirection}
                                                onSort={handleStandaloneChatSort}
                                                onEditChatRequest={handleEditChatRequest}
                                                onDeleteChatRequest={handleDeleteChatRequest}
                                            />
                                        ) : (
                                            <Flex flexGrow="1" align="center" justify="center" p="6"><Text color="gray">'No standalone chats yet. Click "New Chat".'</Text></Flex>
                                        )}
                                    </Box>
                                </Card>

                                {/* Session History Section (Original) */}
                                <Card size="3" className="flex-grow flex flex-col overflow-hidden h-full">
                                     <Flex justify="between" align="center" px="4" pt="4" pb="3" style={{ borderBottom: '1px solid var(--gray-a6)' }}> <Heading as="h2" size="5" weight="medium"><Flex align="center" gap="2"><CounterClockwiseClockIcon />Session History</Flex></Heading> </Flex>
                                    <Box className="flex-grow flex flex-col overflow-hidden">
                                        {sortedSessions.length === 0 ? ( <Flex flexGrow="1" align="center" justify="center" p="6"><Text color="gray">No sessions found.</Text></Flex> ) : ( <SessionListTable sessions={sortedSessions} sortCriteria={currentSessionSortCriteria} sortDirection={currentSessionSortDirection} onSort={handleSessionSort} onEditSession={handleEditSession} onDeleteSessionRequest={handleDeleteSessionRequest} /> )}
                                    </Box>
                                </Card>
                            </>
                        )}

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
