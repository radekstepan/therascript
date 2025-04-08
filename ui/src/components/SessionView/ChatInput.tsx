import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { StarIcon } from '@radix-ui/react-icons';
import { Button } from '../ui/Button'; // Use new Button
import { Input } from '../ui/Input'; // Use new Input
import { StarredTemplatesList } from '../StarredTemplates';
import { currentQueryAtom, isChattingAtom, activeChatIdAtom, chatErrorAtom, handleChatSubmitAtom } from '../../store';
import { cn } from '../../utils'; // Import cn

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatError = useAtomValue(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    useEffect(() => {
        if (activeChatId !== null && inputRef.current) {
            inputRef.current.focus();
        }
    }, [activeChatId]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !isChatting && currentQuery.trim() && activeChatId !== null) {
             e.preventDefault();
             handleChatSubmitAction();
        }
    };

    const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        handleChatSubmitAction();
    };

    return (
        <>
            <form onSubmit={onSubmit} className="flex-shrink-0 pt-2">
                <div className="relative flex items-start space-x-2 w-full"> {/* Use div + flex */}
                    <div className="relative flex-shrink-0">
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon" // Use icon size
                            title="Show Starred Templates"
                            onClick={() => setShowTemplates(prev => !prev)}
                            aria-label="Show starred templates"
                            // Pass icon component directly
                        >
                          <StarIcon width={16} height={16} />
                        </Button>
                        {showTemplates && (
                            <StarredTemplatesList
                                onSelectTemplate={handleSelectTemplate}
                                onClose={() => setShowTemplates(false)}
                                // Positioning is handled inside StarredTemplatesList now
                            />
                        )}
                    </div>
                    <Input
                        ref={inputRef}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onChange={(e) => setCurrentQuery(e.target.value)} // Use standard onChange
                        disabled={isChatting || activeChatId === null}
                        className="flex-grow h-10" // Ensure height matches button
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown}
                    />
                    <Button type="submit" disabled={isChatting || !currentQuery.trim() || activeChatId === null} className="h-10">
                        Send
                    </Button>
                </div>
            </form>
            {chatError && (
                    // Use standard p element for error text
                    <p className={cn("text-sm text-center flex-shrink-0 mt-1", "text-red-600 dark:text-red-500")}>
                        {chatError}
                    </p>
            )}
        </>
    );
}
