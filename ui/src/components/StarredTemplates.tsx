import React from 'react';
import { useAtomValue } from 'jotai';
import { Button } from './ui/Button'; // Import new Button
import { starredMessagesAtom } from '../store';
import type { StarredTemplatesProps } from '../types';
import { cn } from '../utils'; // Import cn

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesProps) {
    const starredMessages = useAtomValue(starredMessagesAtom);

    // Use Tailwind classes for positioning and appearance
    const popoverClasses = cn(
        "absolute bottom-full mb-2 right-0 z-10", // Positioning
        "w-72 max-h-60 overflow-hidden flex flex-col", // Size, layout
        "rounded-md border bg-white dark:bg-gray-900 shadow-lg" // Appearance (like Card)
    );

    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className={cn(popoverClasses, "p-4 text-center")}> {/* Add padding for empty state */}
                 <p className="text-sm text-gray-500 dark:text-gray-400"> {/* Use p */}
                    No starred messages yet.
                 </p>
                 <Button variant="ghost" size="sm" onClick={onClose} className="!absolute top-1.5 right-1.5 text-xs"> {/* Style close button */}
                    Close
                </Button>
             </div>
        );
    }

    return (
        <div className={popoverClasses}> {/* Main container div */}
             {/* Header with close button */}
             <div className="flex justify-end p-1.5 flex-shrink-0 border-b dark:border-gray-700"> {/* Use div + flex */}
                 <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-auto"> {/* Style close button */}
                    Close
                </Button>
             </div>
             {/* Scrollable list area */}
             <div className="overflow-y-auto p-1 flex-grow">
                {starredMessages.map(msg => (
                    <div key={msg.id} className="block w-full">
                        <Button
                            variant="ghost" // Use ghost variant for list items
                            onClick={() => onSelectTemplate(msg.text)}
                            className="block w-full h-auto text-left p-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded whitespace-normal justify-start" // Adjusted style
                            title="Insert this template"
                         >
                            {msg.text}
                        </Button>
                    </div>
                ))}
            </div>
        </div>
    );
}
