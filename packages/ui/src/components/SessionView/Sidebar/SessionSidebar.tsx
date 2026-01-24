/* packages/ui/src/components/SessionView/Sidebar/SessionSidebar.tsx */
import React, { useState, useRef, useEffect } from 'react';
// --- Add Missing Imports ---
import { useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activeChatIdAtom, toastMessageAtom } from '../../../store'; // Correct store import path
import {
  deleteSessionChat as deleteChatApi,
  renameSessionChat as renameChatApi,
  startSessionChat as startNewChatApi,
  fetchSessionChatDetails,
} from '../../../api/api';
import { formatTimestamp } from '../../../helpers'; // Correct helpers import path
import type { ChatSession, Session } from '../../../types'; // Correct types import path
// --- End Missing Imports ---

import {
  Pencil1Icon,
  TrashIcon,
  PlusCircledIcon,
  Cross2Icon,
  CheckIcon,
} from '@radix-ui/react-icons';
import {
  Box,
  Flex,
  Text,
  Heading,
  Button,
  IconButton,
  TextField,
  AlertDialog,
  ScrollArea,
  Spinner,
} from '@radix-ui/themes';
import { cn } from '../../../utils';
import { ChatSidebarListItem } from '../../Shared/ChatSidebarListItem';

// Define the type for the chat metadata used in the list
type ChatSessionMetadata = Pick<
  ChatSession,
  'id' | 'sessionId' | 'timestamp' | 'name'
>;

interface SessionSidebarProps {
  session: Session | null;
  isLoading: boolean;
  error: Error | null;
  hideHeader?: boolean;
}

