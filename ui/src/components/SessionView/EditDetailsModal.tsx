// src/components/SessionView/EditDetailsModal.tsx
import React, { useState, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import { updateSessionMetadataAtom } from '../../store';
import type { Session } from '../../types';

interface EditDetailsModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    session: Session | null; // Pass the whole session for context
}

export function EditDetailsModal({ isOpen, onOpenChange, session }: EditDetailsModalProps) {
    const updateMetadataAction = useSetAtom(updateSessionMetadataAtom);

    // Local state for the form fields within the modal
    const [editClientName, setEditClientName] = useState('');
    const [editSessionName, setEditSessionName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    // Initialize form state when the modal opens or the session changes
    useEffect(() => {
        if (isOpen && session) {
            setEditClientName(session.clientName || '');
            setEditSessionName(session.sessionName || session.fileName || '');
            setEditDate(session.date || '');
            setEditType(session.sessionType || SESSION_TYPES[0]); // Default if undefined
            setEditTherapy(session.therapy || THERAPY_TYPES[0]);   // Default if undefined
            setValidationError(null); // Clear validation error on open
        }
    }, [isOpen, session]);

    const handleSave = () => {
        if (!session) return;

        const trimmedName = editSessionName.trim();
        const trimmedClient = editClientName.trim();

        if (!trimmedName || !trimmedClient || !editDate) {
            setValidationError("Please ensure Session Name, Client Name, and Date are filled.");
            return; // Keep modal open if validation fails
        }

        updateMetadataAction({
            sessionId: session.id,
            metadata: { // Pass only the updatable metadata fields
                clientName: trimmedClient,
                sessionName: trimmedName,
                date: editDate,
                sessionType: editType,
                therapy: editTherapy,
            }
        });
        setValidationError(null);
        onOpenChange(false); // Close modal on success
    };

     // Close handler resets error if modal is closed manually
     const handleManualClose = (open: boolean) => {
         if (!open) {
             setValidationError(null);
         }
         onOpenChange(open);
     }

    return (
        <Dialog open={isOpen} onOpenChange={handleManualClose}>
            <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                    <DialogTitle>Edit Session Details</DialogTitle>
                    {/* Optional: <DialogDescription>Update the metadata for this session.</DialogDescription> */}
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    {/* Session Name */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sessionNameEditModal" className="text-right">Session Name</Label>
                        <Input id="sessionNameEditModal" value={editSessionName} onChange={(e) => setEditSessionName(e.target.value)} className="col-span-3" placeholder="e.g., Weekly Check-in" required />
                    </div>
                    {/* Client Name */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="clientNameEditModal" className="text-right">Client Name</Label>
                        <Input id="clientNameEditModal" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} className="col-span-3" placeholder="Client's Full Name" required />
                    </div>
                    {/* Date */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sessionDateEditModal" className="text-right">Date</Label>
                        {/* Use standard HTML date input, styled via global.css */}
                        <input
                            id="sessionDateEditModal"
                            type="date"
                            value={editDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditDate(e.target.value)}
                            required
                            className="col-span-3" // Apply Tailwind classes directly
                        />
                    </div>
                    {/* Session Type */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="sessionTypeEditModal" className="text-right">Session Type</Label>
                        <Select value={editType} onValueChange={setEditType}>
                            <SelectTrigger id="sessionTypeEditModal" className="col-span-3">
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {SESSION_TYPES.map(type => (
                                    <SelectItem key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {/* Therapy Type */}
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="therapyTypeEditModal" className="text-right">Therapy Type</Label>
                        <Select value={editTherapy} onValueChange={setEditTherapy}>
                            <SelectTrigger id="therapyTypeEditModal" className="col-span-3">
                                <SelectValue placeholder="Select therapy..." />
                            </SelectTrigger>
                            <SelectContent>
                                {THERAPY_TYPES.map(type => (<SelectItem key={type} value={type}>{type}</SelectItem>))}
                            </SelectContent>
                        </Select>
                    </div>
                     {/* Validation Error */}
                    {validationError && (
                         <p className="col-span-4 text-sm text-red-600 dark:text-red-500 text-center px-2">{validationError}</p>
                    )}
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                        <Button type="button" variant="secondary">Cancel</Button>
                    </DialogClose>
                    <Button type="button" onClick={handleSave}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
