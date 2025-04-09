import React, { useState, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { Button, Dialog, Flex, Text, TextField, Select, Box, Heading, Callout } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants'; // Corrected path check
import { updateSessionMetadataAtom } from '../../store'; // Corrected path check
import type { Session } from '../../types'; // Corrected path check

interface EditDetailsModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    session: Session | null;
}

export function EditDetailsModal({ isOpen, onOpenChange, session }: EditDetailsModalProps) {
    const updateMetadataAction = useSetAtom(updateSessionMetadataAtom);
    const [editClientName, setEditClientName] = useState('');
    const [editSessionName, setEditSessionName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState('');
    const [editTherapy, setEditTherapy] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && session) {
            setEditClientName(session.clientName || '');
            setEditSessionName(session.sessionName || session.fileName || '');
            setEditDate(session.date || '');
            setEditType(session.sessionType || SESSION_TYPES[0]);
            setEditTherapy(session.therapy || THERAPY_TYPES[0]);
            setValidationError(null);
        }
    }, [isOpen, session]);

    const handleSave = () => {
        if (!session) return;
        const trimmedName = editSessionName.trim();
        const trimmedClient = editClientName.trim();
        if (!trimmedName || !trimmedClient || !editDate) {
            setValidationError("Please ensure Session Name, Client Name, and Date are filled.");
            return;
        }
        updateMetadataAction({
            sessionId: session.id,
            metadata: { clientName: trimmedClient, sessionName: trimmedName, date: editDate, sessionType: editType, therapy: editTherapy }
        });
        setValidationError(null);
        onOpenChange(false);
    };

    const handleManualClose = (open: boolean) => {
        if (!open) setValidationError(null);
        onOpenChange(open);
    }

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 525 }}>
                <Dialog.Title>
                    Edit Session Details
                </Dialog.Title>
                <Flex direction="column" gap="4" py="4">
                    <Box className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                         <Text as="label" size="2" weight="medium" htmlFor="sessionNameEditModal" className="text-right">Session Name</Text>
                         {/* Corrected TextField Usage */}
                         <TextField.Root size="2">
                             <TextField.Root id="sessionNameEditModal" value={editSessionName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditSessionName(e.target.value)} placeholder="e.g., Weekly Check-in" required />
                         </TextField.Root>

                         <Text as="label" size="2" weight="medium" htmlFor="clientNameEditModal" className="text-right">Client Name</Text>
                         {/* Corrected TextField Usage */}
                         <TextField.Root size="2">
                             <TextField.Root id="clientNameEditModal" value={editClientName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditClientName(e.target.value)} placeholder="Client's Full Name" required />
                         </TextField.Root>

                         <Text as="label" size="2" weight="medium" htmlFor="sessionDateEditModal" className="text-right">Date</Text>
                         {/* Use standard HTML input, styled to match Radix */}
                         <input id="sessionDateEditModal" type="date" value={editDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditDate(e.target.value)} required className="rt-TextFieldInput rt-r-size-2 rt-variant-surface" />

                         <Text as="label" size="2" weight="medium" htmlFor="sessionTypeEditModal" className="text-right">Session Type</Text>
                         <Select.Root value={editType} onValueChange={setEditType} required size="2"> {/* Added size */}
                            <Select.Trigger id="sessionTypeEditModal" placeholder="Select type..." />
                            <Select.Content> {SESSION_TYPES.map(type => (<Select.Item key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</Select.Item>))} </Select.Content>
                         </Select.Root>

                         <Text as="label" size="2" weight="medium" htmlFor="therapyTypeEditModal" className="text-right">Therapy Type</Text>
                         <Select.Root value={editTherapy} onValueChange={setEditTherapy} required size="2"> {/* Added size */}
                            <Select.Trigger id="therapyTypeEditModal" placeholder="Select therapy..." />
                            <Select.Content> {THERAPY_TYPES.map(type => (<Select.Item key={type} value={type}>{type}</Select.Item>))} </Select.Content>
                         </Select.Root>
                    </Box>

                    {validationError && (
                         <Callout.Root color="red" role="alert" size="1" mt="2"> <Callout.Icon><InfoCircledIcon /></Callout.Icon> <Callout.Text>{validationError}</Callout.Text> </Callout.Root>
                    )}
                </Flex>
                <Flex gap="3" mt="4" justify="end">
                    <Dialog.Close>
                        <Button type="button" variant="soft" color="gray">Cancel</Button>
                    </Dialog.Close>
                    <Button type="button" onClick={handleSave}>Save Changes</Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
