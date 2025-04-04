// src/components/SessionView/ChatInput.tsx
import React, { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Star } from '../icons/Icons';
import { StarredTemplatesList } from '../StarredTemplates';
import { currentQueryAtom, isChattingAtom, activeChatIdAtom, chatErrorAtom, handleChatSubmitAtom } from '../../store';

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatError = useAtomValue(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);

    const [showTemplates, setShowTemplates] = useState(false);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
    };

    const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleChatSubmitAction();
    };

    return (
        <>
            <form onSubmit={onSubmit} className="relative flex space-x-2 flex-shrink-0 pt-2 border-t">
                <div className="relative">
                    <Button
                        type="button" variant="outline" size="icon"
                        className="h-10 w-10 flex-shrink-0"
                        title="Show Starred Templates"
                        onClick={() => setShowTemplates(prev => !prev)}
                        aria-label="Show starred templates"
                    >
                        <Star size={18} />
                    </Button>
                    {showTemplates && (
                        <StarredTemplatesList
                            onSelectTemplate={handleSelectTemplate}
                            onClose={() => setShowTemplates(false)}
                        />
                    )}
                </div>
                <Input
                    type="text"
                    placeholder="Ask about the session..."
                    value={currentQuery}
                    onChange={(e: any) => setCurrentQuery(e.target.value)}
                    disabled={isChatting || activeChatId === null}
                    className="flex-grow"
                    aria-label="Chat input message"
                />
                <Button type="submit" disabled={isChatting || !currentQuery.trim() || activeChatId === null}>
                    Send
                </Button>
            </form>
            {chatError && (
                <p className="text-sm text-red-600 text-center flex-shrink-0 mt-1">
                    {chatError}
                </p>
            )}
        </>
    );
}
