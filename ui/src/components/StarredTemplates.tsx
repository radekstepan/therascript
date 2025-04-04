import React from 'react';
import { useAtomValue } from 'jotai';
import { Button } from './ui/Button';
import { starredMessagesAtom } from '../store';
import type { StarredTemplatesProps } from '../types';

// Interface for props remains the same
interface StarredTemplatesDisplayProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesDisplayProps) {
    const starredMessages = useAtomValue(starredMessagesAtom);

    const popoverBaseClasses = "absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg z-10";

    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className={`${popoverBaseClasses} p-4 text-sm text-gray-500 text-center`}> {/* Increased padding */}
                No starred messages yet.
                 {/* 9. Adjust close button position slightly if needed */}
                <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1.5 right-1.5 text-xs p-1 h-auto"> {/* Use p-1.5 */}
                    Close
                </Button>
            </div>
        );
    }

    return (
        <div className={popoverBaseClasses}>
             {/* 9. Adjust close button position slightly if needed */}
            <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1.5 right-1.5 text-xs p-1 h-auto"> {/* Use p-1.5 */}
                 Close
             </Button>
             {/* 8. Add list-none */}
            <ul className="space-y-1 p-1 list-none mt-6"> {/* Add margin-top to avoid overlap */}
                {starredMessages.map(msg => (
                    <li key={msg.id}>
                        <button
                            onClick={() => onSelectTemplate(msg.text)}
                            className="block w-full text-left p-2 text-sm text-gray-700 hover:bg-gray-100 rounded whitespace-normal"
                            title="Insert this template"
                         >
                            {msg.text}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
