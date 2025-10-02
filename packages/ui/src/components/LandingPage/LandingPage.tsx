// packages/ui/src/components/LandingPage/LandingPage.tsx
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  CounterClockwiseClockIcon,
  TrashIcon,
  ChatBubbleIcon,
  BarChartIcon, // <-- ADDED
} from '@radix-ui/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SessionListTable } from './SessionListTable';
import { StandaloneChatListTable } from './StandaloneChatListTable';
import { SearchResultList } from '../Search/SearchResultList';
import { FilterControls } from './FilterControls';
import {
  Button,
  Card,
  Flex,
  Heading,
  Text,
  Box,
  Spinner,
  AlertDialog,
} from '@radix-ui/themes';
import { EditDetailsModal } from '../SessionView/Modals/EditDetailsModal';
import { EditStandaloneChatModal } from '../StandaloneChatView/EditStandaloneChatModal';
import { CreateAnalysisJobModal } from '../Analysis/CreateAnalysisJobModal'; // <-- ADDED
import {
  fetchSessions,
  deleteSession as deleteSessionApi,
  fetchStandaloneChats,
  deleteStandaloneChat as deleteStandaloneChatApi,
  searchMessages,
} from '../../api/api';
import {
  sessionSortCriteriaAtom,
  sessionSortDirectionAtom,
  setSessionSortAtom,
  SessionSortCriteria,
  standaloneChatSortCriteriaAtom,
  standaloneChatSortDirectionAtom,
  setStandaloneChatSortAtom,
  StandaloneChatSortCriteria,
  toastMessageAtom,
  activeChatIdAtom,
} from '../../store';
import type {
  Session,
  SessionMetadata,
  SearchApiResponse,
  StandaloneChatListItem,
} from '../../types';
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils';

