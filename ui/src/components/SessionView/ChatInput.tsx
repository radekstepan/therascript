import React, { useState, useRef, useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

import { Button, TextInput, Flex, Text } from '@tremor/react'; // Import Tremor components
import { Star } from '../icons/Icons'; // Keep icon
import { StarredTemplatesList } from '../StarredTemplates';
import { currentQueryAtom, isChattingAtom, activeChatIdAtom, chatErrorAtom, handleChatSubmitAtom } from '../../store';

export function ChatInput() {
    const [currentQuery, setCurrentQuery] = useAtom(currentQueryAtom);
    const isChatting = useAtomValue(isChattingAtom);
    const activeChatId = useAtomValue(activeChatIdAtom);
    const chatError = useAtomValue(chatErrorAtom);
    const handleChatSubmitAction = useSetAtom(handleChatSubmitAtom);

    const inputRef = useRef<HTMLInputElement>(null);
    const [showTemplates, setShowTemplates] = useState(false);

    // Focus input when chat ID changes (and isn't null)
    useEffect(() => {
        if (activeChatId !== null && inputRef.current) {
            inputRef.current.focus();
        }
    }, [activeChatId]);

    const handleSelectTemplate = (text: string) => {
        setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
        setShowTemplates(false);
        inputRef.current?.focus(); // Re-focus after selection
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !isChatting && currentQuery.trim() && activeChatId !== null) {
             e.preventDefault(); // Prevent default newline in case shift was held briefly
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
                <Flex className="relative space-x-2 w-full" alignItems='start'>
                    <div className="relative flex-shrink-0">
                        <Button
                            type="button"
                            variant="secondary" // Corrected variant
                            // Remove size="icon", control with classes
                            className="h-10 w-10 p-0 flex items-center justify-center" // Ensure icon is centered
                            title="Show Starred Templates"
                            onClick={() => setShowTemplates(prev => !prev)}
                            aria-label="Show starred templates"
                            icon={Star} // Use icon prop
                        />
                         {/* Removed explicit icon child */}
                        {showTemplates && (
                            <StarredTemplatesList
                                onSelectTemplate={handleSelectTemplate}
                                onClose={() => setShowTemplates(false)}
                                // Add positioning classes if needed, e.g., bottom-full, mb-2, right-0
                            />
                        )}
                    </div>
                    <TextInput
                        ref={inputRef}
                        placeholder="Ask about the session..."
                        value={currentQuery}
                        onValueChange={setCurrentQuery} // Use onValueChange
                        disabled={isChatting || activeChatId === null}
                        className="flex-grow h-10" // Ensure height matches button
                        aria-label="Chat input message"
                        onKeyDown={handleKeyDown} // Handle Enter key
                    />
                    <Button type="submit" disabled={isChatting || !currentQuery.trim() || activeChatId === null} className="h-10">
                        Send
                    </Button>
                </Flex> {/* Added missing closing tag */}
            </form>
            {chatError && (
                    <Text color="rose" className="text-sm text-center flex-shrink-0 mt-1">
                    {chatError}
                    </Text>
            )}
        </>
    );
}
