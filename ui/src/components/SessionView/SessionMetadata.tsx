import React from 'react'; // Add explicit React import
// Use standard UI components directly
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';
// Import icons
import { User, CalendarDays, Tag, BookMarked, FileText } from '../icons/Icons';
// Import constants and types
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import type { Session } from '../../types';

// Props interface
interface SessionMetadataProps {
    session: Session;
    isEditing: boolean;
    editName: string;
    editClientName: string;
    editDate: string;
    editType: string;
    editTherapy: string;
    onEditNameChange: (value: string) => void;
    onEditClientNameChange: (value: string) => void;
    onEditDateChange: (value: string) => void;
    onEditTypeChange: (value: string) => void;
    onEditTherapyChange: (value: string) => void;
}

export function SessionMetadata({
    session,
    isEditing,
    editName, editClientName, editDate, editType, editTherapy,
    onEditNameChange, onEditClientNameChange, onEditDateChange, onEditTypeChange, onEditTherapyChange
}: SessionMetadataProps) {

    // It's possible the error occurs if derivedSession is null initially.
    // Add a check, although SessionView should handle this.
    if (!session) {
        return <div className="text-gray-500 italic">Loading details...</div>; // Or null
    }

    return (
        <div className="space-y-4">
             <h2 className="text-xl font-semibold flex items-center">
                Details: 
                {isEditing ? (
                    <Input
                        value={editName}
                        onChange={(e: any) => onEditNameChange(e.target.value)}
                        placeholder="Session Name"
                        className="text-xl font-semibold h-auto inline-block w-auto ml-1 flex-grow p-0 border-0 focus-visible:ring-0 focus-visible:outline-none"
                        autoFocus
                    />
                ) : (
                    <span className="ml-1 font-semibold">{session.sessionName || session.fileName}</span>
                )}
             </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm pt-2">
                {/* Client Name */}
                <div className="flex items-center space-x-2">
                    <User className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <Label htmlFor="clientNameEditView" className="w-16 flex-shrink-0">Client:</Label>
                    {isEditing ? (
                        <Input id="clientNameEditView" value={editClientName} onChange={(e: any) => onEditClientNameChange(e.target.value)} placeholder="Client Name" className="text-sm h-8 flex-grow" />
                    ) : (<span className="font-medium">{session.clientName || 'N/A'}</span>)}
                </div>
                 {/* Date */}
                 <div className="flex items-center space-x-2">
                    <CalendarDays className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <Label htmlFor="sessionDateEditView" className="w-16 flex-shrink-0">Date:</Label>
                    {isEditing ? (
                        <Input id="sessionDateEditView" type="date" value={editDate} onChange={(e: any) => onEditDateChange(e.target.value)} className="text-sm h-8 flex-grow" />
                    ) : (<span className="font-medium">{session.date || 'N/A'}</span>)}
                </div>
                {/* Type */}
                <div className="flex items-center space-x-2">
                    <Tag className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <Label htmlFor="sessionTypeEditView" className="w-16 flex-shrink-0">Type:</Label>
                    {isEditing ? (
                        <Select id="sessionTypeEditView" value={editType} onChange={(e: any) => onEditTypeChange(e.target.value)} className="text-sm h-8 flex-grow">
                            {SESSION_TYPES.map(type => (<option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>))}
                        </Select>
                    ) : (<span className="font-medium capitalize">{session.sessionType || 'N/A'}</span>)}
                </div>
                {/* Therapy */}
                <div className="flex items-center space-x-2">
                    <BookMarked className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <Label htmlFor="therapyEditView" className="w-16 flex-shrink-0">Therapy:</Label>
                    {isEditing ? (
                        <Select id="therapyEditView" value={editTherapy} onChange={(e: any) => onEditTherapyChange(e.target.value)} className="text-sm h-8 flex-grow">
                            {THERAPY_TYPES.map(type => (<option key={type} value={type}>{type}</option>))}
                        </Select>
                    ) : (<span className="font-medium">{session.therapy || 'N/A'}</span>)}
                </div>
                {/* File Name */}
                {session.fileName && !isEditing && (
                    <div className="flex items-center space-x-2 text-xs text-gray-400 pt-1 md:col-span-2">
                        <FileText className="h-3 w-3" />
                        <span>Original file: {session.fileName}</span>
                    </div>
                )}
            </div>
        </div>
    );
}
