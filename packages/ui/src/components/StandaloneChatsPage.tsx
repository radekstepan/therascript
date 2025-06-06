// packages/ui/src/components/StandaloneChatsPage.tsx
import React, { useMemo, useState } from 'react';
// useNavigate and createStandaloneChatApi are no longer needed here as button is in TopToolbar
// import { useNavigate } from 'react-router-dom';
// import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery } from '@tanstack/react-query'; // Keep useQuery
import {
  Box,
  Heading,
  Flex,
  // Button, // Button removed
  Text,
  Spinner,
  Card,
  Container,
  Button,
} from '@radix-ui/themes';
// import { ChatBubbleIcon } from '@radix-ui/react-icons'; // Icon removed
import { StandaloneChatListTable } from './LandingPage/StandaloneChatListTable';
import { EditStandaloneChatModal } from './StandaloneChatView/EditStandaloneChatModal';
import {
  fetchStandaloneChats,
  // createStandaloneChat as createStandaloneChatApi, // API call removed
} from '../api/api';
import {
  standaloneChatSortCriteriaAtom,
  standaloneChatSortDirectionAtom,
  setStandaloneChatSortAtom,
  StandaloneChatSortCriteria,
  // toastMessageAtom, // Not needed if create button is gone
} from '../store';
import type { StandaloneChatListItem } from '../types';
import { formatTimestamp } from '../helpers';

export function StandaloneChatsPage() {
  // const navigate = useNavigate(); // Removed
  // const setToast = useSetAtom(toastMessageAtom); // Removed
  // const queryClient = useQueryClient(); // Removed unless other mutations are added

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

  // createChatMutation removed

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

  // handleNewChat removed

  const handleEditChatRequest = (chat: StandaloneChatListItem) => {
    setChatToEdit(chat);
    setIsEditChatModalOpen(true);
  };

  if (isLoading) {
    return (
      <Container size="3" px="4" py="6">
        <Flex justify="center" align="center" style={{ minHeight: '200px' }}>
          <Spinner size="3" /> <Text ml="2">Loading standalone chats...</Text>
        </Flex>
      </Container>
    );
  }

  if (error) {
    return (
      <Container size="3" px="4" py="6">
        <Card>
          <Text color="red">
            Error loading standalone chats: {error.message}
          </Text>
          <Button onClick={() => refetch()} mt="2">
            Retry
          </Button>
        </Card>
      </Container>
    );
  }

  return (
    <>
      <Container size="3" px="4" py="6">
        <Flex justify="between" align="center" mb="6">
          <Heading
            as="h1"
            size="7"
            className="text-slate-900 dark:text-slate-100"
          >
            Standalone Chats
          </Heading>
          {/* "New Standalone Chat" Button Removed */}
        </Flex>

        {sortedChats && sortedChats.length > 0 ? (
          <Card className="flex flex-col overflow-hidden">
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
          <Card>
            <Flex justify="center" align="center" p="6">
              <Text color="gray">
                No standalone chats yet. Click "New Chat" in the toolbar to
                start one.
              </Text>
            </Flex>
          </Card>
        )}
      </Container>

      <EditStandaloneChatModal
        isOpen={isEditChatModalOpen}
        onOpenChange={setIsEditChatModalOpen}
        chat={chatToEdit}
      />
    </>
  );
}
