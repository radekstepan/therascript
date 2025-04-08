import React from 'react'; // Add explicit React import

import { TextInput, Select, SelectItem, DateRangePicker, Grid, Col, Text, Title } from '@tremor/react'; // Import Tremor components
// Import icons
import { User, CalendarDays, Tag, BookMarked, FileText } from '../icons/Icons'; // Keep icons
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
        return <Text className="italic text-tremor-content-subtle">Loading details...</Text>; // Use Tremor Text
    }

    return (
        <div className="space-y-4">
             {/* Use Title or Text for the main heading */}
             {/* <Title className="flex items-center"> */}
             <Text className="text-xl font-semibold flex items-center text-tremor-content-strong">
                Details: 
                {isEditing ? (
                    <TextInput
                        value={editName}
                        onValueChange={onEditNameChange} // Use onValueChange
                        placeholder="Session Name"
                        // Use Tailwind/Tremor classes for styling instead of complex inline styles
                        className="text-lg font-semibold h-9 inline-block w-auto ml-1 flex-grow p-1" // Adjusted classes
                        autoFocus
                    />
                ) : (
                    <span className="ml-1 font-normal">{session.sessionName || session.fileName}</span> // Use font-normal to contrast with label
                )}
             </Text>
             {/* </Title> */}

             {/* Use Tremor Grid for layout */}
             <Grid numItemsSm={1} numItemsMd={2} className="gap-x-6 gap-y-4 text-tremor-default pt-4">
                {/* Client Name */}
                <Col>
                    <label htmlFor="clientNameEditView" className="text-tremor-default font-medium text-tremor-content-strong block mb-1">
                        <User className="inline-block h-4 w-4 mr-1 align-text-bottom text-tremor-content-subtle" aria-hidden="true"/> Client
                    </label>
                    {isEditing ? (
                        <TextInput id="clientNameEditView" value={editClientName} onValueChange={onEditClientNameChange} placeholder="Client Name" />
                    ) : (<Text>{session.clientName || 'N/A'}</Text>)}
                </Col>

                 {/* Date */}
                 <Col>
                    <label htmlFor="sessionDateEditView" className="text-tremor-default font-medium text-tremor-content-strong block mb-1">
                         <CalendarDays className="inline-block h-4 w-4 mr-1 align-text-bottom text-tremor-content-subtle" aria-hidden="true"/> Date
                    </label>
                    {isEditing ? (
                         // *** CORRECTED JSX SYNTAX FOR INPUT ***
                        <input
                            id="sessionDateEditView"
                            type="date"
                            value={editDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onEditDateChange(e.target.value)}
                            disabled={false} // Assuming you want it enabled during edit
                            required
                            className="block w-full rounded-tremor-default border border-tremor-border bg-tremor-background px-3 py-2 text-tremor-default text-tremor-content shadow-tremor-input focus:outline-none focus:ring-2 focus:ring-tremor-brand focus:border-tremor-brand disabled:opacity-50 disabled:cursor-not-allowed"
                         />
                         // *** END CORRECTION ***
                    ) : (
                        <Text>{session.date || 'N/A'}</Text>
                    )}
                </Col>

                {/* Type */}
                <Col>
                    <label htmlFor="sessionTypeEditView" className="text-tremor-default font-medium text-tremor-content-strong block mb-1">
                         <Tag className="inline-block h-4 w-4 mr-1 align-text-bottom text-tremor-content-subtle" aria-hidden="true"/> Type
                    </label>
                    {isEditing ? (
                        <Select id="sessionTypeEditView" value={editType} onValueChange={onEditTypeChange}>
                            {SESSION_TYPES.map(type => (
                                <SelectItem key={type} value={type}>
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </SelectItem>
                            ))}
                        </Select>
                    ) : (<Text className="capitalize">{session.sessionType || 'N/A'}</Text>)}
                </Col>

                {/* Therapy */}
                <Col>
                    <label htmlFor="therapyEditView" className="text-tremor-default font-medium text-tremor-content-strong block mb-1">
                        <BookMarked className="inline-block h-4 w-4 mr-1 align-text-bottom text-tremor-content-subtle" aria-hidden="true"/> Therapy
                    </label>
                    {isEditing ? (
                        <Select id="therapyEditView" value={editTherapy} onValueChange={onEditTherapyChange}>
                            {THERAPY_TYPES.map(type => (
                                <SelectItem key={type} value={type}>{type}</SelectItem>
                            ))}
                        </Select>
                    ) : (<Text>{session.therapy || 'N/A'}</Text>)}
                </Col>

                {/* File Name */}
                {session.fileName && !isEditing && (
                    <Col numColSpanSm={1} numColSpanMd={2}>
                         <Text className="text-tremor-content-subtle text-xs pt-2 flex items-center">
                             <FileText className="h-3 w-3 mr-1" aria-hidden="true" /> Original file: {session.fileName}
                         </Text>
                    </Col>
                )}
            </Grid>
        </div>
    );
}
