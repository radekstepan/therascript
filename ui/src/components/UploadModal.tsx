// src/components/UploadModal.tsx
import React from 'react';
import { Dialog, Button, Flex, Text, Spinner, Callout } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { useUploadModal } from '../hooks/useUploadModal';
import { UploadDropArea } from './UploadModal/UploadDropArea';
import { UploadFormFields } from './UploadModal/UploadFormFields';

export function UploadModal() {
    const {
        isOpen, isTranscribing, error, dragActive, modalFile,
        clientNameInput, setClientNameInput, sessionDate, setSessionDate,
        sessionNameInput, setSessionNameInput, sessionTypeInput, setSessionTypeInput,
        therapyInput, setTherapyInput, fileInputRef, // Ref from hook
        handleDrag, handleDrop, handleFileChange, handleUploadAreaClick,
        handleRemoveFileClick, handleStartUpload, handleOpenChange,
        SESSION_TYPES, THERAPY_TYPES,
    } = useUploadModal();

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Dialog.Content style={{ maxWidth: 550 }}>
                <Dialog.Title>Upload New Session</Dialog.Title>
                <Dialog.Description size="2" mb="4" color="gray">
                    Add session details and upload an MP3 audio file to start analysis.
                </Dialog.Description>
                <Flex direction="column" gap="4">
                    <UploadDropArea
                        modalFile={modalFile}
                        isTranscribing={isTranscribing}
                        dragActive={dragActive}
                        handleUploadAreaClick={handleUploadAreaClick}
                        handleDrag={handleDrag}
                        handleDrop={handleDrop}
                        handleRemoveFileClick={handleRemoveFileClick}
                        fileInputRef={fileInputRef} // Pass ref
                    />
                     {/* Hidden Input - Ref and handler are attached */}
                     <input
                        ref={fileInputRef} // Attach ref from hook
                        type="file"
                        accept="audio/mpeg"
                        className="hidden"
                        id="audio-upload-input"
                        onChange={handleFileChange} // Attach handler from hook
                        disabled={isTranscribing}
                        aria-hidden="true"
                    />
                    <UploadFormFields
                         sessionNameInput={sessionNameInput} setSessionNameInput={setSessionNameInput}
                         clientNameInput={clientNameInput} setClientNameInput={setClientNameInput}
                         sessionDate={sessionDate} setSessionDate={setSessionDate}
                         sessionTypeInput={sessionTypeInput} setSessionTypeInput={setSessionTypeInput}
                         therapyInput={therapyInput} setTherapyInput={setTherapyInput}
                         isTranscribing={isTranscribing}
                         SESSION_TYPES={SESSION_TYPES}
                         THERAPY_TYPES={THERAPY_TYPES}
                     />
                    {error && ( <Callout.Root color="red" role="alert" size="1" mt="2"> <Callout.Icon><InfoCircledIcon /></Callout.Icon> <Callout.Text>{error}</Callout.Text> </Callout.Root> )}
                </Flex>
                <Flex gap="3" mt="5" justify="end">
                    {/* Workaround for asChild error: Remove asChild and let Radix handle it */}
                    <Dialog.Close>
                        <Button type="button" variant="soft" color="gray" disabled={isTranscribing}>Cancel</Button>
                    </Dialog.Close>
                    <Button type="button" onClick={handleStartUpload} disabled={!modalFile || isTranscribing}>
                        {isTranscribing ? (<><Spinner size="2" /><Text ml="2">Transcribing...</Text></>) : ('Upload & Transcribe')}
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
}
