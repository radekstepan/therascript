// packages/ui/src/components/StandaloneChatView/StandaloneChatHeader.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Flex,
  IconButton,
  DropdownMenu,
  AlertDialog,
  Button,
  Text,
  Spinner,
  Callout,
} from '@radix-ui/themes';
import {
  DotsHorizontalIcon,
  Pencil1Icon,
  TrashIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { EntitySelectorDropdown } from '../Shared/EntitySelectorDropdown';
import { EditStandaloneChatModal } from './EditStandaloneChatModal';
import { fetchStandaloneChats, deleteStandaloneChat } from '../../api/api';
import type { StandaloneChatListItem } from '../../types';
import { toastMessageAtom } from '../../store';
import { formatTimestamp } from '../../helpers';
import { cn } from '../../utils'; // Corrected import path

interface StandaloneChatHeaderProps {
  activeChatId: number | null;
}

export function StandaloneChatHeader({
  activeChatId,
}: StandaloneChatHeaderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);

  const {
    data: standaloneChats,
    isLoading: isLoadingChats,
    error: chatsError,
  } = useQuery<StandaloneChatListItem[], Error>({
    queryKey: ['standaloneChats'],
    queryFn: fetchStandaloneChats,
    staleTime: 60 * 1000,
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [chatToEdit, setChatToEdit] = useState<StandaloneChatListItem | null>(
    null
  );

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [chatToDelete, setChatToDelete] =
    useState<StandaloneChatListItem | null>(null);

  const activeChat = standaloneChats?.find((c) => c.id === activeChatId);

  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: deleteStandaloneChat,
    onSuccess: (data, deletedChatId) => {
      setToast(data.message || `Chat ${deletedChatId} deleted.`);
      queryClient.invalidateQueries({ queryKey: ['standaloneChats'] });
      queryClient.removeQueries({
        queryKey: ['standaloneChat', deletedChatId],
      });
      setIsDeleteConfirmOpen(false);
      setChatToDelete(null);
      // Navigate to the main chats list if the active chat was deleted
      navigate(`/chats-list`, { replace: true });
    },
    onError: (error) => setToast(`Error deleting chat: ${error.message}`),
  });

  const handleChatSelect = (chatId: number) => {
    navigate(`/chats/${chatId}`);
  };

  const handleOpenEditModal = () => {
    if (activeChat) {
      setChatToEdit(activeChat);
      setIsEditModalOpen(true);
    }
  };

  const handleOpenDeleteConfirm = () => {
    if (activeChat) {
      setChatToDelete(activeChat);
      setIsDeleteConfirmOpen(true);
    }
  };

  const isLoading = isLoadingChats || deleteChatMutation.isPending;

  return (
    <>
      <Flex
        align="center"
        gap="2"
        className={cn('px-4 md:px-6 lg:px-8', 'py-2')}
        style={{
          borderBottom: '1px solid var(--gray-a6)',
          backgroundColor: 'var(--color-panel-solid)',
          flexShrink: 0,
        }}
      >
        <EntitySelectorDropdown
          items={standaloneChats || []}
          activeItemId={activeChatId}
          onItemSelect={handleChatSelect}
          placeholderText="Select a Chat..."
          entityTypeLabel="Chat"
          disabled={isLoading}
        />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              disabled={!activeChat || isLoading}
              title="Chat Actions"
            >
              <DotsHorizontalIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              onSelect={handleOpenEditModal}
              disabled={!activeChat}
            >
              <Pencil1Icon className="mr-1" /> Edit Details
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              color="red"
              onSelect={handleOpenDeleteConfirm}
              disabled={!activeChat || deleteChatMutation.isPending}
            >
              <TrashIcon className="mr-1" /> Delete Chat
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>

      <EditStandaloneChatModal
        isOpen={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        chat={chatToEdit}
      />

      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeleteConfirmOpen(false);
            setChatToDelete(null);
            deleteChatMutation.reset();
          }
        }}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete "
            <Text weight="bold">
              {chatToDelete?.name ||
                `Chat (${formatTimestamp(chatToDelete?.timestamp || 0)})`}
            </Text>
            "? This action cannot be undone.
          </AlertDialog.Description>
          {deleteChatMutation.isError && (
            <Callout.Root color="red" size="1" my="2">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>{deleteChatMutation.error.message}</Callout.Text>
            </Callout.Root>
          )}
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
                onClick={() =>
                  chatToDelete && deleteChatMutation.mutate(chatToDelete.id)
                }
                disabled={deleteChatMutation.isPending}
              >
                {deleteChatMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
