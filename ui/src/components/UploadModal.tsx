import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';

import { Button, TextInput, Select, SelectItem, Dialog, DialogPanel, Title, Text, Divider, Grid, Col, Flex } from '@tremor/react'; // Removed Card import
// Import Icons
import { UploadCloud, Loader2, X } from './icons/Icons';
// Import constants and helpers
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
// Import Types
import type { SessionMetadata, UploadModalProps } from '../types';
// Import Atoms
import {
    closeUploadModalAtom,
    handleStartTranscriptionAtom,
} from '../store';

export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalProps) {
    const closeModal = useSetAtom(closeUploadModalAtom);
    const startTranscriptionAction = useSetAtom(handleStartTranscriptionAtom);
    const navigate = useNavigate();

    // --- Local UI State ---
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
        // Reset form when opening
        if (isOpen) {
            resetModal();
        }
    }, [isOpen, resetModal]);


    // --- Event Handlers ---

    const handleDrag = (e: React.DragEvent<HTMLDivElement | HTMLFormElement>) => { // Added HTMLFormElement for panel drag
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return;
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    };

    const handleFileSelection = (file: File | null) => {
         if (file && file.type === 'audio/mpeg') {
            setModalFile(file);
            // Set session name based on file, only if session name input is currently empty
            if (!sessionNameInput) {
                setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
            }
        } else {
            setModalFile(null);
            // Don't clear session name here, user might have typed one before selecting invalid file
            // setSessionNameInput('');
            if (file) alert('Invalid file type. Please upload an MP3 audio file.');
        }
        // Clear file input visually after selection/drop regardless of validity
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

     const handleDrop = (e: React.DragEvent<HTMLDivElement | HTMLFormElement>) => { // Added HTMLFormElement for panel drop
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
                closeModal(); // Close drawer on successful navigation trigger
            }
            // Error handling is done via transcriptionError atom display
        } else {
             let missingFields = [];
             if (!modalFile) missingFields.push("Audio File (.mp3)");
             if (!clientNameInput.trim()) missingFields.push("Client Name");
             if (!sessionNameInput.trim()) missingFields.push("Session Name");
             if (!sessionDate) missingFields.push("Date"); // Check date too
             alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
    };

    const handleCloseAttempt = useCallback(() => {
        // Prevent closing if transcribing
         if (!isTranscribing) {
             closeModal();
         }
    }, [closeModal, isTranscribing]);

    // --- ESC key listener ---
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleCloseAttempt();
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleCloseAttempt]);


    if (!isOpen) return null;

    // Use Tailwind classes compatible with Tremor for drop area
    const dropAreaClasses = `border-2 border-dashed rounded-tremor-default p-6 text-center cursor-pointer transition-colors duration-200 ease-in-out flex flex-col items-center justify-center space-y-2 min-h-[10rem] ${
        isTranscribing ? 'bg-tremor-background-muted cursor-not-allowed opacity-70' : // Adjusted disabled style
        dragActive ? 'border-tremor-brand bg-tremor-brand-faint' : // Use Tremor colors
        modalFile ? 'border-emerald-500 bg-emerald-50' : // Keep success colors distinct
        'border-tremor-border hover:border-tremor-border-emphasis' // Use Tremor border colors
    }`;


    return (
        <Dialog
            open={isOpen}
            onClose={handleCloseAttempt} // Use the handler that prevents closing if transcribing
            static={isTranscribing} // Prevent closing on outside click if transcribing
            className="relative z-50" // Ensure high z-index
        >
             {/* Backdrop with transition */}
            <div className="fixed inset-0 bg-gray-700/60 transition-opacity duration-300 ease-out data-[closed]:opacity-0" aria-hidden="true" />

            {/* Drawer Panel */}
            <DialogPanel
                className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-tremor-background p-6 shadow-xl transition duration-300 ease-out data-[closed]:translate-x-full"
                // Drag handlers directly on the panel if needed, otherwise keep on specific drop zone
                // onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
            >
                {/* Removed inner Card, DialogPanel is now the container */}
                <Flex justifyContent="between" alignItems="center" className="mb-4">
                     <Title>Upload New Session</Title>
                     <Button
                        variant="light" icon={X}
                        className=" -mr-2 text-tremor-content-subtle hover:text-tremor-content" // Adjust margin for padding
                        onClick={handleCloseAttempt} // Button always attempts close
                        disabled={isTranscribing} // Visually disable button if transcribing
                        aria-label="Close upload panel"
                     />
                 </Flex>
                <Divider className="-mx-6 mb-4"/> {/* Adjust margin */}

                {/* Form content */}
                <div className="flex-grow space-y-4"> {/* Add flex-grow to push button to bottom */}

                    <div
                        className={dropAreaClasses.trim()}
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
                        <UploadCloud className={`mx-auto h-10 w-10 mb-2 ${dragActive ? 'text-tremor-brand' : (modalFile ? 'text-emerald-600' : 'text-tremor-content-subtle')}`} aria-hidden="true"/>
                         <Text>
                            {isTranscribing ? "Processing audio..." :
                             (modalFile ? <>Selected: <span className="font-medium">{modalFile.name}</span></> :
                              (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}
                         </Text>
                         {modalFile && !isTranscribing && (
                            <Button variant="light" size="xs" className="text-rose-600 mt-1 h-auto p-0"
                                onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                    e.stopPropagation();
                                    handleFileSelection(null);
                                }}>
                                 Remove file
                             </Button>
                        )}
                    </div>

                    {/* Use Tremor Grid for form layout */}
                    <Grid numItemsSm={1} numItemsMd={2} className="gap-4 pt-2">
                        <Col>
                            <label htmlFor="clientNameModal" className="tremor-default font-medium text-tremor-content-strong block mb-1">Client Name</label>
                            <TextInput id="clientNameModal" type="text" placeholder="Client's Full Name" value={clientNameInput} onValueChange={setClientNameInput} disabled={isTranscribing} required />
                        </Col>
                        <Col>
                             <label htmlFor="sessionNameModal" className="tremor-default font-medium text-tremor-content-strong block mb-1">Session Name / Title</label>
                             <TextInput id="sessionNameModal" type="text" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onValueChange={setSessionNameInput} disabled={isTranscribing} required />
                        </Col>
                         <Col>
                             <label htmlFor="sessionDateModal" className="tremor-default font-medium text-tremor-content-strong block mb-1">Date</label>
                             {/* Using standard HTML input type="date" styled */}
                             <input
                                id="sessionDateModal"
                                type="date"
                                value={sessionDate}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionDate(e.target.value)}
                                disabled={isTranscribing}
                                required
                                className="block w-full rounded-tremor-default border border-tremor-border bg-tremor-background px-3 py-2 text-tremor-default text-tremor-content shadow-tremor-input focus:outline-none focus:ring-2 focus:ring-tremor-brand focus:border-tremor-brand disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                        </Col>
                        <Col>
                            <label htmlFor="sessionTypeModal" className="tremor-default font-medium text-tremor-content-strong block mb-1">Session Type</label>
                            <Select id="sessionTypeModal" value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={isTranscribing} required >
                                 {SESSION_TYPES.map(type => (
                                     <SelectItem key={type} value={type}>
                                         {type.charAt(0).toUpperCase() + type.slice(1)}
                                     </SelectItem>
                                ))}
                            </Select>
                        </Col>
                        <Col numColSpanMd={2}>
                            <label htmlFor="therapyTypeModal" className="tremor-default font-medium text-tremor-content-strong block mb-1">Therapy Modality</label>
                            <Select id="therapyTypeModal" value={therapyInput} onValueChange={setTherapyInput} disabled={isTranscribing} required >
                                {THERAPY_TYPES.map(type => ( <SelectItem key={type} value={type}>{type}</SelectItem> ))}
                            </Select>
                        </Col>
                    </Grid>
                </div> {/* End flex-grow container */}

                {/* Sticky Footer Area */}
                 <div className="mt-auto pt-4 border-t border-tremor-border -mx-6 px-6">
                    {transcriptionError && (
                        <Text color="rose" className="mb-2 text-center text-sm">
                            Error: {transcriptionError}
                        </Text>
                    )}
                    <Button
                        className="w-full"
                        onClick={handleStartClick}
                        disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || !sessionTypeInput || !therapyInput || isTranscribing}
                        loading={isTranscribing} // Use Tremor loading state
                    >
                        {isTranscribing ? 'Transcribing...' : 'Upload & Transcribe Session'}
                    </Button>
                </div>

            </DialogPanel>
        </Dialog>
    );
}
