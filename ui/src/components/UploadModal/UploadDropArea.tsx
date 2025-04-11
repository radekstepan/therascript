// src/components/UploadModal/UploadDropArea.tsx
import React from 'react';
import { Flex, Text, Strong, Button, Spinner } from '@radix-ui/themes';
import { UploadIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { cn } from '../../utils';

interface UploadDropAreaProps {
    modalFile: File | null;
    isTranscribing: boolean;
    dragActive: boolean;
    handleUploadAreaClick: () => void;
    handleDrag: (e: React.DragEvent<HTMLLabelElement>) => void;
    handleDrop: (e: React.DragEvent<HTMLLabelElement>) => void;
    handleRemoveFileClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
    // Accept RefObject<HTMLInputElement | null> to match useRef(null)
    fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function UploadDropArea({
    modalFile,
    isTranscribing,
    dragActive,
    handleUploadAreaClick,
    handleDrag,
    handleDrop,
    handleRemoveFileClick,
    fileInputRef // Ref received here, but not used directly
}: UploadDropAreaProps) {

    const dropAreaClasses = cn(
        "rounded-md p-6 text-center transition-colors duration-200 ease-in-out",
        "flex flex-col items-center justify-center space-y-2 min-h-[10rem]",
        "border-2 border-dashed",
        isTranscribing ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700' : 'cursor-pointer',
        dragActive && !isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : modalFile && !isTranscribing ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : !isTranscribing ? 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500' : ''
    );

    return (
        <label
            htmlFor="audio-upload-input" // Connects to the hidden input
            className={dropAreaClasses}
            onClick={handleUploadAreaClick} // Clicks the hidden input via ref
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            aria-disabled={isTranscribing}
            aria-label={modalFile ? `Selected file: ${modalFile.name}. Click to change.` : "Drag and drop MP3 file or click to upload"}
        >
            <Flex direction="column" align="center" gap="1">
                 {modalFile && !isTranscribing ? ( <CheckCircledIcon width="32" height="32" className="text-emerald-600" /> ) : isTranscribing ? ( <Spinner size="3" /> ) : ( <UploadIcon width="32" height="32" className={cn(dragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500')} /> )}
                 <Text size="2" color="gray"> {isTranscribing ? "Processing audio..." : modalFile ? <>Selected: <Strong>{modalFile.name}</Strong></> : dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"} </Text>
                {modalFile && !isTranscribing && ( <Button variant="ghost" color="red" size="1" mt="1" highContrast onClick={handleRemoveFileClick} aria-label="Remove selected file" > Remove file </Button> )}
            </Flex>
        </label>
    );
}
