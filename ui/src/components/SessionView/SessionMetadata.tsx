import React from 'react';
import { Input } from '../ui/Input'; // Import new Input
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'; // Import new Select
import { Label } from '../ui/Label'; // Import new Label
import { User, CalendarDays, Tag, BookMarked, FileText } from '../icons/Icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import type { Session } from '../../types';

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

    if (!session) {
        return <p className="italic text-gray-500 dark:text-gray-400">Loading details...</p>; // Use p
    }

    return (
        <div className="space-y-4">
             {/* Use standard heading or span */}
             <h4 className="text-lg font-semibold flex items-center text-gray-800 dark:text-gray-200"> {/* Adjusted size */}
                Details:
                {isEditing ? (
                    <Input
                        value={editName}
                        onChange={(e) => onEditNameChange(e.target.value)} // Use standard onChange
                        placeholder="Session Name"
                        className="text-lg font-semibold h-9 inline-block w-auto ml-1 flex-grow p-1" // Adjusted classes
                        autoFocus
                    />
                ) : (
                    <span className="ml-1 font-normal text-gray-700 dark:text-gray-300">{session.sessionName || session.fileName}</span>
                )}
             </h4>

             {/* Use Tailwind Grid */}
             <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm pt-4"> {/* Use text-sm */}
                {/* Client Name */}
                <div>
                    {/* Use new Label */}
                    <Label htmlFor="clientNameEditView" className="font-medium text-gray-800 dark:text-gray-200 block mb-1">
                        <User className="inline-block h-4 w-4 mr-1 align-text-bottom text-gray-400 dark:text-gray-500" aria-hidden="true"/> Client
                    </Label>
                    {isEditing ? (
                        <Input id="clientNameEditView" value={editClientName} onChange={(e) => onEditClientNameChange(e.target.value)} placeholder="Client Name" />
                    ) : (<p className="text-gray-700 dark:text-gray-300 mt-1">{session.clientName || 'N/A'}</p>)} {/* Use p */}
                </div>

                 {/* Date */}
                 <div>
                    <Label htmlFor="sessionDateEditView" className="font-medium text-gray-800 dark:text-gray-200 block mb-1">
                         <CalendarDays className="inline-block h-4 w-4 mr-1 align-text-bottom text-gray-400 dark:text-gray-500" aria-hidden="true"/> Date
                    </Label>
                    {isEditing ? (
                        // Use standard HTML input type="date" with Tailwind styling from global.css
                        <input
                            id="sessionDateEditView"
                            type="date"
                            value={editDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onEditDateChange(e.target.value)}
                            disabled={false}
                            required
                            // className is applied via @layer base in global.css
                         />
                    ) : (
                        <p className="text-gray-700 dark:text-gray-300 mt-1">{session.date || 'N/A'}</p> // Use p
                    )}
                </div>

                {/* Type */}
                <div>
                    <Label htmlFor="sessionTypeEditView" className="font-medium text-gray-800 dark:text-gray-200 block mb-1">
                         <Tag className="inline-block h-4 w-4 mr-1 align-text-bottom text-gray-400 dark:text-gray-500" aria-hidden="true"/> Type
                    </Label>
                    {isEditing ? (
                        // Use new Select component
                        <Select value={editType} onValueChange={onEditTypeChange}>
                            <SelectTrigger id="sessionTypeEditView">
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {SESSION_TYPES.map(type => (
                                    <SelectItem key={type} value={type}>
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (<p className="capitalize text-gray-700 dark:text-gray-300 mt-1">{session.sessionType || 'N/A'}</p>)} {/* Use p */}
                </div>

                {/* Therapy */}
                <div>
                    <Label htmlFor="therapyEditView" className="font-medium text-gray-800 dark:text-gray-200 block mb-1">
                        <BookMarked className="inline-block h-4 w-4 mr-1 align-text-bottom text-gray-400 dark:text-gray-500" aria-hidden="true"/> Therapy
                    </Label>
                    {isEditing ? (
                        // Use new Select component
                        <Select value={editTherapy} onValueChange={onEditTherapyChange}>
                             <SelectTrigger id="therapyEditView">
                                <SelectValue placeholder="Select therapy..." />
                            </SelectTrigger>
                            <SelectContent>
                                {THERAPY_TYPES.map(type => (
                                    <SelectItem key={type} value={type}>{type}</SelectItem>
                                ))}
                             </SelectContent>
                        </Select>
                    ) : (<p className="text-gray-700 dark:text-gray-300 mt-1">{session.therapy || 'N/A'}</p>)} {/* Use p */}
                </div>

                {/* File Name */}
                {session.fileName && !isEditing && (
                    <div className="md:col-span-2"> {/* Use Tailwind grid span */}
                         <p className="text-gray-500 dark:text-gray-400 text-xs pt-2 flex items-center"> {/* Use p */}
                             <FileText className="h-3 w-3 mr-1" aria-hidden="true" /> Original file: {session.fileName}
                         </p>
                    </div>
                )}
            </div>
        </div>
    );
}
