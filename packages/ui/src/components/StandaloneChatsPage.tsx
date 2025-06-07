// packages/ui/src/components/StandaloneChatsPage.tsx
import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  Heading,
  Flex,
  Text,
  Spinner,
  Card,
  Button,
} from '@radix-ui/themes';
import { StandaloneChatListTable } from './LandingPage/StandaloneChatListTable';
import { EditStandaloneChatModal } from './StandaloneChatView/EditStandaloneChatModal';
import { fetchStandaloneChats } from '../api/api';
import {
  standaloneChatSortCriteriaAtom,
  standaloneChatSortDirectionAtom,
  setStandaloneChatSortAtom,
  StandaloneChatSortCriteria,
} from '../store';
import type { StandaloneChatListItem } from '../types';
import { formatTimestamp } from '../helpers';
import { cn } from '../utils'; // Corrected import path

export function StandaloneChatsPage() {
  const currentSortCriteria = useAtomValue(standaloneChatSortCriteriaAtom);
  const currentSortDirection = useAtomValue(standaloneChatSortDirectionAtom);
  const setSort = useSetAtom(setStandaloneChatSortAtom);

  const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );

  const {
    data: standaloneChats,
    isLoading,
    error,
    refetch,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
  });

  const sortedChats = useMemo(() => {
    if (!standaloneChats) return [];
    const criteria = currentSortCriteria;
    const direction = currentSortDirection;
    const chatsToSort = standaloneChats;
    const getString = (value: string | null | undefined): string => value ?? '';
    const getTagsString = (tags: string[] | null | undefined): string =>
      (tags ?? []).join(', ');

    return [...chatsToSort].sort((a, b) => {
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
  }, [standaloneChats, currentSortCriteria, currentSortDirection]);

  const handleEditChatRequest = (chat: StandaloneChatListItem) => {
    setChatToEdit(chat);
    setIsEditChatModalOpen(true);
  };

  if (isLoading) {
    return (
      <Box className={cn('px-4 md:px-6 lg:px-8', 'py-6')}>
        <Flex justify="center" align="center" style={{ minHeight: '200px' }}>
          <Spinner size="3" /> <Text ml="2">Loading standalone chats...</Text>
        </Flex>
      </Box>
    );
  }

  if (error) {
    return (
      <Box className={cn('px-4 md:px-6 lg:px-8', 'py-6')}>
        <Card style={{ width: '100%' }}>
          <Text color="red">
            Error loading standalone chats: {error.message}
          </Text>
          <Button onClick={() => refetch()} mt="2">
            Retry
          </Button>
        </Card>
      </Box>
    );
  }

  return (
    <>
      <Box className={cn('px-4 md:px-6 lg:px-8', 'py-6')}>
        <Flex justify="between" align="center" mb="6">
          <Heading
            as="h1"
            size="7"
            className="text-gray-900 dark:text-gray-100"
          >
            Standalone Chats
          </Heading>
        </Flex>

        {sortedChats && sortedChats.length > 0 ? (
          <Card
            className="flex flex-col overflow-hidden"
            style={{ width: '100%' }}
          >
            <Box
              className="flex-grow flex flex-col overflow-hidden"
              style={{ minHeight: '300px' }}
            >
              <StandaloneChatListTable
                chats={sortedChats}
                sortCriteria={currentSortCriteria}
                sortDirection={currentSortDirection}
                onSort={(criteria) => setSort(criteria)}
                onEditChatRequest={handleEditChatRequest}
              />
            </Box>
          </Card>
        ) : (
          <Card style={{ width: '100%' }}>
            <Flex justify="center" align="center" p="6">
              <Text color="gray">
                No standalone chats yet. Click "New Chat" in the toolbar to
                start one.
              </Text>
            </Flex>
          </Card>
        )}
      </Box>

      <EditStandaloneChatModal
        isOpen={isEditChatModalOpen}
        onOpenChange={setIsEditChatModalOpen}
        chat={chatToEdit}
      />
    </>
  );
}