export function SessionSidebar({
  session,
  isLoading: isLoadingSession,
  error: sessionError,
  hideHeader = false,
}: SessionSidebarProps) {
  // --- Use imported hooks ---
  const { chatId: chatIdParam } = useParams<{
    sessionId: string;
    chatId?: string;
  }>();
  const navigate = useNavigate();
  const setToast = useSetAtom(toastMessageAtom);
  const activeChatIdFromAtom = useAtomValue(activeChatIdAtom);
  const queryClient = useQueryClient();
  // --- End Use imported hooks ---

  const currentActiveChatId = chatIdParam
    ? parseInt(chatIdParam, 10)
    : activeChatIdFromAtom;

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<ChatSessionMetadata | null>(
    null
  );
  const [currentRenameValue, setCurrentRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingChat, setDeletingChat] = useState<ChatSessionMetadata | null>(
    null
  );
  const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

  const sessionId = session?.id ?? null;

  // Effect for auto-focusing rename input
  useEffect(() => {
    if (isRenameModalOpen) {
      const timer = setTimeout(() => {
        renameInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isRenameModalOpen]);

  // Effect for auto-focusing delete confirm button
  useEffect(() => {
    if (isDeleteConfirmOpen) {
      const timer = setTimeout(() => {
        deleteConfirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isDeleteConfirmOpen]);

  // Mutation: Start New Chat
  const startNewChatMutation = useMutation<ChatSession, Error>({
    mutationFn: () => {
      if (!sessionId) throw new Error('Session ID missing');
      return startNewChatApi(sessionId);
    },
    onSuccess: (newChat: ChatSession) => {
      // Add type annotation
      setToast('New chat started.');
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionId],
        (oldData: Session | undefined) => {
          // Add type annotation
          if (!oldData) return oldData;
          const existingChats = Array.isArray(oldData.chats)
            ? oldData.chats
            : [];
          const newChatMetadata: ChatSessionMetadata = {
            id: newChat.id,
            sessionId: newChat.sessionId,
            timestamp: newChat.timestamp,
            name: newChat.name,
          };
          return { ...oldData, chats: [...existingChats, newChatMetadata] };
        }
      );
      if (sessionId !== null) {
        queryClient.prefetchQuery({
          queryKey: ['chat', sessionId, newChat.id],
          queryFn: () => fetchSessionChatDetails(sessionId!, newChat.id),
        });
        navigate(`/sessions/${sessionId}/chats/${newChat.id}`);
      } else {
        console.error('Cannot prefetch or navigate: sessionId is null');
      }
    },
    onError: (error: Error) => {
      // Add type annotation
      console.error('Failed to start new chat:', error);
      setToast(`Error starting chat: ${error.message}`);
    },
  });

  // Mutation: Rename Chat
  const renameChatMutation = useMutation<
    ChatSession,
    Error,
    { chatId: number; newName: string | null }
  >({
    mutationFn: (variables: { chatId: number; newName: string | null }) => {
      if (!sessionId) throw new Error('Session ID missing');
      return renameChatApi(sessionId, variables.chatId, variables.newName);
    },
    onSuccess: (updatedChatMetadata: ChatSession) => {
      // Add type annotation
      setToast('Chat renamed successfully.');
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionId],
        (oldData: Session | undefined) => {
          // Add type annotation
          if (!oldData) return oldData;
          return {
            ...oldData,
            chats: (oldData.chats || []).map(
              (
                chat // Add null check for chat
              ) =>
                chat.id === updatedChatMetadata.id
                  ? { ...chat, name: updatedChatMetadata.name }
                  : chat
            ),
          };
        }
      );
      if (sessionId !== null) {
        queryClient.invalidateQueries({
          queryKey: ['chat', sessionId, updatedChatMetadata.id],
        });
      }
      cancelRename();
    },
    onError: (error: Error) => {
      // Add type annotation
      console.error('Failed to rename chat:', error);
      setToast(`Error renaming chat: ${error.message}`);
    },
  });

  // Mutation: Delete Chat
  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: (chatId: number) => {
      if (!sessionId) throw new Error('Session ID missing');
      return deleteChatApi(sessionId, chatId);
    },
    onSuccess: (data: { message: string }, deletedChatId: number) => {
      // Add type annotations
      setToast(`Chat deleted successfully.`);
      let nextChatId: number | null = null;
      const sessionDataBeforeDelete = queryClient.getQueryData<Session>([
        'sessionMeta',
        sessionId,
      ]);
      const remainingChats =
        sessionDataBeforeDelete?.chats?.filter((c) => c.id !== deletedChatId) ||
        [];

      if (currentActiveChatId === deletedChatId) {
        if (remainingChats.length > 0) {
          const newestChat = [...remainingChats].sort(
            (a, b) => b.timestamp - a.timestamp
          )[0];
          nextChatId = newestChat.id;
        }
      }

      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionId],
        (oldData: Session | undefined) => {
          // Add type annotation
          if (!oldData) return oldData;
          return {
            ...oldData,
            chats: oldData.chats?.filter((c) => c.id !== deletedChatId) || [], // Add null check for chat
          };
        }
      );

      queryClient.removeQueries({
        queryKey: ['chat', sessionId, deletedChatId],
      });

      if (currentActiveChatId === deletedChatId) {
        if (nextChatId !== null && sessionId !== null) {
          // Add null check for sessionId
          navigate(`/sessions/${sessionId}/chats/${nextChatId}`, {
            replace: true,
          });
        } else if (sessionId !== null) {
          // Add null check for sessionId
          navigate(`/sessions/${sessionId}`, { replace: true });
        } else {
          navigate(`/`, { replace: true }); // Fallback if session ID is somehow null
        }
      }
      cancelDelete();
    },
    onError: (error: Error) => {
      // Add type annotation
      console.error('Failed to delete chat:', error);
      setToast(`Error deleting chat: ${error.message}`);
    },
  });

  // Loading/Error checks
  if (isLoadingSession) {
    return (
      <Box
        p="4"
        className="flex flex-col h-full w-full overflow-hidden items-center justify-center bg-white dark:bg-[var(--color-panel)]"
      >
        <Spinner size="2" />{' '}
        <Text size="1" color="gray" mt="2">
          Loading session...
        </Text>
      </Box>
    );
  }
  if (sessionError || !session) {
    return (
      <Box
        p="4"
        className="flex flex-col h-full w-full overflow-hidden items-center justify-center bg-white dark:bg-[var(--color-panel)]"
      >
        <Text size="1" color="red">
          Error: {sessionError?.message || 'Could not load session.'}
        </Text>
      </Box>
    );
  }

  const chatsDefinedAndIsArray = Array.isArray(session?.chats);
  const sortedChats: ChatSessionMetadata[] = chatsDefinedAndIsArray
    ? [...session.chats]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((c) => ({
          id: c.id,
          sessionId: c.sessionId,
          timestamp: c.timestamp,
          name: c.name,
        }))
    : [];

  // --- Define handlers before use ---
  const handleNewChatClick = () => startNewChatMutation.mutate();

  // Update handlers to accept ChatSessionMetadata
  const handleRenameClick = (chat: ChatSessionMetadata) => {
    setRenamingChat(chat);
    setCurrentRenameValue(chat.name || '');
    setIsRenameModalOpen(true);
  };
  const handleSaveRename = () => {
    if (!renamingChat || renameChatMutation.isPending) return;
    renameChatMutation.mutate({
      chatId: renamingChat.id,
      newName: currentRenameValue.trim() || null,
    });
  };
  const cancelRename = () => {
    setIsRenameModalOpen(false);
    setRenamingChat(null);
    setCurrentRenameValue('');
    renameChatMutation.reset();
  };

  const handleDeleteClick = (chat: ChatSessionMetadata) => {
    setDeletingChat(chat);
    setIsDeleteConfirmOpen(true);
  };
  const confirmDelete = () => {
    if (!deletingChat || deleteChatMutation.isPending) return;
    deleteChatMutation.mutate(deletingChat.id);
  };
  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
    setDeletingChat(null);
    deleteChatMutation.reset();
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    }
  };

  // Navigation handler
  const handleChatSelect = (chatId: number) => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}/chats/${chatId}`);
    }
  };
  // --- End Handlers ---

  return (
    <>
      <Box
        p={hideHeader ? '1' : '4'}
        className="flex flex-col h-full w-full overflow-hidden bg-white dark:bg-[var(--color-panel)]"
      >
        {/* Header (Conditional) */}
        {!hideHeader && (
          <Flex justify="between" align="center" flexShrink="0" mb="2">
            <Heading as="h3" size="2" color="gray" trim="start" weight="medium">
              Chats
            </Heading>
            <Button
              onClick={handleNewChatClick} // Use defined handler
              variant="soft"
              size="1"
              highContrast
              title="Start New Chat"
              disabled={startNewChatMutation.isPending}
            >
              {startNewChatMutation.isPending ? (
                <Spinner size="1" />
              ) : (
                <PlusCircledIcon width="16" height="16" />
              )}
            </Button>
          </Flex>
        )}

        {/* Header (Conditional - Minimal) */}
        {hideHeader && (
          <Flex justify="end" align="center" flexShrink="0" mb="2">
            <Button
              onClick={handleNewChatClick} // Use defined handler
              variant="soft"
              size="1"
              highContrast
              title="Start New Chat"
              disabled={startNewChatMutation.isPending}
            >
              {startNewChatMutation.isPending ? (
                <Spinner size="1" />
              ) : (
                <PlusCircledIcon width="16" height="16" />
              )}
            </Button>
          </Flex>
        )}

        {/* Chat List */}
        {isLoadingSession ? (
          <Flex flexGrow="1" align="center" justify="center">
            <Spinner size="2" />
            <Text color="gray" size="2" style={{ fontStyle: 'italic' }} ml="2">
              Loading chats...
            </Text>
          </Flex>
        ) : sortedChats.length === 0 ? (
          <Flex flexGrow="1" align="center" justify="center">
            <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>
              No chats yet.
            </Text>
          </Flex>
        ) : (
          <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
            <Flex direction="column" gap="1" asChild className="mt-1 mb-1">
              <nav>
                {sortedChats.map((chat) => (
                  <Box key={chat.id} className="mx-1">
                    <ChatSidebarListItem<ChatSessionMetadata>
                      item={chat}
                      isActive={currentActiveChatId === chat.id}
                      onSelect={handleChatSelect}
                      onEditRequest={handleRenameClick}
                      onDeleteRequest={handleDeleteClick}
                      editLabel="Rename"
                    />
                  </Box>
                ))}
              </nav>
            </Flex>
          </ScrollArea>
        )}
      </Box>

      {/* Rename Modal */}
      <AlertDialog.Root
        open={isRenameModalOpen}
        onOpenChange={(open) => !open && cancelRename()}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Rename Chat</AlertDialog.Title>
          {renamingChat && (
            <AlertDialog.Description size="2" color="gray" mt="1" mb="4">
              Enter a new name for "
              {renamingChat.name ||
                `Chat (${formatTimestamp(renamingChat.timestamp)})`}{' '}
              {/* Use defined helper */}
              ". Leave empty to remove the name.
            </AlertDialog.Description>
          )}
          <Flex direction="column" gap="3">
            <TextField.Root
              ref={renameInputRef}
              size="2"
              value={currentRenameValue}
              onChange={(e) => setCurrentRenameValue(e.target.value)}
              placeholder="Enter new name (optional)"
              onKeyDown={handleRenameKeyDown}
              disabled={renameChatMutation.isPending}
            />
            {renameChatMutation.isError && (
              <Text color="red" size="1">
                Error: {renameChatMutation.error.message}
              </Text>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={cancelRename}
              disabled={renameChatMutation.isPending}
            >
              <Cross2Icon /> Cancel
            </Button>
            <Button
              onClick={handleSaveRename}
              disabled={renameChatMutation.isPending}
            >
              {renameChatMutation.isPending ? (
                <>
                  <Spinner size="2" /> <Text ml="1">Saving...</Text>
                </>
              ) : (
                <>
                  <CheckIcon /> Save
                </>
              )}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      {/* Delete Modal */}
      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => !open && cancelDelete()}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          {deletingChat && (
            <AlertDialog.Description size="2" color="gray" mt="1" mb="4">
              Are you sure you want to delete "
              {deletingChat.name ||
                `Chat (${formatTimestamp(deletingChat.timestamp)})`}{' '}
              {/* Use defined helper */}
              "? This action cannot be undone.
            </AlertDialog.Description>
          )}
          {deleteChatMutation.isError && (
            <Text color="red" size="1" mb="3">
              Error: {deleteChatMutation.error.message}
            </Text>
          )}
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={cancelDelete}
              disabled={deleteChatMutation.isPending}
            >
              <Cross2Icon /> Cancel
            </Button>
            <Button
              ref={deleteConfirmButtonRef}
              color="red"
              onClick={confirmDelete}
              disabled={deleteChatMutation.isPending}
            >
              {deleteChatMutation.isPending ? (
                <>
                  <Spinner size="2" /> <Text ml="1">Deleting...</Text>
                </>
              ) : (
                <>
                  <TrashIcon /> Delete
                </>
              )}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
