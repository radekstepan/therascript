// src/hooks/useUploadModal.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom, useAtomValue } from 'jotai'; // Removed useAtom as state is read-only or set via actions
import { useNavigate } from 'react-router-dom';
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
import {
    // Import from main store index
    isUploadModalOpenAtom,
    isTranscribingAtom,
    transcriptionErrorAtom,
    closeUploadModalActionAtom,
    uploadAndTranscribeActionAtom
} from '../store'; // Adjust path if needed
import type { SessionMetadata } from '../types';

export function useUploadModal() {
    const navigate = useNavigate();

    // Global state atoms
    const isOpen = useAtomValue(isUploadModalOpenAtom);
    const isTranscribing = useAtomValue(isTranscribingAtom);
    const transcriptionError = useAtomValue(transcriptionErrorAtom);
    const closeModal = useSetAtom(closeUploadModalActionAtom);
    const uploadAndTranscribe = useSetAtom(uploadAndTranscribeActionAtom);

    // Local form state
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [modalFile, setModalFile] = useState<File | null>(null);
    const [clientNameInput, setClientNameInput] = useState('');
    const [sessionDate, setSessionDate] = useState(getTodayDateString());
    const [sessionNameInput, setSessionNameInput] = useState('');
    const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]);
    const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]);
    const [formError, setFormError] = useState<string | null>(null); // Local validation errors

    const resetModal = useCallback(() => {
        setModalFile(null);
        setClientNameInput('');
        setSessionDate(getTodayDateString());
        setSessionNameInput('');
        setSessionTypeInput(SESSION_TYPES[0]);
        setTherapyInput(THERAPY_TYPES[0]);
        setDragActive(false);
        setFormError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            resetModal();
        }
    }, [isOpen, resetModal]);

    const handleDrag = useCallback((e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return;
        if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
        else if (e.type === "dragleave") setDragActive(false);
    }, [isTranscribing]);

    const handleFileSelection = useCallback((file: File | null) => {
        if (file && file.type === 'audio/mpeg') {
            setModalFile(file);
            setFormError(null); // Clear file type error if valid
            // Auto-fill session name if empty
            if (!sessionNameInput) setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
        } else {
            setModalFile(null);
            if (file) setFormError('Invalid file type. Please upload an MP3 audio file.');
            else setFormError(null); // Clear error if file removed
        }
        if (fileInputRef.current) fileInputRef.current.value = ''; // Reset file input
    }, [sessionNameInput]); // Dependency added

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (isTranscribing) return;
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    }, [isTranscribing, handleFileSelection]);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault();
        handleFileSelection(e.target.files?.[0] ?? null);
    }, [handleFileSelection]);

    const handleUploadAreaClick = useCallback(() => {
        if (!isTranscribing) fileInputRef.current?.click();
    }, [isTranscribing]);

    const handleRemoveFileClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
         e.preventDefault();
         e.stopPropagation();
         handleFileSelection(null);
    }, [handleFileSelection]);

    const handleStartUpload = useCallback(async () => {
        setFormError(null); // Clear previous form errors
        let missingFields = [];
        if (!modalFile) missingFields.push("Audio File (.mp3)");
        if (!clientNameInput.trim()) missingFields.push("Client Name");
        if (!sessionNameInput.trim()) missingFields.push("Session Name");
        if (!sessionDate) missingFields.push("Date");
        // Basic validation for selects (should always have a value)
        if (!sessionTypeInput) missingFields.push("Session Type");
        if (!therapyInput) missingFields.push("Therapy Type");

        if (missingFields.length > 0) {
            setFormError(`Please fill in required fields: ${missingFields.join(', ')}`);
            return;
        }

        if (modalFile) {
            const metadata: SessionMetadata = {
                clientName: clientNameInput.trim(),
                sessionName: sessionNameInput.trim(),
                date: sessionDate,
                sessionType: sessionTypeInput,
                therapy: therapyInput,
            };

            const newSession = await uploadAndTranscribe({ file: modalFile, metadata });

            if (newSession) {
                // Navigate on success
                const firstChatId = newSession.chats?.[0]?.id;
                if (firstChatId !== undefined) {
                    navigate(`/sessions/${newSession.id}/chats/${firstChatId}`);
                } else {
                    // Fallback if backend doesn't create initial chat immediately
                    // Or if newSession.chats is empty/null
                    navigate(`/sessions/${newSession.id}`);
                }
                 // Closing is handled by the action atom on success
            }
            // Error handling is done within the action atom (sets transcriptionErrorAtom)
        }
    }, [
        modalFile, clientNameInput, sessionNameInput, sessionDate, sessionTypeInput, therapyInput,
        uploadAndTranscribe, navigate
    ]);

     const handleOpenChange = useCallback((open: boolean) => {
        if (!open) {
            closeModal(); // Attempt to close (action atom handles transcription check)
            // Resetting is handled by useEffect on open
        }
    }, [closeModal]);

    // Expose handleFileChange so the input can use it
    return {
        isOpen,
        isTranscribing,
        error: formError || transcriptionError, // Combine local and global errors
        dragActive,
        modalFile,
        clientNameInput, setClientNameInput,
        sessionDate, setSessionDate,
        sessionNameInput, setSessionNameInput,
        sessionTypeInput, setSessionTypeInput,
        therapyInput, setTherapyInput,
        fileInputRef,
        handleDrag,
        handleDrop,
        handleFileChange, // <-- Expose this
        handleUploadAreaClick,
        handleRemoveFileClick,
        handleStartUpload,
        handleOpenChange,
        SESSION_TYPES, // Pass constants through
        THERAPY_TYPES,
    };
}
