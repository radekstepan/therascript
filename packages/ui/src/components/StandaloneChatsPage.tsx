// packages/ui/src/components/StandaloneChatsPage.tsx
import React, { useMemo, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'; // Added useMutation, useQueryClient
import {
  Box,
  Heading,
  Flex,
  Text,
  Spinner,
  Card,
  Button,
  AlertDialog, // Added AlertDialog
} from '@radix-ui/themes';
import { TrashIcon } from '@radix-ui/react-icons'; // Added TrashIcon
import { StandaloneChatListTable } from './LandingPage/StandaloneChatListTable';
import { EditStandaloneChatModal } from './StandaloneChatView/EditStandaloneChatModal';
import {
  fetchStandaloneChats,
  deleteStandaloneChat as deleteStandaloneChatApi, // Import delete API
} from '../api/api';
import {
  standaloneChatSortCriteriaAtom,
  standaloneChatSortDirectionAtom,
  setStandaloneChatSortAtom,
  StandaloneChatSortCriteria,
  toastMessageAtom, // Added toastMessageAtom
  activeChatIdAtom, // Added activeChatIdAtom
} from '../store';
import type { StandaloneChatListItem } from '../types';
import { formatTimestamp } from '../helpers';
import { cn } from '../utils';
import { useNavigate } from 'react-router-dom'; // Added useNavigate

export function StandaloneChatsPage() {
  const currentSortCriteria = useAtomValue(standaloneChatSortCriteriaAtom);
  const currentSortDirection = useAtomValue(standaloneChatSortDirectionAtom);
  const setSort = useSetAtom(setStandaloneChatSortAtom);
  const setToast = useSetAtom(toastMessageAtom); // Added setToast
  const queryClient = useQueryClient(); // Added queryClient
  const navigate = useNavigate(); // Added navigate
  const activeChatId = useAtomValue(activeChatIdAtom); // Added activeChatId

  const [isEditChatModalOpen, setIsEditChatModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );
  // --- State for Delete Chat Confirmation ---
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] =
    useState<StandaloneChatListItem | null>(null);
  // --- End State for Delete Chat Confirmation ---

  const {
    data: standaloneChats,
    isLoading,
    error,
    refetch,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
  });

  // --- Delete Chat Mutation ---
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
      setIsDeleteConfirmOpen(false);
      setChatToDelete(null);
    },
  });
  // --- End Delete Chat Mutation ---

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

  // --- Handler for Delete Chat Request ---
  const handleDeleteChatRequest = (chat: StandaloneChatListItem) => {
    setChatToDelete(chat);
    setIsDeleteConfirmOpen(true);
  };
  // --- End Handler for Delete Chat Request ---

  // --- Handler for Confirming Delete ---
  const handleConfirmDeleteChat = () => {
    if (chatToDelete) {
      deleteChatMutation.mutate(chatToDelete.id);
    }
  };
  // --- End Handler for Confirming Delete ---

  if (isLoading) {
    return (
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
        <Flex justify="center" align="center" style={{ minHeight: '200px' }}>
          <Spinner size="3" /> <Text ml="2">Loading standalone chats...</Text>
        </Flex>
      </Box>
    );
  }

  if (error) {
    return (
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
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
      <Box
        className={cn(
          'flex-grow flex flex-col',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
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
            className="flex flex-col overflow-hidden flex-grow"
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
                onDeleteChatRequest={handleDeleteChatRequest} // <-- Pass delete handler
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
      {/* --- Alert Dialog for Delete Chat Confirmation --- */}
      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
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
      {/* --- End Alert Dialog --- */}
    </>
  );
}
