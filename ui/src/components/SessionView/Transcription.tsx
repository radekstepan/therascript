import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { ScrollArea } from '../ui/ScrollArea';
import { Edit, Save } from '../icons/Icons';
import type { Session } from '../../types';

interface TranscriptionProps {
    session: Session;
    isEditing: boolean;
    editTranscriptContent: string;
    onEditToggle: () => void;
    onSave: () => void;
    onContentChange: (value: string) => void;
}

export function Transcription({
    session,
    isEditing,
    editTranscriptContent,
    onEditToggle,
    onSave,
    onContentChange
}: TranscriptionProps) {

    return (
        <Card className="flex-grow flex flex-col min-h-0">
             {/* 6. Remove border-b */}
            <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between">
                <CardTitle>Transcription</CardTitle>
                <div className="space-x-2">
                    {!isEditing ? (
                        <Button onClick={onEditToggle} variant="outline" size="sm"><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                    ) : (
                        <>
                            <Button onClick={onSave} variant="default" size="sm"><Save className="mr-2 h-4 w-4" /> Save</Button>
                            <Button onClick={onEditToggle} variant="secondary" size="sm">Cancel</Button>
                        </>
                    )}
                </div>
            </CardHeader>
             {/* Add border manually if needed between header and content */}
             <hr className="border-gray-200" />
            <CardContent className="flex-grow pt-4 flex flex-col min-h-0">
                {isEditing ? (
                    <Textarea
                        value={editTranscriptContent}
                        onChange={(e: any) => onContentChange(e.target.value)}
                        className="flex-grow w-full whitespace-pre-wrap text-sm font-mono"
                        placeholder="Enter or paste transcription here..."
                    />
                ) : (
                    <ScrollArea className="flex-grow border rounded-md">
                        <pre className="whitespace-pre-wrap text-sm text-gray-700 p-3 font-mono">
                            {session.transcription || <span className="italic text-gray-500">No transcription available.</span>}
                        </pre>
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
