import React from 'react';
import { Dialog, Button, Flex, Text, TextField, Callout } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import type { ChatMessage } from '../../types';

interface StarMessageDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    messageToName: ChatMessage | null;
    templateNameInput: string;
    setTemplateNameInput: (value: string) => void;
    namingError: string | null;
    setNamingError: (error: string | null) => void; // Allow clearing error on input change
    onConfirmName: () => void;
    onCancelName: () => void;
}

export function StarMessageDialog({
    isOpen,
    onOpenChange,
    messageToName,
    templateNameInput,
    setTemplateNameInput,
    namingError,
    setNamingError, // Receive setter
    onConfirmName,
    onCancelName,
}: StarMessageDialogProps) {

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTemplateNameInput(e.target.value);
        if (namingError) {
            setNamingError(null); // Clear error when user types
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Content style={{ maxWidth: 450 }}>
                <Dialog.Title>Name This Template</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    Give a short, memorable name to easily reuse this message.
                </Dialog.Description>
                <Flex direction="column" gap="3">
                    <label>
                        <Text as="div" size="2" mb="1" weight="bold">Template Name</Text>
                        <TextField.Root
                            size="2"
                            value={templateNameInput}
                            onChange={handleInputChange} // Use combined handler
                            placeholder="Enter a short name..."
                            autoFocus
                            aria-required="true"
                            aria-invalid={!!namingError}
                            aria-describedby={namingError ? "star-name-error" : undefined}
                        />
                    </label>
                    <Text size="1" color="gray" mt="1">
                        Original: "<Text truncate>{messageToName?.text}</Text>"
                    </Text>
                    {namingError && (
                        <Callout.Root color="red" size="1" mt="1" role="alert" id="star-name-error">
                            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
                            <Callout.Text>{namingError}</Callout.Text>
                        </Callout.Root>
                    )}
                </Flex>
                <Flex gap="3" mt="4" justify="end">
                    {/* Use Dialog.Close for cancel */}
                    <Dialog.Close>
                        <Button variant="soft" color="gray" onClick={onCancelName}>Cancel</Button>
                    </Dialog.Close>
                    <Button onClick={onConfirmName}>Save Template</Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