export function LandingPage() {
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const activeSearchQuery = searchParams.get('q') || '';
  const navigate = useNavigate();
  const activeChatId = useAtomValue(activeChatIdAtom);

  const [clientFilter, setClientFilter] = useState('');

  // Session states
  const currentSessionSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSessionSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSessionSort = useSetAtom(setSessionSortAtom);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
  const [isDeleteSessionConfirmOpen, setIsDeleteSessionConfirmOpen] =
    useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  // --- FIX: ADDED STATE FOR LANDING PAGE SELECTION ---
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<number>>(
    new Set()
  );
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  // --- END FIX ---

  // Standalone Chat states
  const currentStandaloneChatSortCriteria = useAtomValue(
    standaloneChatSortCriteriaAtom
  );
  const currentStandaloneChatSortDirection = useAtomValue(
    standaloneChatSortDirectionAtom
  );
  const setStandaloneChatSort = useSetAtom(setStandaloneChatSortAtom);
  const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );
  const [isDeleteChatConfirmOpen, setIsDeleteChatConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] =
    useState<StandaloneChatListItem | null>(null);

  // Fetch sessions
  const {
    data: sessions,
    isLoading: isLoadingSessions,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery<Session[], Error>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  });

  // Fetch standalone chats
  const {
    data: standaloneChats,
    isLoading: isLoadingStandaloneChats,
    error: standaloneChatsError,
    refetch: refetchStandaloneChats,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
  });

  // Fetch search results
  const {
    data: searchResultsData,
    isLoading: isLoadingSearch,
    error: searchError,
    isFetching: isFetchingSearch,
  } = useQuery<SearchApiResponse, Error>({
    queryKey: ['searchMessages', activeSearchQuery, clientFilter],
    queryFn: () => {
      if (!activeSearchQuery)
        return Promise.resolve({ query: '', results: [], total: 0 });
      return searchMessages(
        activeSearchQuery,
        50,
        0,
        clientFilter || undefined,
        'all'
      );
    },
    enabled: !!activeSearchQuery,
    staleTime: 5 * 60 * 1000,
  });

  const deleteSessionMutation = useMutation<{ message: string }, Error, number>(
    {
      mutationFn: deleteSessionApi,
      onSuccess: (data, id) => {
        setToast(data.message || `Session ${id} deleted`);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
        // --- FIX: Deselect on delete ---
        setSelectedSessionIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
        // --- END FIX ---
      },
      onError: (e, id) => {
        setToast(`Error deleting session ${id}: ${e.message}`);
      },
      onSettled: () => {
        setIsDeleteSessionConfirmOpen(false);
        setSessionToDelete(null);
      },
    }
  );

  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: deleteStandaloneChatApi,
    onSuccess: (data, deletedId) => {
      setToast(data.message || `Chat ${deletedId} deleted.`);
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      queryClient.removeQueries({
        queryKey: ['standaloneChat', deletedId],
      });
      if (activeChatId === deletedId) {
        navigate('/');
      }
    },
    onError: (e, id) => {
      setToast(`Error deleting chat ${id}: ${e.message}`);
    },
    onSettled: () => {
      setIsDeleteChatConfirmOpen(false);
      setChatToDelete(null);
    },
  });

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    if (activeSearchQuery) return sessions;
    const lowerClientFilter = clientFilter.toLowerCase().trim();
    if (!lowerClientFilter) return sessions;
    return sessions.filter((s) =>
      s.clientName?.toLowerCase().includes(lowerClientFilter)
    );
  }, [sessions, clientFilter, activeSearchQuery]);

  const filteredStandaloneChats = useMemo(() => {
    if (!standaloneChats) return [];
    if (activeSearchQuery) return standaloneChats;
    return standaloneChats;
  }, [standaloneChats, activeSearchQuery]);

  const sortedSessions = useMemo(() => {
    if (!filteredSessions) return [];
    const criteria = currentSessionSortCriteria;
    const direction = currentSessionSortDirection;
    const getString = (value: string | null | undefined): string => value ?? '';
    return [...filteredSessions].sort((a, b) => {
      let compareResult = 0;
      try {
        switch (criteria) {
          case 'sessionName':
            const nameA = getString(a.sessionName) || getString(a.fileName);
            const nameB = getString(b.sessionName) || getString(b.fileName);
            compareResult = nameA.localeCompare(nameB, undefined, {
              sensitivity: 'base',
              usage: 'sort',
            });
            break;
          case 'clientName':
            compareResult = getString(a.clientName).localeCompare(
              getString(b.clientName),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'sessionType':
            compareResult = getString(a.sessionType).localeCompare(
              getString(b.sessionType),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'therapy':
            compareResult = getString(a.therapy).localeCompare(
              getString(b.therapy),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
            break;
          case 'date':
            compareResult = getString(b.date).localeCompare(getString(a.date));
            break;
          case 'id':
            compareResult = (a.id ?? 0) - (b.id ?? 0);
            break;
          default:
            return 0;
        }
      } catch (e) {
        return 0;
      }
      if (direction === 'desc' && criteria !== 'date') compareResult *= -1;
      else if (direction === 'asc' && criteria === 'date') compareResult *= -1;
      return compareResult;
    });
  }, [
    filteredSessions,
    currentSessionSortCriteria,
    currentSessionSortDirection,
  ]);

  const sortedStandaloneChats = useMemo(() => {
    if (!filteredStandaloneChats) return [];
    const criteria = currentStandaloneChatSortCriteria;
    const direction = currentStandaloneChatSortDirection;
    const getString = (value: string | null | undefined): string => value ?? '';
    return [...filteredStandaloneChats].sort((a, b) => {
      let compareResult = 0;
      try {
        switch (criteria) {
          case 'name':
            const nameA =
              getString(a.name) || `Chat (${formatTimestamp(a.timestamp)})`;
            const nameB =
              getString(b.name) || `Chat (${formatTimestamp(b.timestamp)})`;
            compareResult = nameA.localeCompare(nameB, undefined, {
              sensitivity: 'base',
              usage: 'sort',
            });
            break;
          case 'date':
            compareResult = b.timestamp - a.timestamp;
            break;
          case 'tags':
            const tagsA = (a.tags ?? []).join(', ');
            const tagsB = (b.tags ?? []).join(', ');
            compareResult = tagsA.localeCompare(tagsB, undefined, {
              sensitivity: 'base',
              usage: 'sort',
            });
            break;
          default:
            return 0;
        }
      } catch (e) {
        return 0;
      }
      if (direction === 'desc' && criteria !== 'date') compareResult *= -1;
      else if (direction === 'asc' && criteria === 'date') compareResult *= -1;
      return compareResult;
    });
  }, [
    filteredStandaloneChats,
    currentStandaloneChatSortCriteria,
    currentStandaloneChatSortDirection,
  ]);

  const handleSessionSort = (criteria: SessionSortCriteria) =>
    setSessionSort(criteria);
  const handleStandaloneChatSort = (criteria: StandaloneChatSortCriteria) =>
    setStandaloneChatSort(criteria);
  const handleEditSession = (session: Session) => {
    setSessionToEdit(session);
    setIsEditingModalOpen(true);
  };
  const handleEditSaveSuccess = () => {
    setIsEditingModalOpen(false);
    setSessionToEdit(null);
    setToast('Session details updated.');
  };
  const handleDeleteSessionRequest = (session: Session) => {
    setSessionToDelete(session);
    setIsDeleteSessionConfirmOpen(true);
  };
  const handleConfirmDeleteSession = () => {
    if (sessionToDelete) deleteSessionMutation.mutate(sessionToDelete.id);
  };
  const handleEditChatRequest = (chat: StandaloneChatListItem) => {
    setChatToEdit(chat);
    setIsEditChatModalOpen(true);
  };
  const handleDeleteChatRequest = (chat: StandaloneChatListItem) => {
    setChatToDelete(chat);
    setIsDeleteChatConfirmOpen(true);
  };
  const handleConfirmDeleteChat = () => {
    if (chatToDelete) {
      deleteChatMutation.mutate(chatToDelete.id);
    }
  };

  const isLoadingAnyData =
    isLoadingSessions ||
    isLoadingStandaloneChats ||
    (!!activeSearchQuery && (isLoadingSearch || isFetchingSearch));
  const anyError =
    sessionsError ||
    standaloneChatsError ||
    (!!activeSearchQuery && searchError);

  if (
    (isLoadingSessions || isLoadingStandaloneChats) &&
    !anyError &&
    !activeSearchQuery
  ) {
    return (
      <Flex
        justify="center"
        align="center"
        className={cn('px-4 md:px-6 lg:px-8', 'py-6 md:py-8 lg:py-10')}
        style={{ height: 'calc(100vh - 64px)' }}
      >
        <Spinner size="3" /> <Text ml="2">Loading data...</Text>
      </Flex>
    );
  }
  if ((sessionsError || standaloneChatsError) && !activeSearchQuery) {
    return (
      <Flex
        direction="column"
        justify="center"
        align="center"
        className={cn('px-4 md:px-6 lg:px-8', 'py-6 md:py-8 lg:py-10')}
        style={{ height: 'calc(100vh - 64px)' }}
      >
        <Text color="red" mb="4">
          {(sessionsError || standaloneChatsError)?.message ||
            'Failed to load data.'}
        </Text>
        <Button
          onClick={() => {
            refetchSessions();
            refetchStandaloneChats();
          }}
        >
          Retry
        </Button>
      </Flex>
    );
  }

  const showSearchResultsView = !!activeSearchQuery;
  const searchResults = searchResultsData?.results || [];
  const totalSearchHits = searchResultsData?.total || 0;

  return (
    <>
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'py-4 md:py-6 lg:py-8',
          'px-4 md:px-6 lg:px-8'
        )}
      >
        {/* --- Conditionally render FilterControls --- */}
        {showSearchResultsView && (
          <Box mb="4">
            <FilterControls
              sessions={sessions}
              clientFilter={clientFilter}
              setClientFilter={setClientFilter}
            />
          </Box>
        )}
        {/* --- End Conditional render --- */}

        {showSearchResultsView ? (
          <>
            {(isLoadingSearch || isFetchingSearch) && !searchError && (
              <Flex justify="center" align="center" p="6">
                <Spinner size="3" />{' '}
                <Text ml="2" color="gray">
                  Searching...
                </Text>
              </Flex>
            )}
            {searchError && (
              <Card size="2" mb="4" style={{ width: '100%' }}>
                <Text color="red">Error searching: {searchError.message}</Text>
              </Card>
            )}
            {!isLoadingSearch && !isFetchingSearch && !searchError && (
              <SearchResultList
                results={searchResults}
                query={activeSearchQuery}
                totalHits={totalSearchHits}
              />
            )}
            {!searchError &&
              !isLoadingSearch &&
              !isFetchingSearch &&
              searchResults.length === 0 && (
                <Card size="2" mb="4" style={{ width: '100%' }}>
                  <Text color="gray">
                    No results found for "{activeSearchQuery}" with the current
                    filters.
                  </Text>
                </Card>
              )}
          </>
        ) : (
          <>
            {/* Session History Card - MOVED TO TOP */}
            <Card
              size="3"
              className="flex-grow flex flex-col overflow-hidden mb-6"
              style={{ width: '100%' }}
            >
              <Flex justify="between" align="center" px="4" pt="4" pb="3">
                <Heading
                  as="h2"
                  size="5"
                  weight="medium"
                  className="text-gray-800 dark:text-gray-200"
                >
                  <Flex align="center" gap="2">
                    <CounterClockwiseClockIcon /> Session History
                  </Flex>
                </Heading>
                {/* --- FIX: ADDED ANALYSIS BUTTON --- */}
                <Button
                  variant="solid"
                  size="2"
                  onClick={() => setIsAnalysisModalOpen(true)}
                  disabled={selectedSessionIds.size === 0}
                >
                  <BarChartIcon />
                  Analyze Selected ({selectedSessionIds.size})
                </Button>
                {/* --- END FIX --- */}
              </Flex>
              <Box className="flex-grow flex flex-col overflow-hidden">
                {sortedSessions.length === 0 ? (
                  <Flex flexGrow="1" align="center" justify="center" p="6">
                    <Text color="gray">
                      No sessions found. Click "New Session" in the toolbar.
                    </Text>
                  </Flex>
                ) : (
                  // --- FIX: PASS SELECTION PROPS ---
                  <SessionListTable
                    sessions={sortedSessions}
                    sortCriteria={currentSessionSortCriteria}
                    sortDirection={currentSessionSortDirection}
                    onSort={handleSessionSort}
                    onEditSession={handleEditSession}
                    onDeleteSessionRequest={handleDeleteSessionRequest}
                    selectedIds={selectedSessionIds}
                    onSelectionChange={setSelectedSessionIds}
                  />
                  // --- END FIX ---
                )}
              </Box>
            </Card>

            {/* Standalone Chats Card - MOVED TO BOTTOM */}
            <Card
              size="3"
              className="flex flex-col overflow-hidden"
              style={{ width: '100%' }}
            >
              <Flex justify="between" align="center" px="4" pt="4" pb="3">
                <Heading
                  as="h2"
                  size="5"
                  weight="medium"
                  className="text-gray-800 dark:text-gray-200"
                >
                  <Flex align="center" gap="2">
                    <ChatBubbleIcon /> Standalone Chats
                  </Flex>
                </Heading>
              </Flex>
              <Box
                className="flex-grow flex flex-col overflow-hidden"
                style={{ minHeight: '200px' }}
              >
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
                  <Flex flexGrow="1" align="center" justify="center" p="6">
                    <Text color="gray">
                      No standalone chats yet. Click "New Chat" in the toolbar.
                    </Text>
                  </Flex>
                )}
              </Box>
            </Card>
          </>
        )}
      </Box>

      <EditDetailsModal
        isOpen={isEditingModalOpen}
        onOpenChange={(open: boolean) => {
          setIsEditingModalOpen(open);
          if (!open) setSessionToEdit(null);
        }}
        session={sessionToEdit}
        onSaveSuccess={handleEditSaveSuccess}
      />
      {/* --- FIX: ADD ANALYSIS MODAL --- */}
      <CreateAnalysisJobModal
        isOpen={isAnalysisModalOpen}
        onOpenChange={setIsAnalysisModalOpen}
        sessionIds={Array.from(selectedSessionIds)}
      />
      {/* --- END FIX --- */}
      <AlertDialog.Root
        open={isDeleteSessionConfirmOpen}
        onOpenChange={setIsDeleteSessionConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Session</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete the session "
            <Text weight="bold">
              {sessionToDelete?.sessionName ||
                sessionToDelete?.fileName ||
                'this session'}
            </Text>
            "? This action and all associated chats and transcript data will be
            removed and cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteSessionMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDeleteSession}
                disabled={deleteSessionMutation.isPending}
              >
                {deleteSessionMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete Session</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <EditStandaloneChatModal
        isOpen={isEditChatModalOpen}
        onOpenChange={setIsEditChatModalOpen}
        chat={chatToEdit}
      />
      <AlertDialog.Root
        open={isDeleteChatConfirmOpen}
        onOpenChange={setIsDeleteChatConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete the chat "
            <Text weight="bold">
              {chatToDelete?.name ||
                `Chat (${formatTimestamp(chatToDelete?.timestamp || 0)})`}
            </Text>
            "? This action cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteChatMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDeleteChat}
                disabled={deleteChatMutation.isPending}
              >
                {deleteChatMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete Chat</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
