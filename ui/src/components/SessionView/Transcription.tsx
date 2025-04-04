import React from 'react'; // Add explicit React import
// Use standard UI components
import { Textarea } from '../ui/Textarea';
import { ScrollArea } from '../ui/ScrollArea';
// Import types
import type { Session } from '../../types';

// Props interface
interface TranscriptionProps {
    session: Session;
    isEditing: boolean;
    editTranscriptContent: string;
    onContentChange: (value: string) => void;
    onEditToggle: () => void; // Keep props from parent
    onSave: () => void;       // Keep props from parent
}

export function Transcription({
    session,
    isEditing,
    editTranscriptContent,
    onContentChange,
    // onEditToggle and onSave are passed but not directly used here
    // The buttons controlling them are in the parent SessionView
}: TranscriptionProps) {

    // Add check for session prop
     if (!session) {
        return <div className="text-gray-500 italic">Loading transcript...</div>; // Or null
    }

    return (
        <div className="flex-grow flex flex-col min-h-0 space-y-4">
             <h2 className="text-xl font-semibold flex-shrink-0">Transcription</h2>
            <div className="flex-grow flex flex-col min-h-0">
                {isEditing ? (
                    <Textarea
                        value={editTranscriptContent}
                        onChange={(e: any) => onContentChange(e.target.value)}
                        className="flex-grow w-full whitespace-pre-wrap text-sm font-mono border border-gray-300 rounded-md p-3"
                        placeholder="Enter or paste transcription here..."
                        autoFocus
                    />
                ) : (
                    <ScrollArea className="flex-grow border rounded-md">
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 p-3 font-mono">
                            {session.transcription || <span className="italic text-gray-500">No transcription available.</span>}
                        </pre>
                    </ScrollArea>
                )}
            </div>
        </div>
    );
}
