import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/Button'; // Use new Button
import { Input } from './ui/Input'; // Use new Input
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select'; // Use new Select
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from './ui/Dialog';
import { Label } from './ui/Label'; // Use new Label
import { UploadIcon, ReloadIcon, Cross1Icon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
import type { SessionMetadata, UploadModalProps } from '../types';
import { closeUploadModalAtom, handleStartTranscriptionAtom } from '../store';
import { cn } from '../utils'; // Import cn

// Props remain the same - controlled by App/store
// export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalProps) {
export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalProps) {
    const closeModalAction = useSetAtom(closeUploadModalAtom); // Renamed for clarity
    const startTranscriptionAction = useSetAtom(handleStartTranscriptionAtom);
    const navigate = useNavigate();

    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [modalFile, setModalFile] = useState<File | null>(null);
    const [clientNameInput, setClientNameInput] = useState('');
    const [sessionDate, setSessionDate] = useState(getTodayDateString());
    const [sessionNameInput, setSessionNameInput] = useState('');
    const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]);
    const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]);

    const resetModal = useCallback(() => {
        setModalFile(null);
        setClientNameInput('');
        setSessionDate(getTodayDateString());
        setSessionNameInput('');
        setSessionTypeInput(SESSION_TYPES[0]);
        setTherapyInput(THERAPY_TYPES[0]);
        setDragActive(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
         // It's generally better to let the atom handle error clearing if needed on open
    }, []);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            resetModal();
        }
    }, [isOpen, resetModal]);

    const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); e.stopPropagation();
        if (isTranscribing) return;
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    };

    const handleFileSelection = (file: File | null) => {
         if (file && file.type === 'audio/mpeg') {
            setModalFile(file);
            if (!sessionNameInput) {
                setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
            }
        } else {
            setModalFile(null);
            if (file) alert('Invalid file type. Please upload an MP3 audio file.');
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

     const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault(); e.stopPropagation();
        if (isTranscribing) return;
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    };

     const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        handleFileSelection(e.target.files?.[0] ?? null);
    };

     const handleUploadAreaClick = () => {
        if (!modalFile && !isTranscribing) fileInputRef.current?.click();
    };

    const handleStartClick = async () => {
        if (modalFile && clientNameInput.trim() && sessionNameInput.trim() && sessionDate && sessionTypeInput && therapyInput) {
            const metadata: SessionMetadata = {
                clientName: clientNameInput.trim(), sessionName: sessionNameInput.trim(),
                date: sessionDate, sessionType: sessionTypeInput, therapy: therapyInput
            };
            const result = await startTranscriptionAction({ file: modalFile, metadata });
            if (result.success) {
                navigate(`/sessions/${result.newSessionId}/chats/${result.newChatId}`);
                closeModalAction(); // Close modal on successful upload and navigation
            }
            // Error state is handled by the atom and displayed below button
        } else {
             let missingFields = [];
             if (!modalFile) missingFields.push("Audio File (.mp3)");
             if (!clientNameInput.trim()) missingFields.push("Client Name");
             if (!sessionNameInput.trim()) missingFields.push("Session Name");
             if (!sessionDate) missingFields.push("Date");
             // Selects have defaults, unlikely to be missing unless cleared somehow
             alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
    };

    // Use the onOpenChange prop provided by Radix Dialog
    const handleOpenChange = (open: boolean) => {
        if (!open && !isTranscribing) {
            closeModalAction();
        }
        // If trying to close while transcribing, the dialog might stay open
        // depending on Radix behavior, or you could prevent it here if needed.
    };


    // Tailwind classes for drop area remain the same
    const dropAreaClasses = cn(
        "border-2 border-dashed rounded-md p-6 text-center cursor-pointer transition-colors duration-200 ease-in-out",
        "flex flex-col items-center justify-center space-y-2 min-h-[10rem]",
        isTranscribing
            ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700'
            : dragActive
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : modalFile
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
    );

    // No need for outer check, Dialog handles visibility via `open` prop
    // if (!isOpen) return null;

    return (
        // Use standard Dialog, controlled by isOpen from props/atom
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
             {/* Use standard DialogContent */}
             <DialogContent className="sm:max-w-lg"> {/* Adjust max-width as needed */}
                 {/* Add Header */}
                 <DialogHeader>
                     <DialogTitle>Upload New Session</DialogTitle>
                     {/* Optional: <DialogDescription>Add details and upload an MP3 audio file.</DialogDescription> */}
                 </DialogHeader>

                {/* Form content area */}
                <div className="py-4 space-y-4 max-h-[70vh] overflow-y-auto pr-2"> {/* Added max-height and scroll */}

                    {/* Drop Area */}
                    <div
                        className={dropAreaClasses}
                        onDragEnter={handleDrag} onDragLeave={handleDrag}
                        onDragOver={handleDrag} onDrop={handleDrop}
                        onClick={handleUploadAreaClick}
                        aria-disabled={isTranscribing}
                        role="button"
                        tabIndex={isTranscribing ? -1 : 0}
                    >
                         <input
                            ref={fileInputRef} type="file" accept="audio/mpeg" className="hidden"
                            onChange={handleFileChange}
                            disabled={!!modalFile || isTranscribing}
                        />
                        <UploadIcon className={cn("mx-auto h-10 w-10 mb-2",
                             dragActive ? 'text-blue-500' :
                             (modalFile ? 'text-emerald-600' : 'text-gray-400 dark:text-gray-500')
                         )} aria-hidden="true"/>
                         <p className="text-sm text-gray-600 dark:text-gray-400">
                            {isTranscribing ? "Processing audio..." :
                             (modalFile ? <>Selected: <span className="font-medium">{modalFile.name}</span></> :
                              (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}
                         </p>
                         {modalFile && !isTranscribing && (
                            <Button variant="link" size="xs" className="text-red-600 dark:text-red-500 mt-1 h-auto p-0"
                                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                    e.stopPropagation(); // Prevent triggering click on drop area
                                    handleFileSelection(null);
                                }}>
                                 Remove file
                             </Button>
                        )}
                    </div>

                    {/* Form Fields Grid */}
                    {/* Use grid similar to Edit Details modal for consistency */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3 pt-2">
                        {/* Span Session Name across full width */}
                        <div className="md:col-span-2">
                             <Label htmlFor="sessionNameModalNew" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Session Name / Title</Label>
                             <Input id="sessionNameModalNew" type="text" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onChange={(e) => setSessionNameInput(e.target.value)} disabled={isTranscribing} required />
                        </div>

                        {/* Client Name */}
                        <div>
                            <Label htmlFor="clientNameModalNew" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Client Name</Label>
                            <Input id="clientNameModalNew" type="text" placeholder="Client's Full Name" value={clientNameInput} onChange={(e) => setClientNameInput(e.target.value)} disabled={isTranscribing} required />
                        </div>

                        {/* Date */}
                         <div>
                             <Label htmlFor="sessionDateModalNew" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Date</Label>
                             <input
                                id="sessionDateModalNew"
                                type="date"
                                value={sessionDate}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionDate(e.target.value)}
                                disabled={isTranscribing}
                                required
                                // className comes from global.css base styles
                              />
                        </div>

                        {/* Session Type */}
                        <div>
                            <Label htmlFor="sessionTypeModalNew" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Session Type</Label>
                            <Select value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={isTranscribing} required >
                                <SelectTrigger id="sessionTypeModalNew">
                                    <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                                <SelectContent>
                                     {SESSION_TYPES.map(type => (
                                         <SelectItem key={type} value={type}>
                                             {type.charAt(0).toUpperCase() + type.slice(1)}
                                         </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Therapy Type */}
                        <div>
                            <Label htmlFor="therapyTypeModalNew" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Therapy Modality</Label>
                            <Select value={therapyInput} onValueChange={setTherapyInput} disabled={isTranscribing} required >
                                <SelectTrigger id="therapyTypeModalNew">
                                     <SelectValue placeholder="Select therapy..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {THERAPY_TYPES.map(type => ( <SelectItem key={type} value={type}>{type}</SelectItem> ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div> {/* End scrollable content area */}

                {/* Add Footer */}
                 <DialogFooter className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    {/* Error Message Area */}
                     <div className="flex-grow text-center mr-4">
                         {transcriptionError && (
                            <p className="text-sm text-red-600 dark:text-red-500">
                                Error: {transcriptionError}
                            </p>
                        )}
                     </div>
                     {/* Action Buttons */}
                    <DialogClose asChild>
                        <Button type="button" variant="secondary" disabled={isTranscribing}>
                            Cancel
                        </Button>
                    </DialogClose>
                    <Button
                        type="button"
                        onClick={handleStartClick}
                        disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || isTranscribing}
                        loading={isTranscribing} // Use Button's loading prop
                    >
                        {isTranscribing ? 'Transcribing...' : 'Upload & Transcribe'}
                    </Button>
                </DialogFooter>

             </DialogContent>
        </Dialog>
    );
}
