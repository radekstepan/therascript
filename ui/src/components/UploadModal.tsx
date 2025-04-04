import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

// Import UI components
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
// Import Icons
import { UploadCloud, Loader2, X } from './icons/Icons';
// Import constants and helpers
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
// Import Types
import type { SessionMetadata } from '../types';
// Import Atoms
import {
    closeUploadModalAtom,
    handleStartTranscriptionAtom,
    // Removed isOpen, isTranscribing, transcriptionError from imports
} from '../store'; // Adjust path

// Props type UploadModalProps is removed

// Add props back for state read from App.tsx (or read directly via useAtomValue)
interface UploadModalDisplayProps {
    isOpen: boolean;
    isTranscribing: boolean;
    transcriptionError: string;
}


export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalDisplayProps) { // Keep display props
    // Get setters for actions
    const closeModal = useSetAtom(closeUploadModalAtom);
    const startTranscription = useSetAtom(handleStartTranscriptionAtom);

    // --- Local UI State (useState is appropriate here) ---
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
        if (isOpen) {
            resetModal(); // Reset local form state when modal becomes visible
        }
    }, [isOpen, resetModal]);


    // --- Event Handlers (Mostly managing local state or triggering atom actions) ---

    const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return;
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    };

    const handleFileSelection = (file: File | null) => {
         if (file && file.type === 'audio/mpeg') {
            setModalFile(file);
            setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
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

    const handleStartClick = () => {
        if (modalFile && clientNameInput.trim() && sessionNameInput.trim() && sessionDate && sessionTypeInput && therapyInput) {
            const metadata: SessionMetadata = {
                clientName: clientNameInput.trim(), sessionName: sessionNameInput.trim(),
                date: sessionDate, sessionType: sessionTypeInput, therapy: therapyInput
            };
            // Call the Jotai action atom
            startTranscription({ file: modalFile, metadata });
        } else {
             let missingFields = [];
             if (!modalFile) missingFields.push("Audio File (.mp3)");
             if (!clientNameInput.trim()) missingFields.push("Client Name");
             if (!sessionNameInput.trim()) missingFields.push("Session Name");
             // ... etc ...
             alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
    };

    // Use the Jotai action atom for closing
    const handleCloseAttempt = useCallback(() => {
         closeModal(); // This atom's logic already checks isTranscribing
    }, [closeModal]);

    // Close modal on Escape key
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleCloseAttempt();
        };
        if (isOpen) document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleCloseAttempt]);


    // Return null if the modal is not open (controlled by prop from App -> atom value)
    if (!isOpen) return null;

    // --- Dynamic classes (no change needed) ---
    const dropAreaClasses = `...`; // Keep existing logic based on props/local state


    return (
        // Modal backdrop
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4"
            onClick={handleCloseAttempt} // Uses atom action
        >
            {/* Modal content */}
            <div
                className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative space-y-4"
                onClick={(e) => e.stopPropagation()}
                onDragEnter={handleDrag}
            >
                {/* Close Button */}
                <Button
                    variant="ghost" size="icon"
                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-800"
                    onClick={handleCloseAttempt} // Uses atom action
                    disabled={isTranscribing} // Use prop value
                    aria-label="Close upload modal"
                 >
                    <X size={20} />
                </Button>

                <h2 className="text-xl font-semibold mb-4 text-center">Upload New Session</h2>

                {/* Drag and Drop Area (uses local state + isTranscribing prop) */}
                <div
                    className={dropAreaClasses.trim()}
                    onDragEnter={handleDrag} onDragLeave={handleDrag}
                    onDragOver={handleDrag} onDrop={handleDrop}
                    onClick={handleUploadAreaClick}
                >
                     {/* ... unchanged inner content using local state (modalFile, dragActive) and prop (isTranscribing) ... */}
                     <input
                        ref={fileInputRef} type="file" accept="audio/mpeg" className="hidden"
                        onChange={handleFileChange}
                        disabled={!!modalFile || isTranscribing}
                    />
                    <UploadCloud className={`mx-auto h-10 w-10 mb-2 ${dragActive ? 'text-blue-600' : (modalFile ? 'text-green-600' : 'text-gray-400')}`} />
                     <p className="text-sm text-gray-600">
                        {isTranscribing ? "Processing audio..." :
                         (modalFile ? `Selected: ${modalFile.name}` :
                          (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}
                    </p>
                     {modalFile && !isTranscribing && (
                        <Button variant="link" size="sm" className="text-xs text-red-600 mt-1 h-auto p-0"
                            onClick={(e: any) => {
                                e.stopPropagation();
                                setModalFile(null); // Local state
                                setSessionNameInput(''); // Local state
                                // handleFileSelection(null); // No need to call this again
                            }} > Change file </Button>
                    )}
                </div>

                {/* Metadata Input Fields (uses local state) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="clientNameModal" className="mb-1 block">Client Name</Label>
                        <Input id="clientNameModal" type="text" placeholder="Client's Full Name" value={clientNameInput} onChange={(e: any) => setClientNameInput(e.target.value)} disabled={isTranscribing} required />
                    </div>
                    <div>
                         <Label htmlFor="sessionNameModal" className="mb-1 block">Session Name / Title</Label>
                         <Input id="sessionNameModal" type="text" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onChange={(e: any) => setSessionNameInput(e.target.value)} disabled={isTranscribing} required />
                    </div>
                     <div>
                         <Label htmlFor="sessionDateModal" className="mb-1 block">Date</Label>
                         <Input id="sessionDateModal" type="date" value={sessionDate} onChange={(e: any) => setSessionDate(e.target.value)} disabled={isTranscribing} required />
                    </div>
                    <div>
                        <Label htmlFor="sessionTypeModal" className="mb-1 block">Session Type</Label>
                        <Select id="sessionTypeModal" value={sessionTypeInput} onChange={(e: any) => setSessionTypeInput(e.target.value)} disabled={isTranscribing} required >
                             {SESSION_TYPES.map(type => ( <option key={type} value={type}> {type.charAt(0).toUpperCase() + type.slice(1)} </option> ))}
                        </Select>
                    </div>
                    <div className="md:col-span-2">
                        <Label htmlFor="therapyTypeModal" className="mb-1 block">Therapy Modality</Label>
                        <Select id="therapyTypeModal" value={therapyInput} onChange={(e: any) => setTherapyInput(e.target.value)} disabled={isTranscribing} required >
                            {THERAPY_TYPES.map(type => ( <option key={type} value={type}>{type}</option> ))}
                        </Select>
                    </div>
                </div>

                {/* Submit Button (triggers atom action) */}
                <Button
                    className="w-full"
                    onClick={handleStartClick} // Triggers startTranscription atom
                    disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || !sessionTypeInput || !therapyInput || isTranscribing}
                >
                    {isTranscribing ? ( <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Transcribing...</> ) : ( 'Upload & Transcribe Session' )}
                </Button>

                {/* Error Message Area (uses prop) */}
                {transcriptionError && (
                    <div className="mt-2 text-center text-red-600 text-sm">
                        Error: {transcriptionError}
                    </div>
                )}
            </div>
        </div>
    );
}
