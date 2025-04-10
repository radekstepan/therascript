// src/components/SessionView/SessionSidebar.tsx
import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  activeSessionAtom,
  renameChatAtom,
  deleteChatAtom,
  activeChatIdAtom,
  startNewChatAtom,
  chatErrorAtom,
} from '../../store';
import { deleteChat } from '../../api/api'; // Import API function
import { DotsHorizontalIcon, Pencil1Icon, TrashIcon, PlusCircledIcon } from '@radix-ui/react-icons';
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
  Separator,
} from '@radix-ui/themes';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

export function SessionSidebar() {
  const { sessionId: sessionIdParam } = useParams<{ sessionId: string; chatId?: string }>();
  const navigate = useNavigate();
  const session = useAtomValue(activeSessionAtom);
  const renameChatAction = useSetAtom(renameChatAtom);
  const deleteChatAction = useSetAtom(deleteChatAtom);
  const startNewChatAction = useSetAtom(startNewChatAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const currentActiveChatIdAtomValue = useAtomValue(activeChatIdAtom);

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
  const [currentRenameValue, setCurrentRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);

  if (!session || !sessionIdParam) return null;
  const sessionId = parseInt(sessionIdParam, 10);
  if (isNaN(sessionId)) {
    console.error("Invalid session ID in URL parameter:", sessionIdParam);
    return null;
  }

  const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);
  const getChatDisplayTitle = (chat: ChatSession | null): string => {
    if (!chat) return 'Unknown Chat';
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  const handleNewChatClick = async () => {
    const result = await startNewChatAction({ sessionId });
    if (result.success) {
      navigate(`/sessions/${sessionId}/chats/${result.newChatId}`);
    } else {
      setChatError(result.error);
    }
  };

  const handleRenameClick = (chat: ChatSession) => {
    setRenamingChat(chat);
    setCurrentRenameValue(chat.name || '');
    setRenameError(null);
    setIsRenameModalOpen(true);
  };
  const handleSaveRename = () => {
    if (!renamingChat) return;
    renameChatAction({ chatId: renamingChat.id, newName: currentRenameValue.trim() });
    cancelRename();
  };
  const cancelRename = () => {
    setIsRenameModalOpen(false);
    setRenamingChat(null);
    setCurrentRenameValue('');
    setRenameError(null);
  };
  const handleDeleteClick = (chat: ChatSession) => {
    setDeletingChat(chat);
    setIsDeleteConfirmOpen(true);
  };
  const confirmDelete = async () => {
    if (!deletingChat) return;
    try {
      await deleteChat(sessionId, deletingChat.id); // Call API first
      const result = deleteChatAction({ chatId: deletingChat.id }); // Then update state
      if (result.success) {
        if (currentActiveChatIdAtomValue === deletingChat.id) {
          if (result.newActiveChatId !== null) {
            navigate(`/sessions/${sessionId}/chats/${result.newActiveChatId}`, { replace: true });
          } else {
            navigate(`/sessions/${sessionId}`, { replace: true });
          }
        }
      } else {
        console.error("Failed to delete chat locally:", result.error);
        setChatError(result.error);
      }
    } catch (err) {
      console.error("Failed to delete chat on backend:", err);
      setChatError("Failed to delete chat.");
    }
    cancelDelete();
  };
  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
    setDeletingChat(null);
  };

  const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = "group/link flex flex-grow items-center w-full text-left rounded-md text-sm transition-colors duration-150 overflow-hidden";
    const active = "text-[--accent-a11] font-medium";
    const inactive = "text-[--gray-a11] hover:text-[--gray-a12]";
    return cn(base, isActive ? active : inactive);
  };

  return (
    <>
      <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
        <Flex justify="between" align="center" flexShrink="0" mb="2">
          <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
          <Button onClick={handleNewChatClick} variant="soft" size="1" highContrast title="Start New Chat">
            <PlusCircledIcon width="16" height="16" />
          </Button>
        </Flex>
        {sortedChats.length === 0 ? (
          <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
        ) : (
          <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
            <Flex direction="column" gap="1" asChild>
              <nav>
                {sortedChats.map((chat) => (
                  <Flex
                    key={chat.id}
                    align="center"
                    justify="between"
                    className="group relative px-2 py-1.5 rounded-md hover:bg-[--gray-a3]"
                    style={currentActiveChatIdAtomValue === chat.id ? { backgroundColor: 'var(--accent-a4)' } : {}}
                  >
                    <NavLink to={`/sessions/${sessionId}/chats/${chat.id}`} className={getNavLinkClass} title={getChatDisplayTitle(chat)} end>
                      <Text size="2" truncate className="flex-grow">{getChatDisplayTitle(chat)}</Text>
                    </NavLink>
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          className="flex-shrink-0 ml-1 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          aria-label="Chat options"
                          onClick={(e) => e.preventDefault()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <DotsHorizontalIcon />
                        </IconButton>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Content size="1" align="start" sideOffset={5} onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
                        <DropdownMenu.Item onSelect={() => handleRenameClick(chat)}>
                          <Pencil1Icon className="mr-2 h-4 w-4" />Rename
                        </DropdownMenu.Item>
                        <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)}>
                          <TrashIcon className="mr-2 h-4 w-4" />Delete
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Root>
                  </Flex>
                ))}
              </nav>
            </Flex>
          </ScrollArea>
        )}
      </Box>

      <AlertDialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && cancelRename()}>
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Rename Chat</AlertDialog.Title>
          {renamingChat && (
            <AlertDialog.Description size="2" color="gray" mt="1" mb="4">
              Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave empty to remove the name.
            </AlertDialog.Description>
          )}
          <Flex direction="column" gap="3">
            <TextField.Root
              size="2"
              value={currentRenameValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentRenameValue(e.target.value)}
              placeholder="Enter new name (optional)"
              autoFocus
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveRename();
                }
              }}
            />
            {renameError && <Text color="red" size="1">{renameError}</Text>}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" onClick={cancelRename}>Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button onClick={handleSaveRename}>Save</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && cancelDelete()}>
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Chat</AlertDialog.Title>
          {deletingChat && (
            <AlertDialog.Description size="2" color="gray" mt="1" mb="4">
              Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.
            </AlertDialog.Description>
          )}
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" onClick={cancelDelete}>Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={confirmDelete}>Delete</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
