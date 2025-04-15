import React, { useState, useEffect } from 'react';
import { Button, Dialog, Flex, Text, TextField, Select, Box, Callout, Spinner } from '@radix-ui/themes';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../../constants';
import { updateSessionMetadata } from '../../../api/api';
import type { Session, SessionMetadata } from '../../../types';
import { cn } from '../../../utils';

interface EditDetailsModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    session: Session | null; // Receive full session for initial values
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
    const queryClient = useQueryClient();

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
            // Reset mutation state if needed, though usually handled by component unmount/remount
            updateMetadataMutation.reset();
        } else if (!isOpen) {
             // Optional: Reset mutation state when modal closes without saving
             updateMetadataMutation.reset();
        }
    }, [isOpen, session]);

    // Mutation for updating metadata
    const updateMetadataMutation = useMutation({
        mutationFn: (metadata: Partial<SessionMetadata>) => {
            if (!session) throw new Error("Session data missing");
            return updateSessionMetadata(session.id, metadata);
        },
        onSuccess: (updatedData, variables) => {
            console.log('[EditModal] Save successful (API Response):', updatedData);
            // Invalidate relevant queries to refetch updated data
            queryClient.invalidateQueries({ queryKey: ['sessionMeta', session?.id] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] }); // Invalidate list if name/date/type changed

            // Call prop provided by parent (SessionView) if needed
            onSaveSuccess(variables); // Pass the data that was sent

            onOpenChange(false); // Close modal
        },
        onError: (error) => {
            console.error('[EditModal] Save failed:', error);
            // Set validation error to display in the modal
            setValidationError(`Failed to update session metadata: ${error.message}. Please try again.`);
        }
    });

    const isSaving = updateMetadataMutation.isPending;

    const handleSave = async () => {
        if (!session || isSaving) return;

        const trimmedName = editSessionName.trim();
        const trimmedClient = editClientName.trim();

        let errors: string[] = [];
        if (!trimmedName) errors.push("Session Name");
        if (!trimmedClient) errors.push("Client Name");
        if (!editDate) errors.push("Date");
        // Basic validation, ensure types are within known constants
        if (!SESSION_TYPES.includes(editType)) errors.push("Session Type");
        if (!THERAPY_TYPES.includes(editTherapy)) errors.push("Therapy Type");

        if (errors.length > 0) {
             setValidationError(`Please fill in or correct the following fields: ${errors.join(', ')}`);
             return;
        }

        // Clear previous validation errors before attempting save
        setValidationError(null);

        const metadataToSave: Partial<SessionMetadata> = {
            clientName: trimmedClient,
            sessionName: trimmedName,
            date: editDate,
            sessionType: editType,
            therapy: editTherapy,
        };

        // Check if anything actually changed
        const hasChanged = Object.keys(metadataToSave).some(key =>
            metadataToSave[key as keyof SessionMetadata] !== session[key as keyof SessionMetadata]
        );

        if (!hasChanged) {
             setValidationError("No changes detected.");
             return; // Don't call mutation if nothing changed
        }

        try {
            updateMetadataMutation.mutate(metadataToSave);
        } catch (err) {
             // This catch block might not be necessary if mutation handles errors
             console.error("Error initiating mutation:", err);
             setValidationError("An unexpected error occurred while trying to save.");
        }
    };

    const handleManualClose = (open: boolean) => {
        // Prevent closing while saving is in progress
        if (!open && isSaving) {
             console.log("[EditModal] Attempted to close while saving.");
             // Optionally show a message or disable close action?
             return; // Prevent closing
        }
        if (!open) {
            // Clear validation errors when closing manually
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
                        <input
                            id="sessionDateEditModal"
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            required
                            aria-required="true"
                            disabled={isSaving}
                            className={cn(
                            "flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]",
                            "h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            )}
                            style={{ lineHeight: 'normal' }}
                        />
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
