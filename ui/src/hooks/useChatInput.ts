// src/hooks/useChatInput.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
    // Import specific atoms from their source files or main index
    currentQueryAtom,      // From chatAtoms
    activeSessionIdAtom,   // From sessionAtoms <<< CORRECTED
    activeChatIdAtom,      // From chatAtoms
    chatErrorAtom,         // From chatAtoms
    toastMessageAtom,      // From uiAtoms
    isChattingAtom,        // From chatAtoms
    addChatMessageActionAtom, // From actionAtoms
} from '../store'; // Use main index

export function useChatInput(disabled: boolean = false) {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const activeSessionId = useAtomValue(activeSessionIdAtom); // Correct atom
    const activeChatId = useAtomValue(activeChatIdAtom);
    const [chatError, setChatError] = useAtom(chatErrorAtom);
    const [toastMessage, setToastMessage] = useAtom(toastMessageAtom);
    const isAiResponding = useAtomValue(isChattingAtom);
    const addChatMessage = useSetAtom(addChatMessageActionAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);
    const [isToastVisible, setIsToastVisible] = useState(false);

    useEffect(() => { if (activeChatId !== null && !disabled && !isAiResponding) { inputRef.current?.focus(); } }, [activeChatId, disabled, isAiResponding]);
    useEffect(() => { if ((chatError === "Cannot send an empty message." || chatError === "Please select a chat first.") && currentQuery.trim() !== '') { setChatError(''); } }, [currentQuery, chatError, setChatError]);
    useEffect(() => { setIsToastVisible(!!toastMessage); }, [toastMessage]);

    const handleSelectTemplate = useCallback((text: string) => { setCurrentQuery((prev: string) => (prev ? `${prev} ${text}` : text)); setShowTemplates(false); if (!disabled && !isAiResponding) { inputRef.current?.focus(); } }, [disabled, isAiResponding, setCurrentQuery]);
    const trySubmit = useCallback(async () => {
        if (disabled || isAiResponding || !currentQuery.trim() || activeChatId === null) {
             if (!currentQuery.trim()) setChatError("Cannot send an empty message."); else if (activeChatId === null) setChatError("Please select a chat first."); else if (isAiResponding) setToastMessage("Please wait for the AI to finish responding."); return false;
        }
        const queryToSend = currentQuery; setCurrentQuery('');
        await addChatMessage(queryToSend); if (!disabled) { inputRef.current?.focus(); } return true;
    }, [disabled, isAiResponding, currentQuery, activeChatId, setCurrentQuery, addChatMessage, setChatError, setToastMessage]);
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); trySubmit(); } else if (e.key === 'Escape') { setShowTemplates(false); } }, [trySubmit]);
    const handleSubmitClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); trySubmit(); }, [trySubmit]);
    const handleCancelClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => { e.preventDefault(); setToastMessage("Cancellation not supported by backend yet."); if (!disabled) { inputRef.current?.focus(); } }, [disabled, setToastMessage]);
    const handleToastOpenChange = useCallback((open: boolean) => { setIsToastVisible(open); if (!open) setToastMessage(null); }, [setToastMessage]);

    const showCancelButton = isAiResponding && !disabled;
    const sendButtonDisabled = disabled || !currentQuery.trim() || activeChatId === null || isAiResponding;
    const starredButtonDisabled = disabled || activeChatId === null || isAiResponding;
    const inputFieldDisabled = disabled || activeChatId === null || isAiResponding;

    return {
        inputRef, currentQuery, setCurrentQuery, showTemplates, setShowTemplates, isToastVisible, toastMessage, chatError, isAiResponding,
        handleSelectTemplate, handleKeyDown, handleSubmitClick, handleCancelClick, handleToastOpenChange,
        showCancelButton, sendButtonDisabled, starredButtonDisabled, inputFieldDisabled,
    };
}
