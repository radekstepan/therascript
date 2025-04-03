import React from 'react';
import { Button } from './ui/Button'; // Use Button from ui folder
import type { StarredTemplatesProps } from '../types'; // Import the specific props type

// Renamed function slightly for clarity
export function StarredTemplatesList({ starredMessages, onSelectTemplate, onClose }: StarredTemplatesProps) {
    if (!starredMessages || starredMessages.length === 0) {
        return (
            <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg p-2 text-sm text-gray-500 text-center z-10">
                No starred messages yet.
                {/* Use UI Button component for consistency */}
                <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1 right-1 text-xs p-1 h-auto">
                    Close
                </Button>
            </div>
        );
    }

    return (
        <div className="absolute bottom-full mb-2 w-72 max-h-60 overflow-y-auto right-0 bg-white border border-gray-300 rounded-md shadow-lg z-10">
            {/* Use UI Button component */}
            <Button variant="ghost" size="sm" onClick={onClose} className="absolute top-1 right-1 text-xs p-1 h-auto">
                 Close
             </Button>
            <ul className="space-y-1 p-1">
                {starredMessages.map(msg => (
                    <li key={msg.id}>
                         {/* Use a standard button for list items */}
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
