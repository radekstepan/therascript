import React from 'react';
import { useAtomValue } from 'jotai';
import { Button } from './ui/Button'; // Import new Button
import { starredMessagesAtom } from '../store'; // Atom now includes starredName
import { StarIcon } from '@radix-ui/react-icons'; // Can be used for visual cue if needed
import type { StarredTemplatesProps } from '../types';
import { cn } from '../utils'; // Import cn

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    // starredMessages now contains { id, text, starredName? }
    const starredMessages = useAtomValue(starredMessagesAtom);

    const popoverClasses = cn(
        "absolute bottom-full mb-2 right-0 z-10",
        "w-72 max-h-60 overflow-hidden flex flex-col",
        "rounded-md border bg-white dark:bg-gray-900 shadow-lg"
    );

    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className={cn(popoverClasses, "p-4 text-center")}>
                 <p className="text-sm text-gray-500 dark:text-gray-400">
                    No starred messages yet. Star a message to create a template.
                 </p>
                 <Button variant="ghost" size="sm" onClick={onClose} className="!absolute top-1.5 right-1.5 text-xs h-auto px-1 py-0.5"> {/* Adjusted Close Button */}
                    Close
                </Button>
             </div>
        );
    }

    return (
        <div className={popoverClasses}>
             <div className="flex justify-between items-center p-1.5 flex-shrink-0 border-b dark:border-gray-700">
                 <span className="text-xs font-medium text-gray-600 dark:text-gray-400 px-1">Starred Templates</span>
                 <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-auto px-1 py-0.5">
                    Close
                </Button>
             </div>
             <div className="overflow-y-auto p-1 flex-grow">
                {starredMessages.map(msg => {
                    // Display name if it exists, otherwise fallback to a snippet of the original text
                    const displayName = msg.starredName || (msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : ''));

                    return (
                        <div key={msg.id} className="block w-full">
                            <Button
                                variant="ghost"
                                // Pass the original text to the handler
                                onClick={() => onSelectTemplate(msg.text)}
                                className="block w-full h-auto text-left p-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded whitespace-normal justify-start"
                                // Use the original text for the tooltip (title)
                                title={`Insert: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`}
                             >
                                {/* Display the name or snippet */}
                                {displayName}
                            </Button>
                        </div>
                    );
                 })}
            </div>
        </div>
    );
}
