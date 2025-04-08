import React from 'react';
import { useAtomValue } from 'jotai';

import { Button, Card, Text, Divider, Flex } from '@tremor/react'; // Import Tremor components
import { starredMessagesAtom } from '../store'; // Keep atom
import type { StarredTemplatesProps } from '../types';

// Interface for props remains the same
interface StarredTemplatesDisplayProps {
    onSelectTemplate: (text: string) => void;
    onClose: () => void;
}

export function StarredTemplatesList({ onSelectTemplate, onClose }: StarredTemplatesDisplayProps) {
    const starredMessages = useAtomValue(starredMessagesAtom);

    // Use Tremor Card for the popover appearance
    // Positioning needs to be handled by the parent or wrapper div
    const popoverPositionClasses = "absolute bottom-full mb-2 right-0 z-10"; // Keep positioning separate

    if (!starredMessages || starredMessages.length === 0) {
        return (
            <Card className={`${popoverPositionClasses} w-72 max-h-60 p-4 text-center`}>
                 <Text className="text-tremor-content-subtle">
                    No starred messages yet.
                 </Text>
                 {/* Position close button inside the card */}
                 <Button variant="light" size="xs" onClick={onClose} className="!absolute top-1.5 right-1.5">
                    Close
                </Button>
             </Card>
        );
    }

    return (
        <Card className={`${popoverPositionClasses} w-72 max-h-60 p-0 overflow-hidden flex flex-col`}> {/* Remove padding, add flex */}
             <Flex justifyContent='end' className="p-1.5 flex-shrink-0"> {/* Put button in a flex header */}
                 <Button variant="light" size="xs" onClick={onClose}>
                 Close
             </Button>
             </Flex>
             <Divider className="my-0 flex-shrink-0" />
             {/* Scrollable list area */}
             <div className="overflow-y-auto p-1 flex-grow">
                {starredMessages.map(msg => (
                    <div key={msg.id} className="block w-full"> {/* Use div or Button */}
                        <Button
                            variant="secondary" // Use Tremor variants
                            onClick={() => onSelectTemplate(msg.text)}
                            className="block w-full text-left p-2 text-sm text-gray-700 hover:bg-gray-100 rounded whitespace-normal"
                            title="Insert this template"
                         >
                            {msg.text}
                        </Button>
                        {/* Or use a styled div if button interaction isn't perfect */}
                        {/* <div onClick={() => onSelectTemplate(msg.text)} className="w-full text-left p-2 text-tremor-default text-tremor-content hover:bg-tremor-background-muted rounded-tremor-small cursor-pointer whitespace-normal"> {msg.text} </div> */}
                    </div>
                ))}
            </div>
        </Card>
    );
}
