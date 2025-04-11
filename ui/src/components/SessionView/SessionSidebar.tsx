// src/components/SessionView/SessionSidebar.tsx
import React, { useState, useCallback } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom, useAtom } from 'jotai';
import {
    activeSessionAtom,
    renameChatActionAtom,
    deleteChatActionAtom,
    activeChatIdAtom,
    startNewChatActionAtom,
    chatErrorAtom,
} from '../../store';
import { DotsHorizontalIcon, Pencil1Icon, TrashIcon, PlusCircledIcon } from '@radix-ui/react-icons';
import {
    Box, Flex, Text, Heading, Button, IconButton, TextField,
    DropdownMenu, AlertDialog, ScrollArea, Spinner, Callout
} from '@radix-ui/themes';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

export function SessionSidebar() {
    const { sessionId: sessionIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const session = useAtomValue(activeSessionAtom);
    const renameChatAction = useSetAtom(renameChatActionAtom);
    const deleteChatAction = useSetAtom(deleteChatActionAtom);
    const startNewChatAction = useSetAtom(startNewChatActionAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const currentActiveChatId = useAtomValue(activeChatIdAtom);

    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null); // Rename specific validation
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // --- Define cancel handlers BEFORE they are used ---
    const cancelRename = useCallback(() => {
        setIsRenameModalOpen(false); setRenamingChat(null); setCurrentRenameValue(''); setRenameError(null);
    }, []);

    const cancelDelete = useCallback(() => {
        setIsDeleteConfirmOpen(false); setDeletingChat(null);
    }, []);

    // --- Action Handlers ---
    const handleNewChatClick = useCallback(async () => { if(!session) return; setChatError(''); await startNewChatAction({ sessionId: session.id }); }, [startNewChatAction, session, setChatError]);
    const handleRenameClick = useCallback((chat: ChatSession) => { setRenamingChat(chat); setCurrentRenameValue(chat.name || ''); setRenameError(null); setIsRenameModalOpen(true); }, []);
    const handleSaveRename = useCallback(async () => { if (!renamingChat) return; const trimmedName = currentRenameValue.trim(); setRenameError(null); await renameChatAction({ chatId: renamingChat.id, newName: trimmedName }); cancelRename(); }, [renamingChat, currentRenameValue, renameChatAction, cancelRename]);
    const handleDeleteClick = useCallback((chat: ChatSession) => { setDeletingChat(chat); setIsDeleteConfirmOpen(true); setChatError(''); }, [setChatError]);
    const confirmDelete = useCallback(async () => {
        if (!deletingChat || !session) return; setIsDeleting(true); setChatError('');
        const result = await deleteChatAction({ chatId: deletingChat.id });
        setIsDeleting(false);
        if (result.success) {
            if (currentActiveChatId === deletingChat.id) {
                 if (result.newActiveChatId !== null) { navigate(`/sessions/${session.id}/chats/${result.newActiveChatId}`, { replace: true }); }
                 else { navigate(`/sessions/${session.id}`, { replace: true }); }
            }
            cancelDelete();
        } // Error shown via chatError atom
    }, [deletingChat, deleteChatAction, setChatError, cancelDelete, currentActiveChatId, session, navigate]);

    // --- Loading / Validation ---
    if (!session || !sessionIdParam) {
        // Corrected syntax: Return valid JSX
        return (
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
               <Spinner size="2" /> <Text size="1" color="gray" mt="2">Loading session...</Text>
            </Box>
        );
    }
    const sessionId = parseInt(sessionIdParam, 10);
    const chats = Array.isArray(session.chats) ? session.chats : [];
    const sortedChats = [...chats].sort((a, b) => b.timestamp - a.timestamp);

    const getChatDisplayTitle = (chat: ChatSession | null): string => chat ? (chat.name || `Chat (${formatTimestamp(chat.timestamp)})`) : 'Unknown Chat';
    const getNavLinkClass = (isActive: boolean): string => cn("flex-grow block text-inherit no-underline", isActive ? "font-medium text-[--accent-11]" : "text-[--gray-11] hover:text-[--gray-12]", "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[--color-panel-solid] focus-visible:ring-[--accent-8] rounded");

    // --- Render Logic ---
    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                <Flex justify="between" align="center" flexShrink="0" mb="2"> <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading> <Button onClick={handleNewChatClick} variant="soft" size="1" highContrast title="Start New Chat"><PlusCircledIcon width="16" height="16" /></Button> </Flex>
                 {chatError && !isDeleteConfirmOpen && ( <Box mb="2" px="1"> <Callout.Root color="red" size="1" role="alert"> <Callout.Text>{chatError}</Callout.Text> </Callout.Root> </Box> )}
                 {sortedChats.length === 0 ? ( <Flex flexGrow="1" align="center" justify="center"> <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text> </Flex> )
                  : ( <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1, margin: '-4px' }}> <Flex direction="column" gap="1" asChild p="1"> <nav aria-label="Chat history">
                         {sortedChats.map((chat) => { const isActive = currentActiveChatId === chat.id; return (
                            <Flex key={chat.id} align="center" justify="between" className={cn("group relative px-2 py-1.5 rounded-md", isActive ? "bg-[--accent-a4]" : "hover:bg-[--gray-a3]")} >
                                <NavLink to={`/sessions/${session.id}/chats/${chat.id}`} className={getNavLinkClass(isActive)} title={getChatDisplayTitle(chat)} aria-current={isActive ? 'page' : undefined} end > <Text size="2" truncate> {getChatDisplayTitle(chat)} </Text> </NavLink>
                                <DropdownMenu.Root> <DropdownMenu.Trigger> <IconButton variant="ghost" color="gray" size="1" className="flex-shrink-0 ml-1 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" aria-label={`Options for ${getChatDisplayTitle(chat)}`} onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()} > <DotsHorizontalIcon /> </IconButton> </DropdownMenu.Trigger>
                                    <DropdownMenu.Content size="1" align="start" sideOffset={5} onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()} >
                                        <DropdownMenu.Item onSelect={() => handleRenameClick(chat)}> <Pencil1Icon className="mr-2 h-4 w-4" />Rename </DropdownMenu.Item>
                                        <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)}> <TrashIcon className="mr-2 h-4 w-4" />Delete </DropdownMenu.Item>
                                    </DropdownMenu.Content>
                                </DropdownMenu.Root>
                            </Flex> );
                        })} </nav> </Flex> </ScrollArea>
                 )}
            </Box>
            {/* Rename Modal */}
            <AlertDialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && cancelRename()}> <AlertDialog.Content style={{ maxWidth: 450 }}> <AlertDialog.Title>Rename Chat</AlertDialog.Title> {renamingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave empty to remove the name.</AlertDialog.Description>} <Flex direction="column" gap="3"> <TextField.Root size="2" value={currentRenameValue} onChange={(e) => {setCurrentRenameValue(e.target.value); setRenameError(null);}} placeholder="Enter new name (optional)" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveRename(); } }} aria-invalid={!!renameError} aria-describedby={renameError ? "rename-error-text" : undefined} /> {renameError && <Text color="red" size="1" id="rename-error-text">{renameError}</Text>} </Flex> <Flex gap="3" mt="4" justify="end"> <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelRename}>Cancel</Button></AlertDialog.Cancel> <AlertDialog.Action><Button onClick={handleSaveRename}>Save</Button></AlertDialog.Action> </Flex> </AlertDialog.Content> </AlertDialog.Root>
            {/* Delete Modal */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && cancelDelete()}> <AlertDialog.Content style={{ maxWidth: 450 }}> <AlertDialog.Title>Delete Chat</AlertDialog.Title> {deletingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.</AlertDialog.Description>} {chatError && isDeleteConfirmOpen && ( <Box mb="2"> <Callout.Root color="red" size="1" role="alert"> <Callout.Text>{chatError}</Callout.Text> </Callout.Root> </Box> )} <Flex gap="3" mt="4" justify="end"> <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelDelete} disabled={isDeleting}>Cancel</Button></AlertDialog.Cancel> <AlertDialog.Action><Button color="red" onClick={confirmDelete} disabled={isDeleting}> {isDeleting ? <Spinner size="1"/> : 'Delete'} </Button></AlertDialog.Action> </Flex> </AlertDialog.Content> </AlertDialog.Root>
        </>
    );
}
