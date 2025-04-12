import React, { useState, useEffect } from 'react';
import { Button, Dialog, Flex, Text, TextField, Select, Box, Callout, Spinner } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../../constants';
import { updateSessionMetadata } from '../../../api/api';
import type { Session, SessionMetadata } from '../../../types';
import { cn } from '../../../utils';

interface EditDetailsModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    session: Session | null;
    onSaveSuccess: (updatedMetadata: Partial<SessionMetadata>) => void;
}

export function EditDetailsModal({
    isOpen,
    onOpenChange,
    session,
    onSaveSuccess
}: EditDetailsModalProps) {
    const [editClientName, setEditClientName] = useState('');
    const [editSessionName, setEditSessionName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen && session) {
            setEditClientName(session.clientName || '');
            setEditSessionName(session.sessionName || session.fileName || '');
            setEditDate(session.date || '');

            const currentSessionTypeLower = session.sessionType?.toLowerCase();
            const matchingType = SESSION_TYPES.find(typeConst => typeConst.toLowerCase() === currentSessionTypeLower);
            const initialEditType = matchingType || SESSION_TYPES[0] || '';
            setEditType(initialEditType);

            const currentTherapyTypeUpper = session.therapy?.toUpperCase();
            const matchingTherapy = THERAPY_TYPES.find(therapyConst => therapyConst.toUpperCase() === currentTherapyTypeUpper);
            const initialEditTherapy = matchingTherapy || THERAPY_TYPES[0] || '';
            setEditTherapy(initialEditTherapy);

            setValidationError(null);
            setIsSaving(false);
        } else if (!isOpen) {
             setIsSaving(false);
        }
    }, [isOpen, session]);

    const handleSave = async () => {
        if (!session || isSaving) return;

        const trimmedName = editSessionName.trim();
        const trimmedClient = editClientName.trim();

        let errors: string[] = [];
        if (!trimmedName) errors.push("Session Name");
        if (!trimmedClient) errors.push("Client Name");
        if (!editDate) errors.push("Date");
        if (!SESSION_TYPES.includes(editType)) errors.push("Session Type");
        if (!THERAPY_TYPES.includes(editTherapy)) errors.push("Therapy Type");

        if (errors.length > 0) {
             setValidationError(`Please fill in or correct the following fields: ${errors.join(', ')}`);
             return;
        }

        setValidationError(null);
        setIsSaving(true);

        const metadataToSave: Partial<SessionMetadata> = {
            clientName: trimmedClient,
            sessionName: trimmedName,
            date: editDate,
            sessionType: editType,
            therapy: editTherapy,
        };

        try {
            const backendResponse = await updateSessionMetadata(session.id, metadataToSave);
            console.log('[EditModal] Save successful (API Response):', backendResponse);

            onSaveSuccess(metadataToSave);

            onOpenChange(false);

        } catch (err) {
            console.error('[EditModal] Save failed:', err);
            setValidationError('Failed to update session metadata. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleManualClose = (open: boolean) => {
        if (!open && isSaving) {
             console.log("[EditModal] Attempted to close while saving.");
             return;
        }
        if (!open) {
            setValidationError(null);
        }
        onOpenChange(open);
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 525 }}>
                <Dialog.Title>Edit Session Details</Dialog.Title>
                <Flex direction="column" gap="4" py="4">
                    <Box className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                        <Text as="label" size="2" weight="medium" htmlFor="sessionNameEditModal" className="text-right">Session Name</Text>
                        <TextField.Root id="sessionNameEditModal" size="2" value={editSessionName} onChange={(e) => setEditSessionName(e.target.value)} placeholder="e.g., Weekly Check-in" required aria-required="true" disabled={isSaving}/>
                        <Text as="label" size="2" weight="medium" htmlFor="clientNameEditModal" className="text-right">Client Name</Text>
                        <TextField.Root id="clientNameEditModal" size="2" value={editClientName} onChange={(e) => setEditClientName(e.target.value)} placeholder="Client's Full Name" required aria-required="true" disabled={isSaving}/>
                        <Text as="label" size="2" weight="medium" htmlFor="sessionDateEditModal" className="text-right">Date</Text>
                        <input id="sessionDateEditModal" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} required aria-required="true" disabled={isSaving} className={cn( "rt-TextFieldInput rt-r-size-2 rt-variant-surface", "h-8 text-sm px-2 py-1" )} style={{ lineHeight: 'normal' }}/>
                        <Text as="label" size="2" weight="medium" htmlFor="sessionTypeEditModal" className="text-right">Session Type</Text>
                        <Select.Root value={editType} onValueChange={setEditType} required size="2" name="sessionType" disabled={isSaving}>
                            <Select.Trigger id="sessionTypeEditModal" placeholder="Select type..." />
                            <Select.Content>
                                {SESSION_TYPES.map((type) => (<Select.Item key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</Select.Item>))}
                            </Select.Content>
                        </Select.Root>
                        <Text as="label" size="2" weight="medium" htmlFor="therapyTypeEditModal" className="text-right">Therapy Type</Text>
                        <Select.Root value={editTherapy} onValueChange={setEditTherapy} required size="2" name="therapyType" disabled={isSaving}>
                            <Select.Trigger id="therapyTypeEditModal" placeholder="Select therapy..." />
                            <Select.Content>
                                {THERAPY_TYPES.map((type) => (<Select.Item key={type} value={type}>{type}</Select.Item>))}
                            </Select.Content>
                        </Select.Root>
                    </Box>
                    {validationError && ( <Callout.Root color="red" role="alert" size="1" mt="2"> <Callout.Icon><InfoCircledIcon /></Callout.Icon> <Callout.Text>{validationError}</Callout.Text> </Callout.Root> )}
                </Flex>
                <Flex gap="3" mt="4" justify="end">
                    <Dialog.Close>
                        <Button type="button" variant="soft" color="gray" disabled={isSaving}>Cancel</Button>
                    </Dialog.Close>
                    <Button type="button" onClick={handleSave} disabled={isSaving}>
                         {isSaving && <Spinner size="2" />}
                         <Text ml={isSaving ? "2" : "0"}>
                            {isSaving ? 'Saving...' : 'Save Changes'}
                         </Text>
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
