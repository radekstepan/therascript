import React, { useState, useRef, useCallback, useEffect } from 'react';
// Import UI components using alias or relative paths
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Label } from './ui/Label';
import { Select } from './ui/Select';
// Import Icons using alias or relative paths
import { UploadCloud, Loader2, X } from './icons/Icons';
// Import constants and helpers
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
// Import Props type
import type { SessionMetadata, UploadModalProps } from '../types';

export function UploadModal({
    isOpen,
    onClose,
    onStartTranscription,
    isTranscribing,
    transcriptionError
}: UploadModalProps) {
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [modalFile, setModalFile] = useState<File | null>(null);
    const [clientNameInput, setClientNameInput] = useState('');
    const [sessionDate, setSessionDate] = useState(getTodayDateString());
    const [sessionNameInput, setSessionNameInput] = useState('');
    const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]); // Default to first type
    const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]); // Default to first type

    const resetModal = useCallback(() => {
        setModalFile(null);
        setClientNameInput('');
        setSessionDate(getTodayDateString());
        setSessionNameInput('');
        setSessionTypeInput(SESSION_TYPES[0]);
        setTherapyInput(THERAPY_TYPES[0]);
        setDragActive(false);
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Clear the file input
        }
    }, []); // No dependencies needed for reset

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            resetModal();
        }
    }, [isOpen, resetModal]);

    const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return; // Prevent interaction during transcription
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleFileSelection = (file: File | null) => {
        if (file && file.type === 'audio/mpeg') { // Basic MP3 check
            setModalFile(file);
            // Pre-fill session name from file name (without extension)
            setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
        } else {
            setModalFile(null); // Clear file if invalid
            if (file) { // Only show alert if an invalid file was actually selected
                 alert('Invalid file type. Please upload an MP3 audio file.');
            }
        }
        // Ensure the hidden input is also cleared so selecting the same file again triggers onChange
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return;
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        if (e.target.files && e.target.files[0]) {
            handleFileSelection(e.target.files[0]);
        } else {
            handleFileSelection(null); // Handle case where selection is cancelled
        }
    };

    const handleUploadAreaClick = () => {
        // Trigger the hidden file input only if no file is selected and not transcribing
        if (!modalFile && !isTranscribing) {
            fileInputRef.current?.click();
        }
    };

    const handleStartClick = () => {
        // Validate all fields before calling the handler
        if (modalFile && clientNameInput.trim() && sessionNameInput.trim() && sessionDate && sessionTypeInput && therapyInput) {
            const metadata: SessionMetadata = {
                clientName: clientNameInput.trim(),
                sessionName: sessionNameInput.trim(),
                date: sessionDate,
                sessionType: sessionTypeInput,
                therapy: therapyInput
            };
            // Call the async function passed from App.tsx
            onStartTranscription(modalFile, metadata);
        } else {
             // Provide more specific feedback if possible
             let missingFields = [];
             if (!modalFile) missingFields.push("Audio File (.mp3)");
             if (!clientNameInput.trim()) missingFields.push("Client Name");
             if (!sessionNameInput.trim()) missingFields.push("Session Name");
             if (!sessionDate) missingFields.push("Date");
             if (!sessionTypeInput) missingFields.push("Session Type");
             if (!therapyInput) missingFields.push("Therapy Modality");

             alert(`Please fill in all required fields: ${missingFields.join(', ')}`);
        }
    };

    // Handle closing the modal (prevent if transcribing)
    const handleCloseAttempt = useCallback(() => {
        if (!isTranscribing) {
             // resetModal(); // Reset is handled by useEffect on open now
            onClose(); // Call the close function passed from App
        }
        // If transcribing, do nothing (modal stays open)
    }, [isTranscribing, onClose]); // Dependencies

    // Close modal on Escape key press, unless transcribing
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleCloseAttempt();
            }
        };
        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
        }
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, handleCloseAttempt]);


    // Return null if the modal is not open
    if (!isOpen) return null;

    // Determine CSS classes for the drag-and-drop area based on state
    // Ensure these specific combinations exist or are handled in global.css
    const dropAreaClasses = `
        border-2 border-dashed rounded-lg p-6 text-center transition-colors
        ${isTranscribing ? 'cursor-not-allowed bg-gray-100 border-gray-300' : 'cursor-pointer'}
        ${dragActive && !isTranscribing ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}
        ${!dragActive && !isTranscribing ? 'hover:border-gray-400' : ''}
        ${modalFile && !isTranscribing ? 'bg-green-50 border-green-500 hover:border-green-600' : ''}
        ${!modalFile && !dragActive && !isTranscribing ? 'bg-gray-50' : ''}
    `;


    return (
        // Modal backdrop
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4"
            onClick={handleCloseAttempt} // Close if clicking backdrop (and not transcribing)
        >
            {/* Modal content */}
            <div
                className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 relative space-y-4"
                onClick={(e) => e.stopPropagation()} // Prevent backdrop click when clicking content
                onDragEnter={handleDrag} // Allow dragging onto the whole modal card
            >
                {/* Close Button */}
                <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 text-gray-500 hover:text-gray-800"
                    onClick={handleCloseAttempt} // Explicit close button
                    disabled={isTranscribing}
                    aria-label="Close upload modal"
                 >
                    <X size={20} />
                </Button>

                <h2 className="text-xl font-semibold mb-4 text-center">Upload New Session</h2>

                {/* Drag and Drop Area */}
                <div
                    className={dropAreaClasses.trim()} // Apply dynamic classes
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                    onClick={handleUploadAreaClick} // Click to browse files
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/mpeg" // Only allow MP3 files
                        className="hidden" // Hide the default input
                        onChange={handleFileChange}
                        disabled={!!modalFile || isTranscribing} // Disable if file selected or transcribing
                    />
                    <UploadCloud className={`mx-auto h-10 w-10 mb-2 ${dragActive ? 'text-blue-600' : (modalFile ? 'text-green-600' : 'text-gray-400')}`} />
                    <p className="text-sm text-gray-600">
                        {isTranscribing ? "Processing audio..." :
                         (modalFile ? `Selected: ${modalFile.name}` :
                          (dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"))}
                    </p>
                    {/* Button to change/remove the selected file */}
                    {modalFile && !isTranscribing && (
                        <Button
                            variant="link"
                            size="sm"
                            className="text-xs text-red-600 mt-1 h-auto p-0" // Minimal styling for link button
                            onClick={(e: any) => {
                                e.stopPropagation(); // Prevent triggering upload area click
                                setModalFile(null);
                                setSessionNameInput(''); // Clear auto-filled name
                                handleFileSelection(null); // Reset state
                            }}
                        >
                            Change file
                        </Button>
                    )}
                </div>

                {/* Metadata Input Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="clientNameModal" className="mb-1 block">Client Name</Label>
                        <Input
                            id="clientNameModal"
                            type="text"
                            placeholder="Client's Full Name"
                            value={clientNameInput}
                            onChange={(e: any) => setClientNameInput(e.target.value)}
                            disabled={isTranscribing}
                            required // HTML validation
                         />
                    </div>
                    <div>
                        <Label htmlFor="sessionNameModal" className="mb-1 block">Session Name / Title</Label>
                        <Input
                            id="sessionNameModal"
                            type="text"
                            placeholder="e.g., Weekly Check-in"
                            value={sessionNameInput}
                            onChange={(e: any) => setSessionNameInput(e.target.value)}
                            disabled={isTranscribing}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="sessionDateModal" className="mb-1 block">Date</Label>
                        <Input
                            id="sessionDateModal"
                            type="date"
                            value={sessionDate}
                            onChange={(e: any) => setSessionDate(e.target.value)}
                            disabled={isTranscribing}
                            required
                        />
                    </div>
                    <div>
                        <Label htmlFor="sessionTypeModal" className="mb-1 block">Session Type</Label>
                        <Select
                             id="sessionTypeModal"
                             value={sessionTypeInput}
                             onChange={(e: any) => setSessionTypeInput(e.target.value)}
                             disabled={isTranscribing}
                             required
                        >
                             {SESSION_TYPES.map(type => (
                                <option key={type} value={type}>
                                    {/* Capitalize first letter */}
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </option>
                             ))}
                        </Select>
                    </div>
                    <div className="md:col-span-2">
                        <Label htmlFor="therapyTypeModal" className="mb-1 block">Therapy Modality</Label>
                        <Select
                            id="therapyTypeModal"
                            value={therapyInput}
                            onChange={(e: any) => setTherapyInput(e.target.value)}
                            disabled={isTranscribing}
                            required
                        >
                            {THERAPY_TYPES.map(type => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </Select>
                    </div>
                </div>

                {/* Submit Button */}
                <Button
                    className="w-full" // Make button full width
                    onClick={handleStartClick}
                    disabled={!modalFile || !clientNameInput.trim() || !sessionNameInput.trim() || !sessionDate || !sessionTypeInput || !therapyInput || isTranscribing}
                >
                    {isTranscribing ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Transcribing...
                        </>
                    ) : (
                        'Upload & Transcribe Session'
                    )}
                </Button>

                {/* Error Message Area */}
                {transcriptionError && (
                    <div className="mt-2 text-center text-red-600 text-sm">
                        Error: {transcriptionError}
                    </div>
                )}
            </div>
        </div>
    );
}
