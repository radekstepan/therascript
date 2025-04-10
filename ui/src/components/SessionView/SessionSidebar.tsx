// src/components/SessionView/SessionSidebar.tsx
import React, { useState } from 'react';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { useAtomValue, useSetAtom } from 'jotai';
import {
    activeSessionAtom, // Reads the active session object
    renameChatAtom,
    deleteChatAtom,
    activeChatIdAtom, // Reads the currently selected chat ID
    startNewChatAtom,
    chatErrorAtom,
} from '../../store';
import { deleteChat as deleteChatApi } from '../../api/api';
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
    Spinner
} from '@radix-ui/themes';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

export function SessionSidebar() {
    // Hooks
    const { sessionId: sessionIdParam } = useParams<{ sessionId: string; chatId?: string }>();
    const navigate = useNavigate();
    const session = useAtomValue(activeSessionAtom); // Get the active session object
    const renameChatAction = useSetAtom(renameChatAtom);
    const deleteChatAction = useSetAtom(deleteChatAtom);
    const startNewChatAction = useSetAtom(startNewChatAtom);
    const setChatError = useSetAtom(chatErrorAtom);
    const currentActiveChatId = useAtomValue(activeChatIdAtom);

    // Modal States
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);

    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);

    // --- LOGGING INSIDE SIDEBAR ---
    console.log('[SessionSidebar] Rendering. Active session from atom:',
       session ? { id: session.id, name: session.sessionName, chats_exist: session.hasOwnProperty('chats'), chats_is_array: Array.isArray(session.chats) } : null
    );
    if(session && session.chats) {
       // console.log('[SessionSidebar] Chats array content:', session.chats); // Potentially noisy
    }
    // --- END LOGGING ---

    // --- Loading / Validation ---
    if (!session || !sessionIdParam) {
        console.log('[SessionSidebar] State: Loading session object...');
        return (
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
               <Spinner size="2" /> <Text size="1" color="gray" mt="2">Loading session...</Text>
            </Box>
        );
    }

    const sessionId = parseInt(sessionIdParam, 10);
    if (isNaN(sessionId) || session.id !== sessionId) {
        console.error("[SessionSidebar] State: Session ID mismatch.", { urlSessionId: sessionIdParam, activeSessionId: session.id });
        return (
             <Box p="4" className="flex flex-col h-full w-full overflow-hidden items-center justify-center" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                <Text size="1" color="red">Error: Session mismatch.</Text>
             </Box>
        );
    }

    // ** REFINED CHECK: Check if 'chats' property exists AND is an array **
    const chatsDefinedAndIsArray = session.hasOwnProperty('chats') && Array.isArray(session.chats);

    // Prepare sorted chats only if defined and is an array
    const sortedChats = chatsDefinedAndIsArray
        ? [...session.chats].sort((a, b) => b.timestamp - a.timestamp)
        : []; // Default to empty array if not defined/array


    // Helper to get display title (unchanged)
    const getChatDisplayTitle = (chat: ChatSession | null): string => {
         if (!chat) return 'Unknown Chat';
         return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };

    // --- Action Handlers ---
    const handleNewChatClick = async () => {
        // Check currentSessionIdNum again in case params changed? Or rely on session.id
        const result = await startNewChatAction({ sessionId: session.id });
        if (result.success) { /* Navigation handled by SessionView */ }
        else { setChatError(result.error); }
    };
    const handleRenameClick = (chat: ChatSession) => { setRenamingChat(chat); setCurrentRenameValue(chat.name || ''); setRenameError(null); setIsRenameModalOpen(true); };
    const handleSaveRename = () => { if (!renamingChat) return; renameChatAction({ chatId: renamingChat.id, newName: currentRenameValue.trim() }); cancelRename(); };
    const cancelRename = () => { setIsRenameModalOpen(false); setRenamingChat(null); setCurrentRenameValue(''); setRenameError(null); };
    const handleDeleteClick = (chat: ChatSession) => { setDeletingChat(chat); setIsDeleteConfirmOpen(true); };
    const confirmDelete = async () => {
        if (!deletingChat) return;
        try {
            await deleteChatApi(session.id, deletingChat.id); // Use session.id
            const result = deleteChatAction({ chatId: deletingChat.id });
            if (result.success) {
                if (currentActiveChatId === deletingChat.id) {
                    if (result.newActiveChatId !== null) { navigate(`/sessions/${session.id}/chats/${result.newActiveChatId}`, { replace: true }); }
                    else { navigate(`/sessions/${session.id}`, { replace: true }); }
                }
            } else { console.error("Failed delete state update:", result.error); setChatError(result.error); }
        } catch (err) { console.error("Failed delete API call:", err); setChatError("Failed to delete chat."); }
        cancelDelete();
    };
    const cancelDelete = () => { setIsDeleteConfirmOpen(false); setDeletingChat(null); };
    const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => { const base = "..."; const active = "..."; const inactive = "..."; return cn(base, isActive ? active : inactive); };


    // --- Render Logic ---
    return (
        <>
            <Box p="4" className="flex flex-col h-full w-full overflow-hidden" style={{ backgroundColor: 'var(--color-panel-solid)' }}>
                {/* Header */}
                <Flex justify="between" align="center" flexShrink="0" mb="2">
                    <Heading as="h3" size="2" color="gray" trim="start" weight="medium">Chats</Heading>
                    <Button onClick={handleNewChatClick} variant="soft" size="1" highContrast title="Start New Chat"><PlusCircledIcon width="16" height="16" /></Button>
                </Flex>

                {/* Chat List Area: Conditional rendering based on refined check */}
                {!chatsDefinedAndIsArray ? (
                    <Flex flexGrow="1" align="center" justify="center">
                        <Spinner size="2"/>
                        <Text color="gray" size="2" style={{ fontStyle: 'italic' }} ml="2">Loading chats...</Text>
                    </Flex>
                ) :
                sortedChats.length === 0 ? (
                    <Flex flexGrow="1" align="center" justify="center">
                        <Text color="gray" size="2" style={{ fontStyle: 'italic' }}>No chats yet.</Text>
                    </Flex>
                ) : (
                    <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
                        <Flex direction="column" gap="1" asChild>
                            <nav>
                                {sortedChats.map((chat) => (
                                    <Flex key={chat.id} align="center" justify="between" className="group relative px-2 py-1.5 rounded-md hover:bg-[--gray-a3]" style={currentActiveChatId === chat.id ? { backgroundColor: 'var(--accent-a4)' } : {}}>
                                        <NavLink to={`/sessions/${session.id}/chats/${chat.id}`} className={getNavLinkClass} title={getChatDisplayTitle(chat)} end>
                                            <Text size="2" truncate className="flex-grow">{getChatDisplayTitle(chat)}</Text>
                                        </NavLink>
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger>
                                                <IconButton variant="ghost" color="gray" size="1" className="flex-shrink-0 ml-1 p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" aria-label="Chat options" onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
                                                    <DotsHorizontalIcon />
                                                </IconButton>
                                            </DropdownMenu.Trigger>
                                            <DropdownMenu.Content size="1" align="start" sideOffset={5} onClick={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()}>
                                                <DropdownMenu.Item onSelect={() => handleRenameClick(chat)}><Pencil1Icon className="mr-2 h-4 w-4" />Rename</DropdownMenu.Item>
                                                <DropdownMenu.Item color="red" onSelect={() => handleDeleteClick(chat)}><TrashIcon className="mr-2 h-4 w-4" />Delete</DropdownMenu.Item>
                                            </DropdownMenu.Content>
                                        </DropdownMenu.Root>
                                    </Flex>
                                ))}
                            </nav>
                        </Flex>
                    </ScrollArea>
                )}
            </Box>

            {/* Modals */}
            <AlertDialog.Root open={isRenameModalOpen} onOpenChange={(open) => !open && cancelRename()}>
                 <AlertDialog.Content style={{ maxWidth: 450 }}> {/* ... Rename Modal Content ... */}
                    <AlertDialog.Title>Rename Chat</AlertDialog.Title>
                    {renamingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Enter a new name for "{getChatDisplayTitle(renamingChat)}". Leave empty to remove the name.</AlertDialog.Description>}
                    <Flex direction="column" gap="3">
                        <TextField.Root size="2" value={currentRenameValue} onChange={(e) => setCurrentRenameValue(e.target.value)} placeholder="Enter new name (optional)" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveRename(); } }} />
                        {renameError && <Text color="red" size="1">{renameError}</Text>}
                    </Flex>
                    <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelRename}>Cancel</Button></AlertDialog.Cancel>
                        <AlertDialog.Action><Button onClick={handleSaveRename}>Save</Button></AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={(open) => !open && cancelDelete()}>
                <AlertDialog.Content style={{ maxWidth: 450 }}> {/* ... Delete Modal Content ... */}
                    <AlertDialog.Title>Delete Chat</AlertDialog.Title>
                    {deletingChat && <AlertDialog.Description size="2" color="gray" mt="1" mb="4">Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.</AlertDialog.Description>}
                    <Flex gap="3" mt="4" justify="end">
                        <AlertDialog.Cancel><Button variant="soft" color="gray" onClick={cancelDelete}>Cancel</Button></AlertDialog.Cancel>
                        <AlertDialog.Action><Button color="red" onClick={confirmDelete}>Delete</Button></AlertDialog.Action>
                    </Flex>
                 </AlertDialog.Content>
            </AlertDialog.Root>
        </>
    );
}
