import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Button } from './ui/Button';
import { starredMessagesAtom, currentQueryAtom } from '../store'; // Import atoms
import type { StarredTemplatesProps } from '../types'; // Keep onClose prop type

// Define props for the parts that remain props
interface StarredTemplatesDisplayProps {
    onSelectTemplate: (text: string) => void; // Keep this as it modifies SessionView's local state indirectly
    onClose: () => void;
}

// Modify the props definition
export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesDisplayProps) {
    // Read starred messages directly from the atom
    const starredMessages = useAtomValue(starredMessagesAtom);
    // Get setter for query atom if needed directly (alternative)
    // const setCurrentQuery = useSetAtom(currentQueryAtom);

    // const handleSelect = (text: string) => {
    //    setCurrentQuery(prev => prev ? `${prev} ${text}` : text);
    //    onClose(); // Close after selection
    // }

    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg p-2 text-sm text-gray-500 text-center z-10">
                No starred messages yet.
                <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1 right-1 text-xs p-1 h-auto">
                    Close
                </Button>
            </div>
        );
    }

    return (
        <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg z-10">
            <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1 right-1 text-xs p-1 h-auto">
                 Close
             </Button>
            <ul className="space-y-1 p-1">
                {starredMessages.map(msg => (
                    <li key={msg.id}>
                        <button
                            // Use the passed onSelectTemplate prop which updates SessionView's query atom state
                            onClick={() => onSelectTemplate(msg.text)}
                            // OR use handleSelect if you want to update the atom directly from here
                            // onClick={() => handleSelect(msg.text)}
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
