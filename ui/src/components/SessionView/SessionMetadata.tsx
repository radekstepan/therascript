// src/components/SessionView/SessionMetadata.tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';
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

    return (
        <Card className="flex-shrink-0">
            <CardHeader className="border-b">
                <CardTitle className="flex items-center">
                    Details: 
                    {isEditing ? (
                        <Input
                            value={editName}
                            onChange={(e: any) => onEditNameChange(e.target.value)}
                            placeholder="Session Name"
                            className="text-lg font-semibold leading-none tracking-tight h-9 inline-block w-auto ml-1 flex-grow"
                        />
                    ) : (
                        <span className="ml-1">{session.sessionName || session.fileName}</span>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 pt-4 text-sm">
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
            </CardContent>
        </Card>
    );
}
