// src/hooks/useStarMessageDialog.ts
import { useState, useCallback } from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import {
    // Import specific atoms from source files or main index
    starMessageActionAtom, // From actionAtoms
    activeChatIdAtom       // From chatAtoms
} from '../store'; // Use main index
import type { ChatMessage } from '../types';

export function useStarMessageDialog() {
    const starMessageAction = useSetAtom(starMessageActionAtom);
    const activeChatId = useAtomValue(activeChatIdAtom); // Use correct atom

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [messageToName, setMessageToName] = useState<ChatMessage | null>(null);
    const [templateNameInput, setTemplateNameInput] = useState('');
    const [namingError, setNamingError] = useState<string | null>(null);

    const openDialog = useCallback((message: ChatMessage) => { setMessageToName(message); setTemplateNameInput(message.starredName || message.text.substring(0, 70) + (message.text.length > 70 ? '...' : '')); setNamingError(null); setIsDialogOpen(true); }, []);
    const closeDialog = useCallback(() => { setIsDialogOpen(false); setMessageToName(null); setTemplateNameInput(''); setNamingError(null); }, []);
    const handleStarClick = useCallback((message: ChatMessage) => { if (activeChatId === null) return; if (message.starred) { starMessageAction({ chatId: activeChatId, messageId: message.id, shouldStar: false }); } else { openDialog(message); } }, [activeChatId, starMessageAction, openDialog]);
    const handleConfirmName = useCallback(() => { if (!messageToName || activeChatId === null) return; const finalName = templateNameInput.trim(); if (!finalName) { setNamingError("Please enter a name for the starred template."); return; } starMessageAction({ chatId: activeChatId, messageId: messageToName.id, shouldStar: true, name: finalName }); closeDialog(); }, [messageToName, activeChatId, templateNameInput, starMessageAction, closeDialog]);
     const handleOpenChange = useCallback((open: boolean) => { if (!open) { closeDialog(); } }, [closeDialog]);

    return {
        isDialogOpen, messageToName, templateNameInput, setTemplateNameInput, namingError, setNamingError,
        handleStarClick, handleConfirmName, handleCancelName: closeDialog, handleOpenChange,
    };
}
