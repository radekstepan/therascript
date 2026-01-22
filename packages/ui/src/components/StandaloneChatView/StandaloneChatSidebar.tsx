/* packages/ui/src/components/StandaloneChatView/StandaloneChatSidebar.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
  ScrollArea,
  Spinner,
  AlertDialog, // Added AlertDialog import
} from '@radix-ui/themes';
import { PlusCircledIcon, TrashIcon } from '@radix-ui/react-icons'; // Added TrashIcon
import { StandaloneChatSidebarList } from './StandaloneChatSidebarList';
import { EditStandaloneChatModal } from './EditStandaloneChatModal';
import {
  fetchStandaloneChats,
  createStandaloneChat as createStandaloneChatApi,
  deleteStandaloneChat as deleteStandaloneChatApi, // Added delete API
} from '../../api/api';
import { activeChatIdAtom, toastMessageAtom } from '../../store';
import type { ChatSession, StandaloneChatListItem } from '../../types';
import { cn } from '../../utils'; // cn might be needed if styling added back

interface StandaloneChatSidebarProps {
  isLoading?: boolean;
  error?: Error | null;
}

export function StandaloneChatSidebar({
  isLoading: isLoadingParent,
  error: parentError,
}: StandaloneChatSidebarProps) {
  const navigate = useNavigate();
  const setToast = useSetAtom(toastMessageAtom);
  const activeChatId = useAtomValue(activeChatIdAtom);
  const queryClient = useQueryClient();

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );
  // Delete Modal State
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] =
    useState<StandaloneChatListItem | null>(null);
  const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus on delete confirm modal open
  useEffect(() => {
    if (isDeleteConfirmOpen) {
      const timer = setTimeout(() => {
        deleteConfirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isDeleteConfirmOpen]);

  // Queries
  const {
    data: standaloneChats,
    isLoading: isLoadingChatsQuery,
    error: chatsError,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
    staleTime: 5 * 60 * 1000,
  });

  // Mutations
  const createStandaloneChatMutation = useMutation<
    StandaloneChatListItem,
    Error
  >({
    mutationFn: createStandaloneChatApi,
    onSuccess: (d) => {
      setToast('New chat created.');
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      navigate(`/chats/${d.id}`);
    },
    onError: (e) => {
      setToast(`Error creating chat: ${e.message}`);
    },
  });

  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: deleteStandaloneChatApi,
    onSuccess: (data, delId) => {
      setToast(data.message || `Chat ${delId} deleted.`);
      let nextId: number | null = null;
      const before = queryClient.getQueryData<StandaloneChatListItem[]>([
        'standaloneChats',
      ]);
      const remaining = before?.filter((c) => c.id !== delId) || [];
      queryClient.setQueryData<StandaloneChatListItem[]>(
        ['standaloneChats'],
        remaining
      );
      if (activeChatId === delId) {
        if (remaining.length > 0) {
          nextId = [...remaining].sort((a, b) => b.timestamp - a.timestamp)[0]
            .id;
          navigate(`/chats/${nextId}`, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      }
      queryClient.removeQueries({ queryKey: ['standaloneChat', delId] });
    },
    onError: (e, id) => {
      setToast(`Error deleting chat ${id}: ${e.message}`);
    },
    onSettled: () => {
      setIsDeleteConfirmOpen(false);
      setChatToDelete(null);
    },
  });

  // Handlers
  const handleNewChatClick = () => {
    createStandaloneChatMutation.mutate();
  };
  const handleEditDetailsRequest = (chat: StandaloneChatListItem) => {
    setChatToEdit(chat);
    setIsEditModalOpen(true);
  };
  const handleDeleteRequest = (chat: StandaloneChatListItem) => {
    setChatToDelete(chat);
    setIsDeleteConfirmOpen(true);
  };
  const handleConfirmDelete = () => {
    if (!chatToDelete || deleteChatMutation.isPending) return;
    deleteChatMutation.mutate(chatToDelete.id);
  };
  const handleCancelDelete = () => {
    setIsDeleteConfirmOpen(false);
    setChatToDelete(null);
    deleteChatMutation.reset();
  };

  // Derived State
  const isLoading = isLoadingParent || isLoadingChatsQuery;
  const error = parentError || chatsError;
  const chatsToShow = standaloneChats || [];

  return (
    <>
      <Box
        p="4"
        className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-gray-800" // MODIFIED: slate to gray
      >
        {/* Header Section */}
        <Flex justify="between" align="center" flexShrink="0" mb="2">
          <Heading as="h3" size="2" color="gray" trim="start" weight="medium">
            Chats
          </Heading>
          <Button
            onClick={handleNewChatClick}
            variant="soft"
            size="1"
            highContrast
            title="Start New Standalone Chat"
            disabled={createStandaloneChatMutation.isPending}
            className="transition-all duration-150"
            style={{
              backgroundColor: 'var(--gray-a6)',
            }}
          >
            {createStandaloneChatMutation.isPending ? (
              <Spinner size="1" />
            ) : (
              <PlusCircledIcon width="16" height="16" />
            )}
          </Button>
        </Flex>

        {/* List Area */}
        {isLoading ? (
          <Flex flexGrow="1" align="center" justify="center">
            <Spinner size="2" />
            <Text color="gray" size="1" ml="2">
              Loading chats...
            </Text>
          </Flex>
        ) : error ? (
          <Flex flexGrow="1" align="center" justify="center" p="4">
            <Text color="red" size="1">
              Error loading chats: {error.message}
            </Text>
          </Flex>
        ) : chatsToShow.length === 0 ? (
          <Flex flexGrow="1" align="center" justify="center">
            <Text color="gray" size="1" style={{ fontStyle: 'italic' }}>
              No chats yet.
            </Text>
          </Flex>
        ) : (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ flexGrow: 1, marginLeft: '-4px', marginRight: '-4px' }}
          >
            <StandaloneChatSidebarList
              chats={chatsToShow}
              onEditChatRequest={handleEditDetailsRequest}
              onDeleteChatRequest={handleDeleteRequest} // Pass delete handler
              activeChatId={activeChatId}
            />
          </ScrollArea>
        )}
      </Box>

      {/* Edit Details Modal */}
      <EditStandaloneChatModal
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        chat={chatToEdit}
      />

      {/* Delete Confirmation Modal */}
      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => !open && handleCancelDelete()}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete this chat? This action
            cannot be undone.
          </AlertDialog.Description>
          {deleteChatMutation.isError && (
            <Text color="red" size="1" my="2">
              Error: {deleteChatMutation.error.message}
            </Text>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                onClick={handleCancelDelete}
                disabled={deleteChatMutation.isPending}
                className="transition-all duration-150"
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                ref={deleteConfirmButtonRef}
                color="red"
                onClick={handleConfirmDelete}
                disabled={deleteChatMutation.isPending}
                className="transition-all duration-150"
              >
                <>
                  {deleteChatMutation.isPending ? (
                    <Spinner size="1" />
                  ) : (
                    <TrashIcon />
                  )}{' '}
                  <Text ml="1">Delete Chat</Text>{' '}
                </>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
