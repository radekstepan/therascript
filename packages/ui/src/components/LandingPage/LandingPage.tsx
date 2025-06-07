// packages/ui/src/components/LandingPage/LandingPage.tsx
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  CounterClockwiseClockIcon,
  TrashIcon,
  ChatBubbleIcon,
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
  // Container, // Container removed
  Spinner,
  AlertDialog,
} from '@radix-ui/themes';
import { EditDetailsModal } from '../SessionView/Modals/EditDetailsModal';
import { EditStandaloneChatModal } from '../StandaloneChatView/EditStandaloneChatModal';
import {
  fetchSessions,
  deleteSession as deleteSessionApi,
  fetchStandaloneChats,
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
} from '../../store';
import type {
  Session,
  SessionMetadata,
  SearchApiResponse,
  StandaloneChatListItem,
} from '../../types';
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils'; // Import cn for applying classes

export function LandingPage() {
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const activeSearchQuery = searchParams.get('q') || '';

  const [clientFilter, setClientFilter] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [newFilterTagInput, setNewFilterTagInput] = useState('');

  const currentSessionSortCriteria = useAtomValue(sessionSortCriteriaAtom);
  const currentSessionSortDirection = useAtomValue(sessionSortDirectionAtom);
  const setSessionSort = useSetAtom(setSessionSortAtom);
  const currentStandaloneChatSortCriteria = useAtomValue(
    standaloneChatSortCriteriaAtom
  );
  const currentStandaloneChatSortDirection = useAtomValue(
    standaloneChatSortDirectionAtom
  );
  const setStandaloneChatSort = useSetAtom(setStandaloneChatSortAtom);

  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const [sessionToEdit, setSessionToEdit] = useState<Session | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null);
  const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );

  const {
    data: sessions,
    isLoading: isLoadingSessions,
    error: sessionsError,
    refetch: refetchSessions,
  } = useQuery<Session[], Error>({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  });
  const {
    data: standaloneChats,
    isLoading: isLoadingStandaloneChats,
    error: standaloneChatsError,
    refetch: refetchStandaloneChats,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
  });
  const {
    data: searchResultsData,
    isLoading: isLoadingSearch,
    error: searchError,
    isFetching: isFetchingSearch,
  } = useQuery<SearchApiResponse, Error>({
    queryKey: ['searchMessages', activeSearchQuery],
    queryFn: () => {
      if (!activeSearchQuery)
        return Promise.resolve({ query: '', results: [] });
      return searchMessages(activeSearchQuery);
    },
    enabled: !!activeSearchQuery,
    staleTime: 5 * 60 * 1000,
  });

  const filteredSearchResults = useMemo(() => {
    if (!searchResultsData?.results) return [];
    const lowerClientFilter = clientFilter.toLowerCase().trim();
    const lowerFilterTags = filterTags.map((tag) => tag.toLowerCase());
    if (!lowerClientFilter && lowerFilterTags.length === 0) {
      return searchResultsData.results;
    }
    return searchResultsData.results.filter((item) => {
      const clientMatch = lowerClientFilter
        ? item.clientName?.toLowerCase().includes(lowerClientFilter)
        : true;
      const tagsMatch =
        lowerFilterTags.length > 0
          ? lowerFilterTags.every((filterTag) =>
              item.tags?.some((itemTag) =>
                itemTag.toLowerCase().includes(filterTag)
              )
            )
          : true;
      return clientMatch && tagsMatch;
    });
  }, [searchResultsData, clientFilter, filterTags]);

  const deleteSessionMutation = useMutation<{ message: string }, Error, number>(
    {
      mutationFn: deleteSessionApi,
      onSuccess: (data, id) => {
        setToast(data.message || `Session ${id} deleted`);
        queryClient.invalidateQueries({ queryKey: ['sessions'] });
      },
      onError: (e, id) => {
        setToast(`Error deleting session ${id}: ${e.message}`);
      },
      onSettled: () => {
        setIsDeleteConfirmOpen(false);
        setSessionToDelete(null);
      },
    }
  );

  const sortedSessions = useMemo(() => {
    // ... (sorting logic remains the same)
    if (!sessions) return [];
    const criteria = currentSessionSortCriteria;
    const direction = currentSessionSortDirection;
    const getString = (value: string | null | undefined): string => value ?? '';
    return [...sessions].sort((a, b) => {
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
  }, [sessions, currentSessionSortCriteria, currentSessionSortDirection]);

  const sortedStandaloneChats = useMemo(() => {
    // ... (sorting logic remains the same)
    if (!standaloneChats) return [];
    const criteria = currentStandaloneChatSortCriteria;
    const direction = currentStandaloneChatSortDirection;
    const getString = (value: string | null | undefined): string => value ?? '';
    const getTagsString = (tags: string[] | null | undefined): string =>
      (tags ?? []).join(', ');
    return [...standaloneChats].sort((a, b) => {
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
            compareResult = getTagsString(a.tags).localeCompare(
              getTagsString(b.tags),
              undefined,
              { sensitivity: 'base', usage: 'sort' }
            );
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
    standaloneChats,
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
  const handleEditSaveSuccess = (updatedMetadata: Partial<SessionMetadata>) => {
    setIsEditingModalOpen(false);
    setSessionToEdit(null);
    setToast('Session details updated successfully.');
  };
  const handleDeleteSessionRequest = (session: Session) => {
    setSessionToDelete(session);
    setIsDeleteConfirmOpen(true);
  };
  const handleConfirmDeleteSession = () => {
    if (!sessionToDelete || deleteSessionMutation.isPending) return;
    deleteSessionMutation.mutate(sessionToDelete.id);
  };
  const handleEditChatRequest = (chat: StandaloneChatListItem) => {
    setChatToEdit(chat);
    setIsEditChatModalOpen(true);
  };

  const handleAddFilterTag = useCallback(() => {
    // ... (tag logic remains the same)
    const tagToAdd = newFilterTagInput.trim();
    if (
      tagToAdd &&
      !filterTags.some((tag) => tag.toLowerCase() === tagToAdd.toLowerCase())
    ) {
      if (filterTags.length < 5) {
        setFilterTags((prev) => [...prev, tagToAdd]);
      } else {
        setToast('Maximum of 5 filter tags allowed.');
      }
    }
    setNewFilterTagInput('');
  }, [newFilterTagInput, filterTags, setToast]);

  const handleRemoveFilterTag = useCallback((tagToRemove: string) => {
    // ... (tag logic remains the same)
    setFilterTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  }, []);

  const handleFilterTagInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // ... (tag logic remains the same)
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        handleAddFilterTag();
      }
    },
    [handleAddFilterTag]
  );

  const isLoadingAnyData =
    isLoadingSessions ||
    isLoadingStandaloneChats ||
    (!!activeSearchQuery && (isLoadingSearch || isFetchingSearch));
  const anyError =
    sessionsError ||
    standaloneChatsError ||
    (!!activeSearchQuery && searchError);

  if (isLoadingAnyData && !anyError && !activeSearchQuery) {
    return (
      <Flex
        justify="center"
        align="center"
        // Use consistent padding with TopToolbar, apply to main content area
        className={cn('px-4 md:px-6 lg:px-8', 'py-6 md:py-8 lg:py-10')}
        style={{ height: 'calc(100vh - 64px)' }} // Adjust height if TopToolbar is fixed
      >
        <Spinner size="3" />
        <Text ml="2">Loading data...</Text>
      </Flex>
    );
  }
  if (anyError && !activeSearchQuery) {
    return (
      <Flex
        direction="column"
        justify="center"
        align="center"
        // Use consistent padding with TopToolbar
        className={cn('px-4 md:px-6 lg:px-8', 'py-6 md:py-8 lg:py-10')}
        style={{ height: 'calc(100vh - 64px)' }} // Adjust height
      >
        <Text color="red" mb="4">
          {anyError?.message || 'Failed to load data.'}
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
  const hasFilteredResults = filteredSearchResults.length > 0;
  const hasInitialSearchResults =
    searchResultsData?.results && searchResultsData.results.length > 0;

  return (
    <>
      {/* Main Box with consistent padding, replacing Container */}
      <Box
        className={cn(
          'flex-grow flex flex-col overflow-y-auto',
          'py-4 md:py-6 lg:py-8', // Vertical padding
          'px-4 md:px-6 lg:px-8' // Horizontal padding matching TopToolbar
        )}
      >
        {showSearchResultsView ? (
          <>
            <Box mb="4">
              <FilterControls
                sessions={sessions}
                clientFilter={clientFilter}
                setClientFilter={setClientFilter}
                filterTags={filterTags}
                setFilterTags={setFilterTags}
                newFilterTagInput={newFilterTagInput}
                setNewFilterTagInput={setNewFilterTagInput}
                onAddFilterTag={handleAddFilterTag}
                onRemoveFilterTag={handleRemoveFilterTag}
                onFilterTagInputKeyDown={handleFilterTagInputKeyDown}
              />
            </Box>
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
            {!isLoadingSearch &&
              !isFetchingSearch &&
              !searchError &&
              hasFilteredResults && (
                <SearchResultList
                  results={filteredSearchResults}
                  query={activeSearchQuery}
                />
              )}
            {!searchError &&
              !isLoadingSearch &&
              !isFetchingSearch &&
              !hasFilteredResults && (
                <Card size="2" mb="4" style={{ width: '100%' }}>
                  <Text color="gray">
                    {hasInitialSearchResults &&
                    (clientFilter || filterTags.length > 0)
                      ? `No results match the current filters for "${activeSearchQuery}".`
                      : `No results found for "${activeSearchQuery}". Try a different search term.`}
                  </Text>
                </Card>
              )}
          </>
        ) : (
          <>
            <Card
              size="3"
              className="flex flex-col overflow-hidden mb-6"
              style={{ width: '100%' }}
            >
              <Flex
                justify="between"
                align="center"
                px="4"
                pt="4"
                pb="3"
                style={{ borderBottom: '1px solid var(--gray-a6)' }}
              >
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

            <Card
              size="3"
              className="flex-grow flex flex-col overflow-hidden h-full"
              style={{ width: '100%' }}
            >
              <Flex
                justify="between"
                align="center"
                px="4"
                pt="4"
                pb="3"
                style={{ borderBottom: '1px solid var(--gray-a6)' }}
              >
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
              </Flex>
              <Box className="flex-grow flex flex-col overflow-hidden">
                {sortedSessions.length === 0 ? (
                  <Flex flexGrow="1" align="center" justify="center" p="6">
                    <Text color="gray">
                      No sessions found. Click "New Session" in the toolbar.
                    </Text>
                  </Flex>
                ) : (
                  <SessionListTable
                    sessions={sortedSessions}
                    sortCriteria={currentSessionSortCriteria}
                    sortDirection={currentSessionSortDirection}
                    onSort={handleSessionSort}
                    onEditSession={handleEditSession}
                    onDeleteSessionRequest={handleDeleteSessionRequest}
                  />
                )}
              </Box>
            </Card>
          </>
        )}
      </Box>{' '}
      {/* End of main Box with padding */}
      <EditDetailsModal
        isOpen={isEditingModalOpen}
        onOpenChange={(open: boolean) => {
          setIsEditingModalOpen(open);
          if (!open) setSessionToEdit(null);
        }}
        session={sessionToEdit}
        onSaveSuccess={handleEditSaveSuccess}
      />
      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
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
    </>
  );
}
