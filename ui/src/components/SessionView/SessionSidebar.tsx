// src/components/SessionView/SessionSidebar.tsx
import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai'; // Use useAtomValue for reading derived state
import {
  activeSessionAtom, // Read the derived active session object
  renameChatAtom,
  deleteChatAtom,
  activeChatIdAtom,
  startNewChatAtom,
  chatErrorAtom,
} from '../../store';
import { deleteChat } from '../../api/api'; // API function for deletion
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
  // Removed Separator as it wasn't used after map
} from '@radix-ui/themes';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

export function SessionSidebar() {
  const { sessionId: sessionIdParam, chatId: chatIdParam } = useParams<{ sessionId: string; chatId?: string }>();
  const navigate = useNavigate();
  const session = useAtomValue(activeSessionAtom); // Get the derived active session
  const renameChatAction = useSetAtom(renameChatAtom);
  const deleteChatAction = useSetAtom(deleteChatAtom);
  const startNewChatAction = useSetAtom(startNewChatAtom);
  const setChatError = useSetAtom(chatErrorAtom);
  const currentActiveChatId = useAtomValue(activeChatIdAtom); // Read primitive atom directly

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
  const [currentRenameValue, setCurrentRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null); // Unused, consider removing

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);

  // Derive sessionId only once, ensures it's a number
  const sessionId = React.useMemo(() => {
    const id = sessionIdParam ? parseInt(sessionIdParam, 10) : NaN;
    return isNaN(id) ? null : id;
  }, [sessionIdParam]);

  // --- Early exit if session ID is invalid or session data isn't loaded ---
  if (sessionId === null) {
    console.error("SessionSidebar: Invalid session ID in URL parameter:", sessionIdParam);
    // Optionally navigate away or show an error placeholder
    return <Box p="4"><Text color="red" size="2">Invalid Session ID</Text></Box>;
  }
  if (!session) {
       console.log("SessionSidebar: No active session data available yet.");
       // Render a loading or empty state while session data is being fetched/processed
       return <Box p="4"><Text color="gray" size="2">Loading chats...</Text></Box>;
  }
  // Now we know session and sessionId are valid
  console.log(`SessionSidebar rendering for session ${session.id}. Chats in session state:`, session.chats);

  // --- Safely access and sort chats ---
  // Ensure session.chats is always treated as an array, even if null/undefined initially
  const sortedChats = React.useMemo(() => {
      const chats = Array.isArray(session.chats) ? session.chats : [];
      console.log(`SessionSidebar: Sorting ${chats.length} chats.`);
      return [...chats].sort((a, b) => b.timestamp - a.timestamp);
  }, [session.chats]); // Re-sort only when session.chats changes

  // --- Utility Functions ---
  const getChatDisplayTitle = (chat: ChatSession | null): string => {
    if (!chat) return 'Unknown Chat';
    return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
  };

  // --- Event Handlers ---
  const handleNewChatClick = async () => {
    console.log("Sidebar: New chat button clicked");
    const result = await startNewChatAction({ sessionId }); // Use validated sessionId
    if (result.success) {
      console.log("Sidebar: New chat started, navigating to:", `/sessions/${sessionId}/chats/${result.newChatId}`);
      navigate(`/sessions/${sessionId}/chats/${result.newChatId}`);
    } else {
      console.error("Sidebar: Failed to start new chat:", result.error);
      setChatError(result.error); // Show error to user if applicable
    }
  };

  const handleRenameClick = (chat: ChatSession) => {
    setRenamingChat(chat);
    setCurrentRenameValue(chat.name || '');
    setRenameError(null); // Clear previous errors if any
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
    console.log(`Attempting to delete chat ${deletingChat.id} for session ${sessionId}`);
    try {
      // API call MUST happen first
      await deleteChat(sessionId, deletingChat.id);
      console.log(`API delete successful for chat ${deletingChat.id}`);
      // Then update local state via action
      const result = deleteChatAction({ chatId: deletingChat.id });
      console.log("Local delete action result:", result);
      if (result.success) {
        // Navigate if the deleted chat was the active one
        if (currentActiveChatId === deletingChat.id) {
          if (result.newActiveChatId !== null) {
             console.log(`Deleted chat was active, navigating to new active chat: ${result.newActiveChatId}`);
            navigate(`/sessions/${sessionId}/chats/${result.newActiveChatId}`, { replace: true });
          } else {
            console.log("Deleted chat was active, no other chats left, navigating to session base.");
            navigate(`/sessions/${sessionId}`, { replace: true });
          }
        } else {
             console.log("Deleted chat was not active, no navigation needed.");
        }
      } else {
        // Handle local state update failure (though less likely if API succeeded)
        console.error("Failed to delete chat locally:", result.error);
        setChatError(result.error);
      }
    } catch (err) {
      console.error("Failed to delete chat on backend:", err);
      setChatError(err instanceof Error ? err.message : "Failed to delete chat.");
    } finally {
         // Always close the dialog
         cancelDelete();
    }
  };
  const cancelDelete = () => {
    setIsDeleteConfirmOpen(false);
    setDeletingChat(null);
  };

  // --- NavLink Styling ---
  const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = "group/link flex flex-grow items-center w-full text-left rounded-md text-sm transition-colors duration-150 overflow-hidden";
    const active = "text-[--accent-a11] font-medium"; // Use Radix accent color variable
    const inactive = "text-[--gray-a11] hover:text-[--gray-a12]"; // Use Radix gray variables
    return cn(base, isActive ? active : inactive);
  };

  // --- Component Render ---
  return (
    <>
      <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
        {/* Header */}
        <Flex justify="between" align="center" flexShrink="0" mb="2">
          <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
          <Button onClick={handleNewChatClick} variant="soft" size="1" highContrast title="Start New Chat">
            <PlusCircledIcon width="16" height="16" />
          </Button>
        </Flex>

        {/* Chat List or Empty State */}
        {sortedChats.length === 0 ? (
          <Flex flexGrow="1" align="center" justify="center">
                <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
          </Flex>
        ) : (
          <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, minHeight: 0 }}> {/* Ensure ScrollArea can shrink */}
            <Flex direction="column" gap="1" asChild>
              <nav>
                {sortedChats.map((chat) => (
                  <Flex
                    key={chat.id}
                    align="center"
                    justify="between"
                    className="group relative px-2 py-1.5 rounded-md hover:bg-[--gray-a3]" // Radix gray variable
                    style={currentActiveChatId === chat.id ? { backgroundColor: 'var(--accent-a4)' } : {}} // Radix accent variable
                  >
                    {/* NavLink */}
                    <NavLink
                        to={`/sessions/${sessionId}/chats/${chat.id}`}
                        className={getNavLinkClass}
                        title={getChatDisplayTitle(chat)}
                        end // Use end prop for exact match
                    >
                      <Text size="2" truncate className="flex-grow">{getChatDisplayTitle(chat)}</Text>
                    </NavLink>
                    {/* Options Dropdown */}
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger>
                        <IconButton
                          variant="ghost"
                          color="gray"
                          size="1"
                          className="flex-shrink-0 ml-1 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          aria-label="Chat options"
                          // Prevent triggering NavLink when clicking dots
                          onClick={(e) => e.stopPropagation()}
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

      {/* Rename Chat Dialog */}
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
                } else if (e.key === 'Escape') {
                   e.preventDefault();
                   cancelRename();
                }
              }}
            />
            {/* {renameError && <Text color="red" size="1">{renameError}</Text>} */}
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

      {/* Delete Chat Dialog */}
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
