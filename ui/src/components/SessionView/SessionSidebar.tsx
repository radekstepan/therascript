import React, { useState } from 'react'; // Import useState
import { NavLink, useParams, useNavigate } from 'react-router-dom'; // Import useNavigate
import { useAtomValue, useSetAtom } from 'jotai';
import {
    activeSessionAtom,
    renameChatAtom, // Import rename atom
    deleteChatAtom, // Import delete atom
    activeChatIdAtom // Import to potentially update navigation after delete
} from '../../store';
import {
    ChatBubbleIcon,
    DotsHorizontalIcon, // Dots icon
    Pencil1Icon,        // Rename icon
    TrashIcon           // Delete icon
} from '@radix-ui/react-icons';
import { formatTimestamp } from '../../helpers';
import type { ChatSession } from '../../types';
import { cn } from '../../utils';

// Import Radix DropdownMenu components
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
// Import Radix AlertDialog components & our UI components for confirmation dialogs
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';

export function SessionSidebar() {
    const { sessionId: sessionIdParam } = useParams<{ sessionId: string; chatId?: string }>(); // Renamed for clarity
    const navigate = useNavigate(); // Hook for navigation
    const session = useAtomValue(activeSessionAtom);
    const renameChatAction = useSetAtom(renameChatAtom);
    const deleteChatAction = useSetAtom(deleteChatAtom);
    const setActiveChatId = useSetAtom(activeChatIdAtom); // To potentially update after delete

    // State for Rename Modal
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renamingChat, setRenamingChat] = useState<ChatSession | null>(null);
    const [currentRenameValue, setCurrentRenameValue] = useState('');

    // State for Delete Confirmation Modal
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
    const [deletingChat, setDeletingChat] = useState<ChatSession | null>(null);

    if (!session || !sessionIdParam) {
        return null;
    }
    const sessionId = parseInt(sessionIdParam, 10); // Ensure we have the number

    const sortedChats = [...(session.chats || [])].sort((a, b) => b.timestamp - a.timestamp);

    const getChatDisplayTitle = (chat: ChatSession | null): string => {
        // Add this null check
        if (!chat) {
            return 'Unknown Chat'; // Or some other default/placeholder
        }
        return chat.name || `Chat (${formatTimestamp(chat.timestamp)})`;
    };


    // --- Rename Handlers ---
    const handleRenameClick = (chat: ChatSession) => {
        setRenamingChat(chat);
        setCurrentRenameValue(chat.name || ''); // Pre-fill with existing name
        setIsRenameModalOpen(true);
    };

    const handleSaveRename = () => {
        if (!renamingChat) return;
        renameChatAction({ chatId: renamingChat.id, newName: currentRenameValue });
        cancelRename();
    };

    const cancelRename = () => {
        setIsRenameModalOpen(false);
        setRenamingChat(null);
        setCurrentRenameValue('');
    };

    // --- Delete Handlers ---
    const handleDeleteClick = (chat: ChatSession) => {
        setDeletingChat(chat);
        setIsDeleteConfirmOpen(true);
    };

    const confirmDelete = async () => {
        if (!deletingChat || isNaN(sessionId)) return;

        const result = deleteChatAction({ chatId: deletingChat.id }); // Call the delete atom

        if (result.success) {
             // If the deleted chat was active and a new active chat was determined by the atom
             if (result.newActiveChatId !== null) {
                 // Navigate only if the new ID is different from the one being deleted
                 // Or if the new ID is null (meaning no chats left)
                 const currentActiveId = session.chats?.find(c => c.id === deletingChat.id)?.id; // Get the ID before filtering
                 if(result.newActiveChatId !== currentActiveId) {
                    navigate(`/sessions/${sessionId}/chats/${result.newActiveChatId}`, { replace: true });
                 }
             } else {
                 // No chats left, navigate to session base
                 navigate(`/sessions/${sessionId}`, { replace: true });
             }
        } else {
            // Handle error display if needed (e.g., using a toast notification)
            console.error("Failed to delete chat:", result.error);
            alert(`Error deleting chat: ${result.error}`); // Simple alert for now
        }

        cancelDelete();
    };


    const cancelDelete = () => {
        setIsDeleteConfirmOpen(false);
        setDeletingChat(null);
    };

    return (
        <>
            <aside className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col p-4 space-y-4 h-full w-full overflow-hidden">
                <div className="flex-grow flex flex-col min-h-0">
                    <h3 className="px-1 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex-shrink-0">Chats</h3>
                    {sortedChats.length === 0 ? (
                        <p className="px-1 text-gray-500 dark:text-gray-400 italic text-sm">No chats yet.</p>
                    ) : (
                        <div className="flex-grow overflow-y-auto -mx-1 pr-1">
                            <nav className="space-y-1 px-1">
                                {sortedChats.map(chat => (
                                    <div key={chat.id} className="group relative"> {/* Wrapper for NavLink and Menu */}
                                        <NavLink
                                            to={`/sessions/${sessionId}/chats/${chat.id}`}
                                            className={({ isActive }) => getNavLinkClass({ isActive })} // Pass isActive
                                            title={getChatDisplayTitle(chat)}
                                            end // Ensure exact match for active class
                                        >
                                            <ChatBubbleIcon className="mr-2 h-4 w-4 flex-shrink-0 text-gray-400 group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300" />
                                            <span className="truncate flex-grow">{getChatDisplayTitle(chat)}</span>
                                        </NavLink>
                                        {/* Dropdown Menu Trigger */}
                                        <DropdownMenu.Root>
                                            <DropdownMenu.Trigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="iconXs" // Smaller icon button
                                                    className="absolute right-1 top-1/2 -translate-y-1/2 p-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                                    aria-label="Chat options"
                                                    // Prevent navigation when clicking the trigger
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => e.preventDefault()} // Also prevent default link behavior
                                                >
                                                    <DotsHorizontalIcon className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenu.Trigger>

                                            <DropdownMenu.Portal>
                                                 {/* Use standard shadcn/ui styles via utility classes */}
                                                 <DropdownMenu.Content
                                                     className="z-50 min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-gray-900 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-50"
                                                     sideOffset={5}
                                                     align="start"
                                                     // Prevent navigation when clicking menu items
                                                     onMouseDown={(e) => e.stopPropagation()}
                                                     onClick={(e) => e.preventDefault()}
                                                 >
                                                    <DropdownMenu.Item
                                                        className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-gray-800 dark:focus:text-gray-50"
                                                        onSelect={() => handleRenameClick(chat)} // Use onSelect for Radix item actions
                                                    >
                                                        <Pencil1Icon className="mr-2 h-4 w-4" />
                                                        <span>Rename</span>
                                                    </DropdownMenu.Item>
                                                    <DropdownMenu.Item
                                                         className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-red-600 outline-none transition-colors focus:bg-red-50 focus:text-red-700 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:text-red-500 dark:focus:bg-red-900/50 dark:focus:text-red-600" // Adjusted dark focus text
                                                         onSelect={() => handleDeleteClick(chat)}
                                                    >
                                                        <TrashIcon className="mr-2 h-4 w-4" />
                                                        <span>Delete</span>
                                                    </DropdownMenu.Item>
                                                </DropdownMenu.Content>
                                            </DropdownMenu.Portal>
                                        </DropdownMenu.Root>
                                    </div>
                                ))}
                            </nav>
                        </div>
                    )}
                </div>
            </aside>

             {/* Rename Chat Dialog */}
             <AlertDialog.Root open={isRenameModalOpen} onOpenChange={setIsRenameModalOpen}>
                <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                    <AlertDialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg dark:border-gray-800 dark:bg-gray-950">
                        <AlertDialog.Title className="text-lg font-semibold text-gray-900 dark:text-gray-100">Rename Chat</AlertDialog.Title>
                         {/* Add conditional rendering for the description */}
                        {renamingChat && (
                            <AlertDialog.Description className="text-sm text-gray-600 dark:text-gray-400">
                                Enter a new name for "{getChatDisplayTitle(renamingChat)}".
                            </AlertDialog.Description>
                        )}
                        <div className="mt-4 mb-6">
                            <Label htmlFor="rename-chat-input" className="sr-only">New chat name</Label>
                            <Input
                                id="rename-chat-input"
                                value={currentRenameValue}
                                onChange={(e) => setCurrentRenameValue(e.target.value)}
                                placeholder="Enter new name (optional)"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSaveRename(); }}}
                            />
                        </div>
                        <div className="flex justify-end gap-3">
                            <AlertDialog.Cancel asChild>
                                <Button variant="secondary" onClick={cancelRename}>Cancel</Button>
                            </AlertDialog.Cancel>
                            <AlertDialog.Action asChild>
                                <Button onClick={handleSaveRename}>Save</Button>
                            </AlertDialog.Action>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>

            {/* Delete Confirmation Dialog */}
            <AlertDialog.Root open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/30 dark:bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                    <AlertDialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-white p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg dark:border-gray-800 dark:bg-gray-950">
                        <AlertDialog.Title className="text-lg font-semibold text-gray-900 dark:text-gray-100">Delete Chat</AlertDialog.Title>
                         {/* Add conditional rendering for the description */}
                         {deletingChat && (
                            <AlertDialog.Description className="text-sm text-gray-600 dark:text-gray-400">
                                Are you sure you want to delete "{getChatDisplayTitle(deletingChat)}"? This action cannot be undone.
                            </AlertDialog.Description>
                         )}
                        <div className="flex justify-end gap-3 mt-4">
                             <AlertDialog.Cancel asChild>
                                <Button variant="secondary" onClick={cancelDelete}>Cancel</Button>
                            </AlertDialog.Cancel>
                            <AlertDialog.Action asChild>
                                <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
                            </AlertDialog.Action>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>
        </>
    );
}

// Helper function remains the same
const getNavLinkClass = ({ isActive }: { isActive: boolean }): string => {
    const base = "flex items-center w-full text-left pl-3 pr-8 py-1.5 rounded-md text-sm transition-colors duration-150 group relative"; // Added relative, adjusted padding for dots
    const active = "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium";
    const inactive = "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-800 dark:hover:text-gray-200";
    return cn(base, isActive ? active : inactive);
};
