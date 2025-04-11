import React from 'react';
import { Flex, Box, Text, TextField, Select } from '@radix-ui/themes';
import { cn } from '../../utils';

interface UploadFormFieldsProps {
    sessionNameInput: string; setSessionNameInput: (val: string) => void;
    clientNameInput: string; setClientNameInput: (val: string) => void;
    sessionDate: string; setSessionDate: (val: string) => void;
    sessionTypeInput: string; setSessionTypeInput: (val: string) => void;
    therapyInput: string; setTherapyInput: (val: string) => void;
    isTranscribing: boolean;
    SESSION_TYPES: readonly string[];
    THERAPY_TYPES: readonly string[];
}

export function UploadFormFields({
    sessionNameInput, setSessionNameInput,
    clientNameInput, setClientNameInput,
    sessionDate, setSessionDate,
    sessionTypeInput, setSessionTypeInput,
    therapyInput, setTherapyInput,
    isTranscribing,
    SESSION_TYPES, THERAPY_TYPES
}: UploadFormFieldsProps) {
    return (
        <Flex direction="column" gap="3">
            {/* Session Name */}
            <label>
                <Text as="div" size="2" mb="1" weight="medium">Session Name / Title *</Text>
                <TextField.Root
                    size="2"
                    placeholder="e.g., Weekly Check-in"
                    value={sessionNameInput}
                    onChange={(e) => setSessionNameInput(e.target.value)}
                    disabled={isTranscribing}
                    required
                    aria-required="true"
                />
            </label>

            {/* Client Name & Date */}
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label>
                    <Text as="div" size="2" mb="1" weight="medium">Client Name *</Text>
                    <TextField.Root
                        size="2"
                        placeholder="Client's Full Name"
                        value={clientNameInput}
                        onChange={(e) => setClientNameInput(e.target.value)}
                        disabled={isTranscribing}
                        required
                        aria-required="true"
                    />
                </label>
                <label>
                    <Text as="div" size="2" mb="1" weight="medium">Date *</Text>
                    <input
                        type="date"
                        value={sessionDate}
                        onChange={(e) => setSessionDate(e.target.value)}
                        disabled={isTranscribing}
                        required
                        aria-required="true"
                        className={cn(
                            "flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]",
                            "h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        )}
                        aria-label="Session date"
                    />
                </label>
            </Box>

            {/* Session Type & Therapy */}
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label>
                    <Text as="div" size="2" mb="1" weight="medium">Session Type *</Text>
                    <Select.Root value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={isTranscribing} required size="2" name="sessionType">
                        <Select.Trigger placeholder="Select type..." style={{ width: '100%' }} aria-label="Select session type" />
                        <Select.Content>
                            {SESSION_TYPES.map((type) => (
                                <Select.Item key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</Select.Item>
                            ))}
                        </Select.Content>
                    </Select.Root>
                </label>
                <label>
                    <Text as="div" size="2" mb="1" weight="medium">Therapy Modality *</Text>
                    <Select.Root value={therapyInput} onValueChange={setTherapyInput} disabled={isTranscribing} required size="2" name="therapyType">
                        <Select.Trigger placeholder="Select therapy..." style={{ width: '100%' }} aria-label="Select therapy modality"/>
                        <Select.Content>
                            {THERAPY_TYPES.map((type) => (<Select.Item key={type} value={type}>{type}</Select.Item>))}
                        </Select.Content>
                    </Select.Root>
                </label>
            </Box>
            <Text size="1" color="gray">* Required fields</Text>
        </Flex>
    );
}
