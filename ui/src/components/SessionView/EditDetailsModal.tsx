// src/components/SessionView/EditDetailsModal.tsx
import React, { useState, useEffect } from 'react';
import { Button, Dialog, Flex, Text, TextField, Select, Box, Callout } from '@radix-ui/themes'; // Removed Heading, not used
import { InfoCircledIcon } from '@radix-ui/react-icons';
// ** Import the actual constants array **
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import { updateSessionMetadata } from '../../api/api';
import type { Session } from '../../types';
import { cn } from '../../utils'; // Keep cn if used for input styling

interface EditDetailsModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    session: Session | null;
}

export function EditDetailsModal({ isOpen, onOpenChange, session }: EditDetailsModalProps) {
    // State for editable fields
    const [editClientName, setEditClientName] = useState('');
    const [editSessionName, setEditSessionName] = useState('');
    const [editDate, setEditDate] = useState('');
    const [editType, setEditType] = useState(''); // Holds the *value* for the Select
    const [editTherapy, setEditTherapy] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    // Effect to initialize form state when modal opens or session changes
    useEffect(() => {
        if (isOpen && session) {
            console.log('[EditModal] Opening. Initializing state from session:', session);
            setEditClientName(session.clientName || '');
            setEditSessionName(session.sessionName || session.fileName || ''); // Fallback to fileName
            setEditDate(session.date || ''); // Expects "YYYY-MM-DD"

            // --- Fix for Session Type ---
            // 1. Normalize the session value to lowercase for comparison
            const currentSessionTypeLower = session.sessionType?.toLowerCase();
            // 2. Find the matching value (case-insensitive) in our constants array
            const matchingType = SESSION_TYPES.find(
                typeConst => typeConst.toLowerCase() === currentSessionTypeLower
            );
            // 3. Set the state to the *exact* value from the constants array, or default if not found
            const initialEditType = matchingType || SESSION_TYPES[0] || ''; // Use first type or empty string as fallback
            setEditType(initialEditType);
            console.log(`[EditModal] Session Type: session='${session.sessionType}', matched='${matchingType}', setEditType='${initialEditType}'`);
            // --- End Fix ---

            // --- Fix for Therapy Type (similar logic) ---
            const currentTherapyTypeUpper = session.therapy?.toUpperCase(); // Assuming constants are uppercase like "ACT"
            const matchingTherapy = THERAPY_TYPES.find(
                therapyConst => therapyConst.toUpperCase() === currentTherapyTypeUpper
            );
            const initialEditTherapy = matchingTherapy || THERAPY_TYPES[0] || '';
            setEditTherapy(initialEditTherapy);
             console.log(`[EditModal] Therapy Type: session='${session.therapy}', matched='${matchingTherapy}', setEditTherapy='${initialEditTherapy}'`);
            // --- End Fix ---

            setValidationError(null); // Clear previous errors
        } else if (!isOpen) {
             // Optionally reset state when modal closes if desired, though useEffect covers re-opening
             // resetState();
        }
    }, [isOpen, session]); // Re-run when modal opens or the session prop changes

     // Optional reset function
    //  const resetState = () => {
    //      setEditClientName('');
    //      setEditSessionName('');
    //      setEditDate('');
    //      setEditType('');
    //      setEditTherapy('');
    //      setValidationError(null);
    //  };

    // Handle Save action
    const handleSave = async () => {
        if (!session) return;
        const trimmedName = editSessionName.trim();
        const trimmedClient = editClientName.trim();

        // Validation
        if (!trimmedName || !trimmedClient || !editDate) {
            setValidationError("Please ensure Session Name, Client Name, and Date are filled.");
            return;
        }
        // Ensure selected types are valid (they should be if using Select correctly)
        if (!SESSION_TYPES.includes(editType)) {
             setValidationError("Invalid Session Type selected.");
             return;
        }
         if (!THERAPY_TYPES.includes(editTherapy)) {
             setValidationError("Invalid Therapy Type selected.");
             return;
        }

        setValidationError(null); // Clear error before attempting save

        try {
            console.log('[EditModal] Saving changes:', {
                clientName: trimmedClient,
                sessionName: trimmedName,
                date: editDate,
                sessionType: editType, // Send the exact value from state/Select
                therapy: editTherapy,  // Send the exact value from state/Select
            });
            // Call API to update metadata
            // The API should handle receiving the exact values from SESSION_TYPES/THERAPY_TYPES
            const updatedMetadata = await updateSessionMetadata(session.id, {
                clientName: trimmedClient,
                sessionName: trimmedName,
                date: editDate,
                sessionType: editType,
                therapy: editTherapy,
            });
            console.log('[EditModal] Save successful:', updatedMetadata);
            // TODO: Update global state here if necessary, or rely on parent refetch/update
            onOpenChange(false); // Close modal on success
        } catch (err) {
            console.error('[EditModal] Save failed:', err);
            setValidationError('Failed to update session metadata. Please try again.');
        }
    };

    // Handle modal close event (clears validation error)
    const handleManualClose = (open: boolean) => {
        if (!open) {
            setValidationError(null);
        }
        onOpenChange(open);
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleManualClose}>
            <Dialog.Content style={{ maxWidth: 525 }}>
                <Dialog.Title>Edit Session Details</Dialog.Title>
                {/* Optional: Add description */}
                {/* <Dialog.Description size="2" mb="4" color="gray">Update the details for this session.</Dialog.Description> */}

                <Flex direction="column" gap="4" py="4">
                    {/* Use Grid for layout */}
                    <Box className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
                        {/* Session Name */}
                        <Text as="label" size="2" weight="medium" htmlFor="sessionNameEditModal" className="text-right">Session Name</Text>
                        <TextField.Root
                            id="sessionNameEditModal"
                            size="2"
                            value={editSessionName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditSessionName(e.target.value)}
                            placeholder="e.g., Weekly Check-in"
                            required
                            aria-required="true"
                        />
                        {/* Client Name */}
                        <Text as="label" size="2" weight="medium" htmlFor="clientNameEditModal" className="text-right">Client Name</Text>
                        <TextField.Root
                            id="clientNameEditModal"
                            size="2"
                            value={editClientName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditClientName(e.target.value)}
                            placeholder="Client's Full Name"
                            required
                            aria-required="true"
                        />
                        {/* Date */}
                        <Text as="label" size="2" weight="medium" htmlFor="sessionDateEditModal" className="text-right">Date</Text>
                        {/* Using native date input with Radix styling applied via className */}
                        <input
                            id="sessionDateEditModal"
                            type="date"
                            value={editDate}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditDate(e.target.value)}
                            required
                            aria-required="true"
                            // Apply Radix Themes input styles manually using utility classes or specific tokens if needed
                            className={cn(
                                "rt-TextFieldInput", // Base input class from Radix Themes (inspect element to find it)
                                "rt-r-size-2",      // Size class
                                "rt-variant-surface", // Variant class
                                "h-8 text-sm px-2 py-1" // Manual sizing/padding might be needed
                             )}
                            style={{ lineHeight: 'normal' }} // Ensure proper line height
                        />
                        {/* Session Type */}
                        <Text as="label" size="2" weight="medium" htmlFor="sessionTypeEditModal" className="text-right">Session Type</Text>
                        {/* Select component for Session Type */}
                        <Select.Root
                             value={editType} // Bind to state variable
                             onValueChange={setEditType} // Update state on change
                             required
                             size="2"
                             name="sessionType" // Add name for forms/accessibility
                         >
                            <Select.Trigger id="sessionTypeEditModal" placeholder="Select type..." />
                            <Select.Content>
                                {/* Map over the constants array */}
                                {SESSION_TYPES.map((type) => (
                                    // Use the exact value from the array for 'value' prop
                                    <Select.Item key={type} value={type}>
                                        {/* Capitalize for display */}
                                        {type.charAt(0).toUpperCase() + type.slice(1)}
                                    </Select.Item>
                                ))}
                            </Select.Content>
                        </Select.Root>
                        {/* Therapy Type */}
                        <Text as="label" size="2" weight="medium" htmlFor="therapyTypeEditModal" className="text-right">Therapy Type</Text>
                         {/* Select component for Therapy Type */}
                        <Select.Root
                            value={editTherapy} // Bind to state variable
                            onValueChange={setEditTherapy} // Update state on change
                            required
                            size="2"
                            name="therapyType" // Add name
                         >
                            <Select.Trigger id="therapyTypeEditModal" placeholder="Select therapy..." />
                            <Select.Content>
                                 {/* Map over the constants array */}
                                {THERAPY_TYPES.map((type) => (
                                    // Use the exact value from the array for 'value' prop
                                    <Select.Item key={type} value={type}>
                                        {type} {/* Display as is (likely already formatted) */}
                                    </Select.Item>
                                ))}
                            </Select.Content>
                        </Select.Root>
                    </Box>
                    {/* Validation Error Display */}
                    {validationError && (
                        <Callout.Root color="red" role="alert" size="1" mt="2">
                            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
                            <Callout.Text>{validationError}</Callout.Text>
                        </Callout.Root>
                    )}
                </Flex>
                {/* Modal Footer Buttons */}
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
