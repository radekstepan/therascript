import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, Button, Flex, Text, TextField, Select, Box, Spinner, Strong, Callout } from '@radix-ui/themes';
import { UploadIcon, InfoCircledIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { SESSION_TYPES, THERAPY_TYPES } from '../../constants';
import { getTodayDateString } from '../../helpers';
// Import API functions used in this file
import { uploadSession, fetchSession, fetchTranscript } from '../../api/api';
import type { SessionMetadata } from '../../types';
import { closeUploadModalAtom } from '../../store'; // Keep close action
import { cn } from '../../utils';

interface UploadModalProps {
  isOpen: boolean; // Controlled from outside
}

export function UploadModal({ isOpen }: UploadModalProps) {
  const closeModal = useSetAtom(closeUploadModalAtom);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modalFile, setModalFile] = useState<File | null>(null);
  const [clientNameInput, setClientNameInput] = useState('');
  const [sessionDate, setSessionDate] = useState(getTodayDateString());
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [sessionTypeInput, setSessionTypeInput] = useState(SESSION_TYPES[0]);
  const [therapyInput, setTherapyInput] = useState(THERAPY_TYPES[0]);
  const [formError, setFormError] = useState<string | null>(null);
  // const [transcriptionError, setTranscriptionError] = useState(''); // Replaced by mutation.error

  // Mutation for uploading and transcribing
  const uploadMutation = useMutation({
    mutationFn: ({ file, metadata }: { file: File; metadata: SessionMetadata }) => {
      return uploadSession(file, metadata);
    },
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] }); // Update session list
       // Pre-fetch the new session's data?
      queryClient.prefetchQuery({
          queryKey: ['sessionMeta', newSession.id],
          queryFn: () => fetchSession(newSession.id), // Added import
      });
      queryClient.prefetchQuery({
           queryKey: ['transcript', newSession.id],
           queryFn: () => fetchTranscript(newSession.id), // Added import
      });

      // Navigate to the new session's first chat
      const firstChatId = newSession.chats?.[0]?.id;
      if (firstChatId) {
          navigate(`/sessions/${newSession.id}/chats/${firstChatId}`);
      } else {
          navigate(`/sessions/${newSession.id}`); // Fallback if no chat exists
      }
      closeModal(); // Close modal on success
    },
    onError: (error) => {
      console.error("Upload/Transcription failed:", error);
      // Error state is available via uploadMutation.error
      // No need to set local state unless you want custom messages
      setFormError(`Upload failed: ${error.message}`); // Show error in the modal
    }
  });

  const isTranscribing = uploadMutation.isPending;
  const transcriptionError = uploadMutation.error?.message; // Get error message from mutation state

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
    // Reset mutation state if needed when modal reopens/resets
    uploadMutation.reset();
  }, [uploadMutation]); // Add mutation to dependency array if reset is used within

  useEffect(() => {
    if (isOpen) {
        resetModal();
        // uploadMutation.reset(); // Moved to resetModal
    }
  }, [isOpen, resetModal]);

  const handleDrag = (e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTranscribing) return;
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  // TODO the filetype should come from consts (API?)
  const handleFileSelection = (file: File | null) => {
    // Basic client-side validation
    if (file && file.type === 'audio/mpeg') {
      setModalFile(file);
      setFormError(null); // Clear previous file errors
      if (!sessionNameInput) setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
    } else {
      setModalFile(null);
      // TODO return the supported types
      if (file) setFormError('Invalid file type. Please upload an MP3 audio file.');
      else setFormError(null); // Clear error if file is removed
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
    // Clear previous errors before validation
    setFormError(null);
    uploadMutation.reset(); // Reset mutation error state

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
      try {
        const metadata: SessionMetadata = {
          clientName: clientNameInput.trim(),
          sessionName: sessionNameInput.trim(),
          date: sessionDate,
          sessionType: sessionTypeInput,
          therapy: therapyInput,
        };
        uploadMutation.mutate({ file: modalFile, metadata });
      } catch (err) {
        // Should be caught by mutation's onError
        console.error("Error initiating upload mutation", err);
        setFormError('An unexpected error occurred while starting the upload.');
      }
    } else {
         // This case should be caught by the validation above, but good to have defensively
         setFormError("Please select an MP3 audio file.");
    }
  };

  const handleOpenChange = (open: boolean) => {
    // Prevent closing while transcribing ONLY if triggered by user interaction
    // (e.g., clicking outside, pressing Esc). Programmatic close should still work.
    if (!open && isTranscribing) {
       // Optionally show a toast message here
       console.log("Cannot close modal while transcription is in progress.");
       return; // Prevent Dialog Primitive from closing
    }
    if (!open) {
      closeModal(); // Use the Jotai action atom to set the state
      resetModal(); // Reset form state when closing
    }
    // If opening, isOpen prop handles it via Dialog.Root binding
  };

  const dropAreaClasses = cn(
    "rounded-md p-6 text-center transition-colors duration-200 ease-in-out",
    "flex flex-col items-center justify-center space-y-2 min-h-[10rem]",
    "border-2 border-dashed",
    isTranscribing ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700' : 'cursor-pointer',
    dragActive && !isTranscribing ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : modalFile && !isTranscribing ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : !isTranscribing ? 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500' : ''
  );

  return (
    // Bind Dialog open state to the isOpen prop
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
                    e.stopPropagation(); // Prevent label click handler
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
          {/* Display form validation error OR mutation error */}
          {(formError || transcriptionError) && (
            <Callout.Root color="red" role="alert" size="1" mt="2">
              <Callout.Icon><InfoCircledIcon /></Callout.Icon>
              <Callout.Text>{formError || transcriptionError}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
        <Flex gap="3" mt="5" justify="end">
          {/* Use a Button instead of Dialog.Close to prevent closing while transcribing */}
          <Button type="button" variant="soft" color="gray" onClick={closeModal} disabled={isTranscribing}>Cancel</Button>
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
