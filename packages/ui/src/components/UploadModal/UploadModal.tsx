// packages/ui/src/components/UploadModal/UploadModal.tsx
/* src/components/UploadModal/UploadModal.tsx */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, Button, Flex, Text, TextField, Select, Box, Spinner, Strong, Callout, Progress } from '@radix-ui/themes';
import {
    UploadIcon,
    InfoCircledIcon,
    CheckCircledIcon,
    Cross2Icon,
    ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import {
    SESSION_TYPES,
    THERAPY_TYPES,
    ALLOWED_AUDIO_MIME_TYPES,
    ALLOWED_AUDIO_EXTENSIONS,
} from '../../constants';
import { getTodayDateString } from '../../helpers';
import { uploadSession, fetchTranscriptionStatus, finalizeSession } from '../../api/api';
import type { SessionMetadata } from '../../types';
import { closeUploadModalAtom } from '../../store';
import { cn } from '../../utils';
import type { UITranscriptionStatus } from '../../api/api';

interface UploadModalProps {
  isOpen: boolean;
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

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);

  // --- Mutations and Queries (remain the same) ---
  const uploadMutation = useMutation({
    mutationFn: ({ file, metadata }: { file: File; metadata: SessionMetadata }) => uploadSession(file, metadata),
    onSuccess: (data) => { console.log(`[UploadModal] Upload accepted. SessionID: ${data.sessionId}, JobID: ${data.jobId}`); setCurrentSessionId(data.sessionId); setCurrentJobId(data.jobId); setFormError(null); },
    onError: (error) => { console.error("Upload failed:", error); setFormError(`Upload failed: ${error.message}`); setCurrentJobId(null); setCurrentSessionId(null); }
  });
  const { data: transcriptionStatus, error: pollingError } = useQuery<UITranscriptionStatus, Error>({
    queryKey: ['transcriptionStatus', currentJobId],
    queryFn: () => { if (!currentJobId) throw new Error("No Job ID to poll"); return fetchTranscriptionStatus(currentJobId); },
    enabled: !!currentJobId,
    refetchInterval: (query) => { const d = query.state.data; return (d?.status === 'completed' || d?.status === 'failed' || d?.status === 'canceled') ? false : 2000; },
    refetchIntervalInBackground: false, refetchOnWindowFocus: false, retry: (c, e) => e.message.includes('not found') ? false : c < 3,
  });
  const finalizeMutation = useMutation({
    mutationFn: () => { if (!currentSessionId) throw new Error("No Session ID to finalize"); return finalizeSession(currentSessionId); },
    onSuccess: (finalizedSession) => { console.log(`[UploadModal] Finalization successful for SessionID: ${finalizedSession.id}`); queryClient.invalidateQueries({ queryKey: ['sessions'] }); const f = finalizedSession.chats?.[0]?.id; if (f) { navigate(`/sessions/${finalizedSession.id}/chats/${f}`); } else { navigate(`/sessions/${finalizedSession.id}`); } closeModal(); },
    onError: (error) => { console.error("Finalization failed:", error); setFormError(`Failed to finalize session: ${error.message}. Please check server logs.`); }
  });
  useEffect(() => {
      if (transcriptionStatus?.status === 'completed' && !finalizeMutation.isPending && !finalizeMutation.isSuccess) { console.log(`[UploadModal] Transcription completed for JobID: ${currentJobId}. Triggering finalization...`); finalizeMutation.mutate(); }
  }, [transcriptionStatus, currentJobId, finalizeMutation, finalizeMutation.isPending, finalizeMutation.isSuccess]);

  // --- Combined State (remains the same) ---
  const isUploading = uploadMutation.isPending;
  const isPolling = !!currentJobId && !transcriptionStatus && !pollingError;
  const isProcessing = transcriptionStatus?.status === 'queued' || transcriptionStatus?.status === 'processing';
  const isFinalizing = finalizeMutation.isPending;
  const hasFailed = transcriptionStatus?.status === 'failed' || transcriptionStatus?.status === 'canceled' || !!pollingError || finalizeMutation.isError;
  const overallIsLoading = isUploading || isPolling || isProcessing || isFinalizing;
  const overallError = formError || pollingError?.message || transcriptionStatus?.error || finalizeMutation.error?.message;

  // --- Event Handlers ---
  const resetModal = useCallback(() => {
    setModalFile(null); setClientNameInput(''); setSessionDate(getTodayDateString()); setSessionNameInput(''); setSessionTypeInput(SESSION_TYPES[0]); setTherapyInput(THERAPY_TYPES[0]); setDragActive(false); setFormError(null); setCurrentJobId(null); setCurrentSessionId(null);
    if (fileInputRef.current) fileInputRef.current.value = ''; // Keep clearing on reset
    uploadMutation.reset(); finalizeMutation.reset(); if(currentJobId) queryClient.removeQueries({ queryKey: ['transcriptionStatus', currentJobId] });
  }, [uploadMutation, finalizeMutation, queryClient, currentJobId]);

  const handleDrag = (e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation(); if (overallIsLoading) return; if (e.type === "dragenter" || e.type === "dragover") setDragActive(true); else if (e.type === "dragleave") setDragActive(false);
  };

  const handleFileSelection = (file: File | null) => {
    if (file && ALLOWED_AUDIO_MIME_TYPES.includes(file.type)) {
      setModalFile(file);
      setFormError(null);
      if (!sessionNameInput) setSessionNameInput(file.name.replace(/\.[^/.]+$/, ""));
    } else {
      setModalFile(null);
      if (file) setFormError(`Invalid file type. Please upload an audio file (${ALLOWED_AUDIO_EXTENSIONS.join(', ')}).`);
      else setFormError(null);
    }
    // --- Clear input value *after* state update, wrapped in requestAnimationFrame ---
    requestAnimationFrame(() => {
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    });
    // --- End Change ---
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement | HTMLLabelElement>) => {
    e.preventDefault(); e.stopPropagation(); if (overallIsLoading) return; setDragActive(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelection(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    // handleFileSelection is called when the input value changes
    handleFileSelection(e.target.files?.[0] ?? null);
  };

  // Remove handleUploadAreaClick as we rely on the label's default behavior

  const handleStartClick = async () => {
    setFormError(null); uploadMutation.reset(); finalizeMutation.reset();
    let missingFields = []; if (!modalFile) missingFields.push(`Audio File (${ALLOWED_AUDIO_EXTENSIONS.join(', ')})`); if (!clientNameInput.trim()) missingFields.push("Client Name"); if (!sessionNameInput.trim()) missingFields.push("Session Name"); if (!sessionDate) missingFields.push("Date");
    if (missingFields.length > 0) { setFormError(`Please fill in all required fields: ${missingFields.join(', ')}`); return; }
    if (modalFile) { try { const metadata: SessionMetadata = { clientName: clientNameInput.trim(), sessionName: sessionNameInput.trim(), date: sessionDate, sessionType: sessionTypeInput, therapy: therapyInput, }; uploadMutation.mutate({ file: modalFile, metadata }); } catch (err) { console.error("Error initiating upload mutation", err); setFormError('An unexpected error occurred while starting the upload.'); } }
    else { setFormError(`Please select an audio file (${ALLOWED_AUDIO_EXTENSIONS.join(', ')}).`); }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && overallIsLoading && !hasFailed) { console.log("Cannot close modal while processing."); return; }
    if (!open) { closeModal(); resetModal(); }
  };

  // --- Styling and Progress Text (remain the same) ---
  const dropAreaClasses = cn( "rounded-md p-6 text-center transition-colors duration-200 ease-in-out", "flex flex-col items-center justify-center space-y-2 min-h-[10rem]", "border-2 border-dashed", overallIsLoading ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700' : 'cursor-pointer', dragActive && !overallIsLoading ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : modalFile && !overallIsLoading ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20' : !overallIsLoading ? 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500' : '' );
  const getProgressText = () => { if (isUploading) return "Uploading file..."; if (isPolling) return "Waiting for transcription to start..."; if (transcriptionStatus?.status === 'queued') return "Transcription queued..."; if (transcriptionStatus?.status === 'processing') return `Transcribing (${transcriptionStatus.progress?.toFixed(0) ?? 0}%)`; if (isFinalizing) return "Finalizing session..."; if (hasFailed) return "Processing Failed"; if (transcriptionStatus?.status === 'completed' && !isFinalizing) return "Transcription Complete!"; return modalFile ? <>Selected: <Strong>{modalFile.name}</Strong></> : dragActive ? `Drop file (${ALLOWED_AUDIO_EXTENSIONS.join(', ')}) here` : `Drag & drop or click to choose file`; };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Content style={{ maxWidth: 550 }}>
        <Dialog.Title>Upload New Session</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Add session details and upload an audio file ({ALLOWED_AUDIO_EXTENSIONS.join(', ')}) to start analysis.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          {/* --- Upload Area using Label --- */}
          <label
            htmlFor="audio-upload-input" // Critical for label behavior
            className={dropAreaClasses}
            // REMOVED onClick handler - rely on default label behavior
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            aria-disabled={overallIsLoading}
            aria-label={modalFile ? `Selected file: ${modalFile.name}. Click to change.` : `Drag and drop audio file (${ALLOWED_AUDIO_EXTENSIONS.join(', ')}) or click here to upload`}
          >
            {/* Hidden Input */}
            <input
              ref={fileInputRef} type="file" accept={ALLOWED_AUDIO_MIME_TYPES.join(',')}
              className="hidden" id="audio-upload-input" onChange={handleFileChange} disabled={overallIsLoading}
            />
            {/* Internal Content */}
            <Flex direction="column" align="center" gap="1">
              {/* Icon logic remains */}
              {hasFailed ? <ExclamationTriangleIcon width="32" height="32" className="text-red-600" /> :
               overallIsLoading ? <Spinner size="3" /> :
               modalFile ? <CheckCircledIcon width="32" height="32" className="text-emerald-600" /> :
               <UploadIcon width="32" height="32" className={cn(dragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500')} />
              }
              {/* Progress text remains */}
              <Text size="2" color="gray" mt="2">{getProgressText()}</Text>
              {/* Progress Bar remains */}
              {isProcessing && transcriptionStatus?.progress !== undefined && ( <Box width="100%" mt="2"> <Progress value={transcriptionStatus.progress} size="2" /> </Box> )}

              {/* Conditional "Remove File" Button */}
               {modalFile && !overallIsLoading && !hasFailed && (
                <Box mt="3" onClick={(e) => e.stopPropagation()}> {/* Prevent click on button container from triggering label */}
                    <Button
                        type="button" // Ensure it doesn't submit form
                        variant="ghost" color="red" size="1" highContrast
                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                            e.preventDefault(); // Prevent default button action
                            handleFileSelection(null); // Just clear the state
                            // Clearing input value now happens in handleFileSelection via requestAnimationFrame
                        }} aria-label="Remove selected file">Remove File</Button>
                 </Box>
               )}
            </Flex>
          </label>
          {/* --- End Upload Area --- */}

          {/* Metadata Fields (remain the same) */}
          <Flex direction="column" gap="3"> {/* ... */}
            <label> <Text as="div" size="2" mb="1" weight="medium">Session Name / Title</Text> <TextField.Root size="2" placeholder="e.g., Weekly Check-in" value={sessionNameInput} onChange={(e) => setSessionNameInput(e.target.value)} disabled={overallIsLoading} required /> </label>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3"> <label> <Text as="div" size="2" mb="1" weight="medium">Client Name</Text> <TextField.Root size="2" placeholder="Client's Full Name" value={clientNameInput} onChange={(e) => setClientNameInput(e.target.value)} disabled={overallIsLoading} required /> </label> <label> <Text as="div" size="2" mb="1" weight="medium">Date</Text> <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} disabled={overallIsLoading} required className={cn("flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]", "h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50")} /> </label> </Box>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3"> <label> <Text as="div" size="2" mb="1" weight="medium">Session Type</Text> <Select.Root value={sessionTypeInput} onValueChange={setSessionTypeInput} disabled={overallIsLoading} required size="2"> <Select.Trigger placeholder="Select type..." style={{ width: '100%' }} /> <Select.Content> {SESSION_TYPES.map((type) => (<Select.Item key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</Select.Item>))} </Select.Content> </Select.Root> </label> <label> <Text as="div" size="2" mb="1" weight="medium">Therapy Modality</Text> <Select.Root value={therapyInput} onValueChange={setTherapyInput} disabled={overallIsLoading} required size="2"> <Select.Trigger placeholder="Select therapy..." style={{ width: '100%' }} /> <Select.Content> {THERAPY_TYPES.map((type) => (<Select.Item key={type} value={type}>{type}</Select.Item>))} </Select.Content> </Select.Root> </label> </Box>
          </Flex>
          {/* Error display remains the same */}
          {overallError && ( <Callout.Root color="red" role="alert" size="1" mt="2"> <Callout.Icon><InfoCircledIcon /></Callout.Icon> <Callout.Text>{overallError}</Callout.Text> </Callout.Root> )}
        </Flex>
        {/* Footer buttons remain the same */}
        <Flex gap="3" mt="5" justify="end"> {/* ... */}
          <Button type="button" variant="soft" color="gray" onClick={() => handleOpenChange(false)} disabled={overallIsLoading && !hasFailed}> <Cross2Icon /> {overallIsLoading && !hasFailed ? 'Processing...' : 'Cancel'} </Button>
           {!currentJobId && ( <Button type="button" onClick={handleStartClick} disabled={!modalFile || isUploading}> {isUploading ? ( <><Spinner size="2" /><Text ml="2">Uploading...</Text></> ) : ( <> <UploadIcon /> Upload & Start </> )} </Button> )}
            {hasFailed && ( <Button type="button" color="orange" onClick={resetModal}> Retry Upload </Button> )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
