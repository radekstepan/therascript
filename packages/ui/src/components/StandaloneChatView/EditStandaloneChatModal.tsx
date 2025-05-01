// =========================================
// File: packages/ui/src/components/StandaloneChatView/EditStandaloneChatModal.tsx
// =========================================
/*
 * packages/ui/src/components/StandaloneChatView/EditStandaloneChatModal.tsx
 *
 * This modal allows users to edit the details of a standalone chat,
 * including its name and associated tags.
 */
import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import { Dialog, Button, Flex, Text, TextField, Box, Badge, IconButton, Callout } from '@radix-ui/themes';
import { Cross2Icon, CheckIcon, PlusIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import type { StandaloneChatListItem } from '../../types'; // <-- Import from types

interface EditStandaloneChatModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    chat: StandaloneChatListItem | null;
    onSave: (chatId: number, newName: string | null, newTags: string[]) => void;
    isSaving: boolean;
    saveError?: string | null;
}

export function EditStandaloneChatModal({
    isOpen,
    onOpenChange,
    chat,
    onSave,
    isSaving,
    saveError
}: EditStandaloneChatModalProps) {
    const [editName, setEditName] = useState('');
    const [editTags, setEditTags] = useState<string[]>([]);
    const [newTagInput, setNewTagInput] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);

    // Effect to initialize state when modal opens or chat changes
    useEffect(() => {
        // Only update state if the modal is open AND the chat prop is valid
        if (isOpen && chat) {
            console.log(`[EditModal useEffect] Modal opened or chat changed (ID: ${chat.id}). Setting state.`);
            setEditName(chat.name || '');
            const initialTags = Array.isArray(chat.tags) ? chat.tags : [];
            // Only update tags if they differ from current state to avoid unnecessary re-renders
            setEditTags(currentTags => {
                const newTagsString = JSON.stringify(initialTags.sort());
                const currentTagsString = JSON.stringify(currentTags.sort());
                if (newTagsString !== currentTagsString) {
                    console.log(`[EditModal useEffect] Setting tags state to:`, initialTags);
                    return initialTags;
                }
                return currentTags; // No change needed
            });
            setNewTagInput('');
            setInputError(null);
        }
        // Intentionally not resetting state when isOpen becomes false here.
        // Resetting should happen when the modal *intends* to close cleanly (e.g., Cancel, Save success).
    }, [isOpen, chat]); // Depend only on isOpen and the chat object reference

    const handleAddTag = useCallback((e?: React.FormEvent | React.KeyboardEvent) => {
        if (e) e.preventDefault();
        const tagToAdd = newTagInput.trim();
        console.log("[handleAddTag] Attempting to add:", tagToAdd);
        if (!tagToAdd) return;

        if (editTags.some(tag => tag.toLowerCase() === tagToAdd.toLowerCase())) {
            setInputError(`Tag "${tagToAdd}" already exists.`);
            return;
        }
        if (tagToAdd.length > 50) {
            setInputError("Tags cannot exceed 50 characters.");
            return;
        }
        if (editTags.length >= 10) {
             setInputError("Maximum of 10 tags allowed.");
             return;
        }

        setEditTags(prevTags => {
            const updated = [...prevTags, tagToAdd];
            console.log("[handleAddTag] Updated tags:", updated);
            return updated;
        });
        setNewTagInput('');
        setInputError(null);
    }, [newTagInput, editTags]); // Dependencies for add tag

    const handleRemoveTag = useCallback((tagToRemove: string) => {
        console.log(`[handleRemoveTag] Request to remove: "${tagToRemove}"`);
        setEditTags(prevTags => {
            console.log(`[handleRemoveTag] Tags BEFORE removal of "${tagToRemove}":`, prevTags);
            const newTags = prevTags.filter(tag => tag !== tagToRemove);
            console.log(`[handleRemoveTag] Tags AFTER removal of "${tagToRemove}":`, newTags);
            if (newTags.length === prevTags.length) {
                console.warn(`[handleRemoveTag] Tag "${tagToRemove}" not found in current state.`);
            }
            return newTags;
        });
        // Clear input error if it was related to the removed tag (or generally)
        setInputError(null);
    }, []); // No dependencies needed if using functional update

    const handleTagInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
         if (e.key === 'Enter' || e.key === ',') {
             e.preventDefault();
             handleAddTag(e);
         }
         // Clear error on typing
         if (inputError) setInputError(null);
    }, [handleAddTag, inputError]); // Dependency on handleAddTag

    const handleSaveClick = useCallback(() => {
        if (!chat || isSaving) return;
        setInputError(null); // Clear previous errors

        // Perform final validation checks
        if (editTags.some(tag => !tag.trim())) { setInputError("Cannot save empty tags."); return; }
        if (editTags.some(tag => tag.length > 50)) { setInputError("Tags cannot exceed 50 characters."); return; }
        if (editTags.length > 10) { setInputError("Maximum of 10 tags allowed."); return; }

        const finalName = editName.trim() || null;
        console.log("[handleSaveClick] Saving with Name:", finalName, "Tags:", editTags);
        onSave(chat.id, finalName, editTags);
    }, [chat, isSaving, editName, editTags, onSave]); // Dependencies for save

    // Wrapper to prevent closing while saving
    const handleOpenChangeWrapper = useCallback((open: boolean) => {
        if (!open && isSaving) {
            console.log("[handleOpenChangeWrapper] Prevented close while saving.");
            return; // Don't close if saving
        }
        onOpenChange(open); // Propagate change otherwise
    }, [isSaving, onOpenChange]); // Dependencies


    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChangeWrapper}>
            <Dialog.Content style={{ maxWidth: 450 }}>
                <Dialog.Title>Edit Chat Details</Dialog.Title>
                <Dialog.Description size="2" mb="4">
                    Update the name and tags for this chat.
                </Dialog.Description>

                <Flex direction="column" gap="3">
                    {/* Name Input */}
                    <label>
                        <Text as="div" size="2" mb="1" weight="medium">Name (Optional)</Text>
                        <TextField.Root
                            size="2"
                            placeholder="Enter chat name"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            disabled={isSaving}
                        />
                    </label>

                    {/* Tags Management */}
                    <label>
                        <Text as="div" size="2" mb="1" weight="medium">Tags</Text>
                        {/* Tag Display Area */}
                        <Flex gap="1" wrap="wrap" mb={editTags.length > 0 ? "2" : "0"} style={{minHeight: editTags.length > 0 ? 'auto' : '0px' }}>
                            {/* Ensure stable keys and correct onClick handler */}
                            {editTags.map((tag, index) => (
                                <Badge key={`${tag}-${index}`} color="gray" variant="soft" radius="full"> {/* Added index to key for absolute uniqueness */}
                                    {tag}
                                    <IconButton
                                        size="1" variant="ghost" color="gray" radius="full"
                                        onClick={(e) => {
                                            e.preventDefault(); // Prevent default button action
                                            e.stopPropagation(); // Prevent potential event bubbling
                                            handleRemoveTag(tag); // Pass the specific tag from this iteration
                                        }}
                                        disabled={isSaving}
                                        aria-label={`Remove tag ${tag}`}
                                        style={{ marginLeft: '4px', marginRight: '-5px', height: '12px', width: '12px', cursor: 'pointer' }}
                                    >
                                        <Cross2Icon width="10" height="10" />
                                    </IconButton>
                                </Badge>
                            ))}
                        </Flex>
                        {/* Tag Input Area */}
                        <Flex gap="2" align="center">
                            <TextField.Root
                                size="2"
                                placeholder="Add a tag..."
                                value={newTagInput}
                                onChange={(e) => setNewTagInput(e.target.value)}
                                onKeyDown={handleTagInputKeyDown}
                                disabled={isSaving || editTags.length >= 10}
                                style={{ flexGrow: 1 }}
                                aria-invalid={!!inputError}
                                aria-describedby={inputError ? "tag-input-error" : undefined}
                            />
                            <IconButton
                                size="2" variant="soft"
                                onClick={handleAddTag}
                                disabled={isSaving || !newTagInput.trim() || editTags.length >= 10}
                                aria-label="Add tag"
                                title="Add tag"
                            >
                                <PlusIcon />
                            </IconButton>
                        </Flex>
                         {inputError && (
                             <Text id="tag-input-error" color="red" size="1" mt="1">{inputError}</Text>
                         )}
                    </label>

                     {/* Display Save Error */}
                     {saveError && !inputError && (
                        <Callout.Root color="red" size="1">
                            <Callout.Icon><InfoCircledIcon /></Callout.Icon>
                            <Callout.Text>Error saving: {saveError}</Callout.Text>
                        </Callout.Root>
                     )}

                </Flex>

                {/* Action Buttons */}
                <Flex gap="3" mt="4" justify="end">
                    <Button variant="soft" color="gray" onClick={() => handleOpenChangeWrapper(false)} disabled={isSaving}>
                        <Cross2Icon /> Cancel
                    </Button>
                    <Button onClick={handleSaveClick} disabled={isSaving}>
                        {isSaving ? 'Saving...' : <><CheckIcon /> Save Changes</>}
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
