// src/components/UploadModal.tsx
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { Dialog, Button, Flex, Text, TextField, Select, Box, Spinner, Strong, Callout, Heading } from '@radix-ui/themes';
import { UploadIcon, Cross1Icon, InfoCircledIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../constants';
import { getTodayDateString } from '../helpers';
import { uploadSession } from '../api/api';
import type { SessionMetadata, UploadModalProps } from '../types';
import { closeUploadModalAtom, isTranscribingAtom, transcriptionErrorAtom } from '../store';
import { cn } from '../utils';

export function UploadModal({ isOpen, isTranscribing, transcriptionError }: UploadModalProps) {
  const closeModalAction = useSetAtom(closeUploadModalAtom);
  const setIsTranscribing = useSetAtom(isTranscribingAtom);
  const setTranscriptionError = useSetAtom(transcriptionErrorAtom);
  const navigate = useNavigate();

  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [clientNameInput, setClientNameInput] = useState('');
  const [sessionDate, setSessionDate] = useState(getTodayDateString());
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]);
  const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]);
  const [formError, setFormError] = useState<string | null>(null);

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

  useEffect(() => {
    if (isOpen) resetModal();
  }, [isOpen, resetModal]);

  const handleDrag = (e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTranscribing) return;
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleFileSelection = (file: File | null) => {
    if (file && file.type === 'audio/mpeg') {
      setModalFile(file);
      setFormError(null);
      if (!sessionNameInput) setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
    } else {
      setModalFile(null);
      if (file) setFormError('Invalid file type. Please upload an MP3 audio file.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTranscribing) return;
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelection(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    handleFileSelection(e.target.files?.[0] ?? null);
  };

  const handleUploadAreaClick = () => {
    if (!isTranscribing) fileInputRef.current?.click();
  };

  const handleStartClick = async () => {
    setFormError(null);
    let missingFields = [];
    if (!modalFile) missingFields.push("Audio File (.mp3)");
    if (!clientNameInput.trim()) missingFields.push("Client Name");
    if (!sessionNameInput.trim()) missingFields.push("Session Name");
    if (!sessionDate) missingFields.push("Date");

    if (missingFields.length > 0) {
      setFormError(`Please fill in all required fields: ${missingFields.join(', ')}`);
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
      try {
        setIsTranscribing(true);
        setTranscriptionError('');
        const newSession = await uploadSession(modalFile, metadata);
        navigate(`/sessions/${newSession.id}/chats/${newSession.chats[0].id}`);
        closeModalAction();
      } catch (err) {
        setTranscriptionError('Failed to upload and transcribe session.');
      } finally {
        setIsTranscribing(false);
      }
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && !isTranscribing) {
      closeModalAction();
      resetModal();
    }
  };

  const dropAreaClasses = cn(
    "rounded-md p-6 text-center transition-colors duration-200 ease-in-out",
    "flex flex-col items-center justify-center space-y-2 min-h-[10rem]",
    "border-2 border-dashed",
    isTranscribing ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700' : 'cursor-pointer',
    dragActive && !isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : modalFile && !isTranscribing ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : !isTranscribing ? 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500' : ''
  );

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Content style={{ maxWidth: 550 }}>
        <Dialog.Title>Upload New Session</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Add session details and upload an MP3 audio file to start analysis.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <label
            htmlFor="audio-upload-input"
            className={dropAreaClasses}
            onClick={handleUploadAreaClick}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            aria-disabled={isTranscribing}
            aria-label={modalFile ? `Selected file: ${modalFile.name}. Click to change.` : "Drag and drop MP3 file or click to upload"}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg"
              className="hidden"
              id="audio-upload-input"
              onChange={handleFileChange}
              disabled={isTranscribing}
            />
            <Flex direction="column" align="center" gap="1">
              {modalFile && !isTranscribing ? (
                <CheckCircledIcon width="32" height="32" className="text-emerald-600" />
              ) : isTranscribing ? (
                <Spinner size="3" />
              ) : (
                <UploadIcon width="32" height="32" className={cn(dragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500')} />
              )}
              <Text size="2" color="gray">
                {isTranscribing ? "Processing audio..." : modalFile ? <>Selected: <Strong>{modalFile.name}</Strong></> : dragActive ? "Drop MP3 file here" : "Drag & drop MP3 file or click"}
              </Text>
              {modalFile && !isTranscribing && (
                <Button
                  variant="ghost"
                  color="red"
                  size="1"
                  mt="1"
                  highContrast
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFileSelection(null);
                  }}
                  aria-label="Remove selected file"
                >
                  Remove file
                </Button>
              )}
            </Flex>
          </label>
          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">Session Name / Title</Text>
              <TextField.Root
                size="2"
                placeholder="e.g., Weekly Check-in"
                value={sessionNameInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionNameInput(e.target.value)}
                disabled={isTranscribing}
                required
              />
            </label>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <Text as="div" size="2" mb="1" weight="medium">Client Name</Text>
                <TextField.Root
                  size="2"
                  placeholder="Client's Full Name"
                  value={clientNameInput}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setClientNameInput(e.target.value)}
                  disabled={isTranscribing}
                  required
                />
              </label>
              <label>
                <Text as="div" size="2" mb="1" weight="medium">Date</Text>
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionDate(e.target.value)}
                  disabled={isTranscribing}
                  required
                  className={cn(
                    "flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]",
                    "h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                />
              </label>
            </Box>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <Text as="div" size="2" mb="1" weight="medium">Session Type</Text>
                <Select.Root value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={isTranscribing} required size="2">
                  <Select.Trigger placeholder="Select type..." style={{ width: '100%' }} />
                  <Select.Content>
                    {SESSION_TYPES.map((type) => (
                      <Select.Item key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label>
                <Text as="div" size="2" mb="1" weight="medium">Therapy Modality</Text>
                <Select.Root value={therapyInput} onValueChange={setTherapyInput} disabled={isTranscribing} required size="2">
                  <Select.Trigger placeholder="Select therapy..." style={{ width: '100%' }} />
                  <Select.Content>
                    {THERAPY_TYPES.map((type) => (<Select.Item key={type} value={type}>{type}</Select.Item>))}
                  </Select.Content>
                </Select.Root>
              </label>
            </Box>
          </Flex>
          {(formError || transcriptionError) && (
            <Callout.Root color="red" role="alert" size="1" mt="2">
              <Callout.Icon><InfoCircledIcon /></Callout.Icon>
              <Callout.Text>{formError || transcriptionError}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button type="button" variant="soft" color="gray" disabled={isTranscribing}>Cancel</Button>
          </Dialog.Close>
          <Button type="button" onClick={handleStartClick} disabled={!modalFile || isTranscribing}>
            {isTranscribing ? (
              <><Spinner size="2" /><Text ml="2">Transcribing...</Text></>
            ) : (
              'Upload & Transcribe'
            )}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
