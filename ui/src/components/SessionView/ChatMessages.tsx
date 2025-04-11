// src/components/SessionView/ChatMessages.tsx
import React from 'react';
import { useAtomValue } from 'jotai';
import {
    // Import specific atoms from source files or main index
    activeChatIdAtom,        // From chatAtoms.ts
    currentChatMessagesAtom  // From derivedAtoms.ts
} from '../../store'; // Use main index
import { useStarMessageDialog } from '../../hooks/useStarMessageDialog';
import { ChatMessagesList } from './ChatMessagesList';
import { ChatMessagesEmpty } from './ChatMessagesEmpty';
import { StarMessageDialog } from './StarMessageDialog';

interface ChatMessagesProps {} // No props needed

export function ChatMessages({ }: ChatMessagesProps) {
    const activeChatId = useAtomValue(activeChatIdAtom); // Use correct atom
    const messages = useAtomValue(currentChatMessagesAtom);

    // Hook manages dialog state and actions
    const {
        isDialogOpen, messageToName, templateNameInput, setTemplateNameInput,
        namingError, setNamingError, handleStarClick, handleConfirmName,
        handleCancelName, handleOpenChange,
    } = useStarMessageDialog();

    const hasActiveChat = activeChatId !== null;
    const hasMessages = messages.length > 0;

    return (
        <>
            {!hasMessages ? (
                <ChatMessagesEmpty hasActiveChat={hasActiveChat} />
            ) : (
                <ChatMessagesList onStarClick={handleStarClick} /> // Pass handler down
            )}
            <StarMessageDialog
                isOpen={isDialogOpen}
                onOpenChange={handleOpenChange}
                messageToName={messageToName}
                templateNameInput={templateNameInput}
                setTemplateNameInput={setTemplateNameInput}
                namingError={namingError}
                setNamingError={setNamingError}
                onConfirmName={handleConfirmName}
                onCancelName={handleCancelName}
            />
        </>
    );
}
