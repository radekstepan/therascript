import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/Button'; // Use new Button
import { Input } from './ui/Input'; // Use new Input
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select'; // Use new Select
import { Dialog, DialogPanelContent, DialogTitle } from './ui/Dialog'; // Use new Dialog components
import { Label } from './ui/Label'; // Use new Label
import { UploadCloud, Loader2, X } from './icons/Icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
import type { SessionMetadata, UploadModalProps } from '../types';
import { closeUploadModalAtom, handleStartTranscriptionAtom } from '../store';
import { cn } from '../utils'; // Import cn

export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalProps) {
    const closeModal = useSetAtom(closeUploadModalAtom);
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
    }, []);

    useEffect(() => {
        if (isOpen) resetModal();
    }, [isOpen, resetModal]);

    const handleDrag = (e: React.DragEvent<HTMLDivElement>) => { // Only div needs drag handlers now
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
                closeModal();
            }
        } else {
             let missingFields = [];
             if (!modalFile) missingFields.push("Audio File (.mp3)");
             if (!clientNameInput.trim()) missingFields.push("Client Name");
             if (!sessionNameInput.trim()) missingFields.push("Session Name");
             if (!sessionDate) missingFields.push("Date");
             alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
    };

    const handleCloseAttempt = useCallback(() => {
         if (!isTranscribing) closeModal();
    }, [closeModal, isTranscribing]);

    // --- ESC key listener ---
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleCloseAttempt();
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleCloseAttempt]);


    // Use Tailwind classes for drop area
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

    // No need for outer Dialog if isOpen is false
    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseAttempt()}>
             {/* Use DialogPanelContent for the side drawer effect */}
             <DialogPanelContent hideCloseButton={true} className="flex flex-col"> {/* Let content manage scroll */}

                 {/* Header */}
                 <div className="flex items-center justify-between mb-4 flex-shrink-0">
                     <DialogTitle className="text-xl">Upload New Session</DialogTitle> {/* Use DialogTitle */}
                     <Button
                        variant="ghost" size="iconSm"
                        className=" -mr-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
                        onClick={handleCloseAttempt}
                        disabled={isTranscribing}
                        aria-label="Close upload panel"
                     > <X size={16}/> </Button>
                 </div>
                 <hr className="border-gray-200 dark:border-gray-700 -mx-6 mb-4 flex-shrink-0"/>

                {/* Form content - Scrollable */}
                <div className="flex-grow space-y-4 overflow-y-auto pr-2 -mr-2"> {/* Make this div scrollable */}

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
                        <UploadCloud className={cn("mx-auto h-10 w-10 mb-2",
                             dragActive ? 'text-blue-500' :
                             (modalFile ? 'text-emerald-600' : 'text-gray-400 dark:text-gray-500')
                         )} aria-hidden="true"/>
                         <p className="text-sm text-gray-600 dark:text-gray-400"> {/* Use p */}
                            {isTranscribing ? "Processing audio..." :
                             (modalFile ? <>Selected: <span className="font-medium">{modalFile.name}</span></> :
                              (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}
                         </p>
                         {modalFile && !isTranscribing && (
                            <Button variant="link" size="xs" className="text-red-600 dark:text-red-500 mt-1 h-auto p-0"
                                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                    e.stopPropagation();
                                    handleFileSelection(null);
                                }}>
                                 Remove file
                             </Button>
                        )}
                    </div>

                    {/* Use Tailwind Grid for form layout */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                        <div> {/* Wrap Label and Input */}
                            <Label htmlFor="clientNameModal" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Client Name</Label>
                            <Input id="clientNameModal" type="text" placeholder="Client's Full Name" value={clientNameInput} onChange={(e) => setClientNameInput(e.target.value)} disabled={isTranscribing} required />
                        </div>
                        <div>
                             <Label htmlFor="sessionNameModal" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Session Name / Title</Label>
                             <Input id="sessionNameModal" type="text" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onChange={(e) => setSessionNameInput(e.target.value)} disabled={isTranscribing} required />
                        </div>
                         <div>
                             <Label htmlFor="sessionDateModal" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Date</Label>
                             {/* Use standard HTML input type="date" */}
                             <input
                                id="sessionDateModal"
                                type="date"
                                value={sessionDate}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionDate(e.target.value)}
                                disabled={isTranscribing}
                                required
                                // className comes from global.css base styles
                              />
                        </div>
                        <div>
                            <Label htmlFor="sessionTypeModal" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Session Type</Label>
                            {/* Use new Select */}
                            <Select value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={isTranscribing} required >
                                <SelectTrigger id="sessionTypeModal">
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
                        <div className="md:col-span-2">
                            <Label htmlFor="therapyTypeModal" className="block mb-1 font-medium text-gray-700 dark:text-gray-300">Therapy Modality</Label>
                            {/* Use new Select */}
                            <Select value={therapyInput} onValueChange={setTherapyInput} disabled={isTranscribing} required >
                                <SelectTrigger id="therapyTypeModal">
                                     <SelectValue placeholder="Select therapy..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {THERAPY_TYPES.map(type => ( <SelectItem key={type} value={type}>{type}</SelectItem> ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div> {/* End scrollable container */}

                {/* Sticky Footer Area */}
                 <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700 -mx-6 px-6 flex-shrink-0">
                    {transcriptionError && (
                        <p className="mb-2 text-center text-sm text-red-600 dark:text-red-500"> {/* Use p */}
                            Error: {transcriptionError}
                        </p>
                    )}
                    <Button
                        className="w-full"
                        onClick={handleStartClick}
                        disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || !sessionTypeInput || !therapyInput || isTranscribing}
                        loading={isTranscribing} // Use Button's loading prop
                    >
                        {isTranscribing ? 'Transcribing...' : 'Upload & Transcribe Session'}
                    </Button>
                </div>

             </DialogPanelContent>
        </Dialog>
    );
}
