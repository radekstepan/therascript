/* packages/ui/src/components/SessionView/Sidebar/SessionSidebar.tsx */
import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activeChatIdAtom, toastMessageAtom } from '../../../store';
import {
  deleteSessionChat as deleteChatApi, // Use specific API
  renameSessionChat as renameChatApi, // Use specific API
  startSessionChat as startNewChatApi, // Use specific API
  fetchSessionChatDetails, // Use specific API
} from '../../../api/api';
import {
  DotsHorizontalIcon,
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
  DropdownMenu,
  AlertDialog,
  ScrollArea,
  Spinner,
} from '@radix-ui/themes';
import { useSetAtom } from 'jotai';
import { formatTimestamp } from '../../../helpers';
import type { ChatSession, Session } from '../../../types';
import { cn } from '../../../utils';

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
  const { chatId: chatIdParam } = useParams<{
    sessionId: string;
    chatId?: string;
  }>();
  const navigate = useNavigate();
  const setToast = useSetAtom(toastMessageAtom);

  const activeChatIdFromAtom = useAtomValue(activeChatIdAtom);
  const currentActiveChatId = chatIdParam
    ? parseInt(chatIdParam, 10)
    : activeChatIdFromAtom;

  const queryClient = useQueryClient();

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
  const [currentRenameValue, setCurrentRenameValue] = useState('');
  // Ref for auto-focus rename input
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);
  // Ref for delete confirm button
  const deleteConfirmButtonRef = useRef<HTMLButtonElement>(null);

  const sessionId = session?.id ?? null;

  // Effect for auto-focusing rename input
  useEffect(() => {
    if (isRenameModalOpen) {
      const timer = setTimeout(() => {
        renameInputRef.current?.focus();
      }, 50); // Small delay ensures element is ready
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

  // Mutation: Start New Chat (unchanged)
  const startNewChatMutation = useMutation<ChatSession, Error>({
    mutationFn: () => {
      if (!sessionId) throw new Error('Session ID missing');
      return startNewChatApi(sessionId);
    },
    onSuccess: (newChat) => {
      setToast('New chat started.');
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionId],
        (oldData) => {
          if (!oldData) return oldData;
          const existingChats = Array.isArray(oldData.chats)
            ? oldData.chats
            : [];
          const newChatMetadata: ChatSession = {
            id: newChat.id,
            sessionId: newChat.sessionId,
            timestamp: newChat.timestamp,
            name: newChat.name,
            messages: [],
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
    onError: (error) => {
      console.error('Failed to start new chat:', error);
      setToast(`Error starting chat: ${error.message}`);
    },
  });

  // Mutation: Rename Chat (unchanged)
  const renameChatMutation = useMutation<
    ChatSession,
    Error,
    { chatId: number; newName: string | null }
  >({
    mutationFn: (variables: { chatId: number; newName: string | null }) => {
      if (!sessionId) throw new Error('Session ID missing');
      return renameChatApi(sessionId, variables.chatId, variables.newName);
    },
    onSuccess: (updatedChatMetadata) => {
      setToast('Chat renamed successfully.');
      queryClient.setQueryData<Session>(
        ['sessionMeta', sessionId],
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            chats: (oldData.chats || []).map((chat) =>
              chat.id === updatedChatMetadata.id
                ? { ...chat, name: updatedChatMetadata.name }
                : chat
            ),
          };
        }
      );
      if (sessionId !== null) {
        queryClient.setQueryData<ChatSession>(
          ['chat', sessionId, updatedChatMetadata.id],
          (oldChatData) => {
            if (!oldChatData) return oldChatData;
            return { ...oldChatData, name: updatedChatMetadata.name };
          }
        );
      }
      cancelRename();
    },
    onError: (error) => {
      console.error('Failed to rename chat:', error);
      setToast(`Error renaming chat: ${error.message}`);
    },
  });

  // Mutation: Delete Chat (unchanged)
  const deleteChatMutation = useMutation<{ message: string }, Error, number>({
    mutationFn: (chatId: number) => {
      if (!sessionId) throw new Error('Session ID missing');
      return deleteChatApi(sessionId, chatId);
    },
    onSuccess: (data, deletedChatId) => {
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
        (oldData) => {
          if (!oldData) return oldData;
          return {
            ...oldData,
            chats: oldData.chats?.filter((c) => c.id !== deletedChatId) || [],
          };
        }
      );

      queryClient.removeQueries({
        queryKey: ['chat', sessionId, deletedChatId],
      });

      if (currentActiveChatId === deletedChatId) {
        if (nextChatId !== null) {
          navigate(`/sessions/${sessionId}/chats/${nextChatId}`, {
            replace: true,
          });
        } else {
          navigate(`/sessions/${sessionId}`, { replace: true });
        }
      }
      cancelDelete();
    },
    onError: (error) => {
      console.error('Failed to delete chat:', error);
      setToast(`Error deleting chat: ${error.message}`);
    },
  });

  // Loading/Error checks (unchanged)
  if (isLoadingSession) {
    return (
      <Box
        p="4"
        className="flex flex-col h-full w-full overflow-hidden items-center justify-center"
        style={{ backgroundColor: 'var(--color-panel-solid)' }}
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
        className="flex flex-col h-full w-full overflow-hidden items-center justify-center"
        style={{ backgroundColor: 'var(--color-panel-solid)' }}
      >
        <Text size="1" color="red">
          Error: {sessionError?.message || 'Could not load session.'}
        </Text>
      </Box>
    );
  }

  // Ensure chats is an array before sorting/mapping
  const chatsDefinedAndIsArray = Array.isArray(session?.chats);
  const sortedChats = chatsDefinedAndIsArray
    ? [...session.chats].sort((a, b) => b.timestamp - a.timestamp)
    : [];

  // Helper function (unchanged)
  const getChatDisplayTitle = (chat: ChatSession | null): string => {
    if (!chat) return 'Unknown Chat';
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  // Handlers (unchanged)
  const handleNewChatClick = () => startNewChatMutation.mutate();
  const handleRenameClick = (chat: ChatSession) => {
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

  const handleDeleteClick = (chat: ChatSession) => {
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

  // Handle Enter key in rename modal
  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    }
  };

  // NavLink class helper (unchanged)
  const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = 'block w-full px-2 py-1.5 rounded-md group';
    const inactive =
      'text-[--gray-a11] hover:bg-[--gray-a3] focus:outline-none focus:ring-2 focus:ring-[--accent-7]';
    const active = 'bg-[--accent-a4] text-[--accent-11] font-medium';
    return cn(base, isActive ? active : inactive);
  };

  return (
    <>
      <Box
        p={hideHeader ? '1' : '4'}
        className="flex flex-col h-full w-full overflow-hidden"
        style={{ backgroundColor: 'var(--color-panel-solid)' }}
      >
        {/* Header (Conditional) */}
        {!hideHeader && (
          <Flex justify="between" align="center" flexShrink="0" mb="2">
            <Heading as="h3" size="2" color="gray" trim="start" weight="medium">
              Chats
            </Heading>
            <Button
              onClick={handleNewChatClick}
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
              onClick={handleNewChatClick}
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
                  <Box key={chat.id} className="relative mx-1">
                    <NavLink
                      to={`/sessions/${session.id}/chats/${chat.id}`}
                      className={getNavLinkClass}
                      title={getChatDisplayTitle(chat)}
                      end
                    >
                      <Flex
                        align="center"
                        justify="between"
                        gap="1"
                        width="100%"
                      >
                        <Text size="2" truncate className="flex-grow pr-1">
                          {getChatDisplayTitle(chat)}
                        </Text>
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger>
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              className="flex-shrink-0 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-[--accent-a4] transition-opacity"
                              aria-label="Chat options"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <DotsHorizontalIcon />
                            </IconButton>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Content
                            size="1"
                            align="end"
                            sideOffset={2}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <DropdownMenu.Item
                              onSelect={() => handleRenameClick(chat)}
                              disabled={renameChatMutation.isPending}
                            >
                              <Pencil1Icon className="mr-2 h-4 w-4" />
                              Rename
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              color="red"
                              onSelect={() => handleDeleteClick(chat)}
                              disabled={deleteChatMutation.isPending}
                            >
                              <TrashIcon className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Root>
                      </Flex>
                    </NavLink>
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
              Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave
              empty to remove the name.
            </AlertDialog.Description>
          )}
          <Flex direction="column" gap="3">
            <TextField.Root
              ref={renameInputRef} // Attach ref for focus
              size="2"
              value={currentRenameValue}
              onChange={(e) => setCurrentRenameValue(e.target.value)}
              placeholder="Enter new name (optional)"
              onKeyDown={handleRenameKeyDown} // Add keydown handler
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
                  {' '}
                  <Spinner size="2" /> <Text ml="1">Saving...</Text>{' '}
                </>
              ) : (
                <>
                  {' '}
                  <CheckIcon /> Save{' '}
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
              {getChatDisplayTitle(deletingChat)}"? This action cannot be
              undone.
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
              ref={deleteConfirmButtonRef} // Attach ref for focus
              color="red"
              onClick={confirmDelete}
              disabled={deleteChatMutation.isPending}
            >
              {deleteChatMutation.isPending ? (
                <>
                  {' '}
                  <Spinner size="2" /> <Text ml="1">Deleting...</Text>{' '}
                </>
              ) : (
                <>
                  {' '}
                  <TrashIcon /> Delete{' '}
                </>
              )}
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
