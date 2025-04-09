import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import { activeSessionAtom, renameChatAtom, deleteChatAtom, activeChatIdAtom } from '../../store';
import { ChatBubbleIcon, DotsHorizontalIcon, Pencil1Icon, TrashIcon } from '@radix-ui/react-icons';
import {
    Box, Flex, Text, Heading, Button, IconButton, TextField,
    DropdownMenu, AlertDialog, ScrollArea, Separator
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
    const currentActiveChatIdAtomValue = useAtomValue(activeChatIdAtom);
    // Removed unused setActiveChatId

    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);

    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);

    if (!session || !sessionIdParam) return null;
    const sessionId = parseInt(sessionIdParam, 10);

    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);
    const getChatDisplayTitle = (chat: ChatSession | null): string => {
        if (!chat) return 'Unknown Chat';
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChat(chat); setCurrentRenameValue(chat.name || ''); setRenameError(null); setIsRenameModalOpen(true);
    };
    const handleSaveRename = () => {
        if (!renamingChat) return;
        renameChatAction({ chatId: renamingChat.id, newName: currentRenameValue.trim() });
        cancelRename();
    };
    const cancelRename = () => {
        setIsRenameModalOpen(false); setRenamingChat(null); setCurrentRenameValue(''); setRenameError(null);
    };
    const handleDeleteClick = (chat: ChatSession) => {
        setDeletingChat(chat); setIsDeleteConfirmOpen(true);
    };
    const confirmDelete = () => {
        if (!deletingChat || isNaN(sessionId)) return;
        const result = deleteChatAction({ chatId: deletingChat.id });
        if (result.success) {
             if (currentActiveChatIdAtomValue === deletingChat.id) {
                 if (result.newActiveChatId !== null) {
                     navigate(`/sessions/${sessionId}/chats/${result.newActiveChatId}`, { replace: true });
                 } else {
                     navigate(`/sessions/${sessionId}`, { replace: true });
                 }
             }
        } else {
            console.error("Failed to delete chat:", result.error); alert(`Error deleting chat: ${result.error}`);
        }
        cancelDelete();
    };
    const cancelDelete = () => { setIsDeleteConfirmOpen(false); setDeletingChat(null); };
    const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
         const base = "group flex items-center w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors duration-150 relative";
         const active = "bg-[--accent-a4] text-[--accent-a11] font-medium";
         const inactive = "text-[--gray-a11] hover:bg-[--gray-a3] hover:text-[--gray-a12]";
         return cn(base, isActive ? active : inactive);
     };

    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)'}}>
                <Box flexShrink="0" mb="2">
                    <Heading as="h3" size="1" color="gray" trim="start">Chats</Heading>
                </Box>
                {sortedChats.length === 0 ? (
                    <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
                ) : (
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
                         {/* Changed gap from number to string */}
                        <Flex direction="column" gap="1" asChild>
                            <nav>
                                {sortedChats.map(chat => (
                                    <div key={chat.id} className="group relative">
                                        <NavLink to={`/sessions/${sessionId}/chats/${chat.id}`} className={getNavLinkClass} title={getChatDisplayTitle(chat)} end>
                                            <ChatBubbleIcon className="mr-2 h-4 w-4 flex-shrink-0 text-[--gray-a9] group-hover:text-[--gray-a11]" />
                                            <Text size="2" truncate className="flex-grow">{getChatDisplayTitle(chat)}</Text>
                                        </NavLink>
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger>
                                                <IconButton variant="ghost" color="gray" size="1" className="absolute right-1 top-1/2 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" aria-label="Chat options" onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => e.stopPropagation()} onClick={(e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault()} >
                                                    <DotsHorizontalIcon />
                                                </IconButton>
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Content size="1" align="start" sideOffset={5} onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()} onClick={(e: React.MouseEvent<HTMLDivElement>) => e.preventDefault()}>
                                                <DropdownMenu.Item onSelect={() => handleRenameClick(chat)}> <Pencil1Icon className="mr-2 h-4 w-4" />Rename </DropdownMenu.Item>
                                                <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)}> <TrashIcon className="mr-2 h-4 w-4" />Delete </DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Root>
                                    </div>
                                ))}
                            </nav>
                        </Flex>
                    </ScrollArea>
                )}
            </Box>

            <AlertDialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && cancelRename()}>
                <AlertDialog.Content style={{ maxWidth: 450 }}>
                    <AlertDialog.Title>
                        Rename Chat
                    </AlertDialog.Title>
                    {renamingChat && ( <AlertDialog.Description size="2" color="gray" mt="1" mb="4"> Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave empty to remove the name. </AlertDialog.Description> )}
                    {/* Changed gap from number to string */}
                    <Flex direction="column" gap="3">
                        {/* Corrected TextField Usage - Assuming previous fix applied */}
                        <TextField.Root size="2">
                            <TextField.Root
                                value={currentRenameValue}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCurrentRenameValue(e.target.value)}
                                placeholder="Enter new name (optional)"
                                autoFocus
                                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveRename(); }}}
                            />
                        </TextField.Root>
                         {renameError && (<Text color="red" size="1">{renameError}</Text>)}
                    </Flex>
                    {/* Changed gap from number to string */}
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
                    <AlertDialog.Title>
                        Delete Chat
                    </AlertDialog.Title>
                    {deletingChat && ( <AlertDialog.Description size="2" color="gray" mt="1" mb="4"> Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone. </AlertDialog.Description> )}
                    {/* Changed gap from number to string */}
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
