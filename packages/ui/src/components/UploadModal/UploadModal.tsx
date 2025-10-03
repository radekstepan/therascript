/* packages/ui/src/components/UploadModal/UploadModal.tsx */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  Dialog,
  Button,
  Flex,
  Text,
  TextField,
  Select,
  Box,
  Spinner,
  Strong,
  Callout,
  Progress,
  ScrollArea,
} from '@radix-ui/themes';
import {
  UploadIcon,
  InfoCircledIcon,
  CheckCircledIcon,
  Cross2Icon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@radix-ui/react-icons';
import {
  SESSION_TYPES,
  THERAPY_TYPES,
  ALLOWED_AUDIO_VIDEO_MIME_TYPES,
  ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY,
} from '../../constants';
import { getTodayDateString } from '../../helpers';
import { uploadSession, fetchSession, fetchContainerLogs } from '../../api/api';
import type {
  SessionMetadata,
  UITranscriptionStatus,
  Session,
} from '../../types';
import { closeUploadModalAtom } from '../../store';
import { cn } from '../../utils';

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

  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const sessionNameRef = useRef<HTMLInputElement>(null);

  const uploadMutation = useMutation({
    mutationFn: ({
      file,
      metadata,
    }: {
      file: File;
      metadata: SessionMetadata;
    }) => uploadSession(file, metadata),
    onSuccess: (data) => {
      console.log(
        `[UploadModal] Upload accepted. SessionID: ${data.sessionId}`
      );
      setCurrentSessionId(data.sessionId);
      setFormError(null);
    },
    onError: (error: Error) => {
      console.error('Upload failed:', error);
      setFormError(`Upload failed: ${error.message}`);
      setCurrentSessionId(null);
    },
  });

  const resetModal = useCallback(() => {
    setModalFile(null);
    setClientNameInput('');
    setSessionDate(getTodayDateString());
    setSessionNameInput('');
    setSessionTypeInput(SESSION_TYPES[0]);
    setTherapyInput(THERAPY_TYPES[0]);
    setDragActive(false);
    setFormError(null);
    setShowLogs(false);
    const prevSessionId = currentSessionId;
    setCurrentSessionId(null);

    if (fileInputRef.current) fileInputRef.current.value = '';
    uploadMutation.reset();
    if (prevSessionId) {
      queryClient.removeQueries({
        queryKey: ['sessionMeta', prevSessionId],
      });
    }
  }, [uploadMutation, queryClient, currentSessionId]);

  const {
    data: logs,
    isLoading: isLoadingLogs, // isFetching is also available if needed
  } = useQuery({
    queryKey: ['whisperContainerLogs'],
    queryFn: () => fetchContainerLogs('therascript_whisper_service'),
    enabled: isOpen && showLogs,
    refetchInterval: isOpen && showLogs ? 5000 : false,
    refetchOnWindowFocus: false,
    staleTime: 4000,
  });

  useEffect(() => {
    if (isOpen && !currentSessionId) {
      const timer = setTimeout(() => {
        sessionNameRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentSessionId]);

  useEffect(() => {
    if (sessionTypeInput === 'Intake') {
      setTherapyInput('N/A');
    }
  }, [sessionTypeInput]);

  // New query to poll the session status
  const { data: sessionStatus, error: sessionPollingError } = useQuery<
    Session,
    Error
  >({
    queryKey: ['sessionMeta', currentSessionId],
    queryFn: () => {
      if (!currentSessionId) throw new Error('No Session ID to poll');
      return fetchSession(currentSessionId);
    },
    enabled: !!currentSessionId,
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.status === 'completed' || d?.status === 'failed' ? false : 2000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });

  // New useEffect to handle navigation when processing is complete
  useEffect(() => {
    if (sessionStatus?.status === 'completed' && currentSessionId) {
      console.log(
        `[UploadModal] Session ${currentSessionId} processing complete. Navigating...`
      );
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      const firstChatId = sessionStatus.chats?.[0]?.id;
      if (firstChatId) {
        navigate(`/sessions/${currentSessionId}/chats/${firstChatId}`);
      } else {
        navigate(`/sessions/${currentSessionId}`);
      }
      closeModal();
      resetModal();
    }
  }, [
    sessionStatus,
    currentSessionId,
    navigate,
    closeModal,
    resetModal,
    queryClient,
  ]);

  const isUploading = uploadMutation.isPending;
  const isPolling =
    !!currentSessionId && !sessionStatus && !sessionPollingError;
  const isProcessing =
    sessionStatus?.status === 'queued' ||
    sessionStatus?.status === 'transcribing';
  const isFinalizing = sessionStatus?.status === 'completed'; // Brief state before navigation

  const hasFailed =
    uploadMutation.isError ||
    sessionStatus?.status === 'failed' ||
    !!sessionPollingError;

  const overallIsLoading =
    isUploading || isPolling || isProcessing || isFinalizing;

  const showLogsButton = overallIsLoading && !hasFailed;

  const overallError =
    formError ||
    (uploadMutation.isError ? uploadMutation.error.message : null) ||
    sessionPollingError?.message ||
    (sessionStatus?.status === 'failed'
      ? 'Processing failed. Check server logs.'
      : null);

  const handleDrag = (
    e: React.DragEvent<HTMLDivElement | HTMLLabelElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (overallIsLoading) return;
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleFileSelection = (file: File | null) => {
    if (file && ALLOWED_AUDIO_VIDEO_MIME_TYPES.includes(file.type)) {
      setModalFile(file);
      setFormError(null);
      if (!sessionNameInput)
        setSessionNameInput(file.name.replace(/\.[^/.]+$/, ''));
    } else {
      setModalFile(null);
      if (file)
        setFormError(
          `Invalid file type. Please upload an audio/video file (${ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')}).`
        );
      else setFormError(null);
    }
    requestAnimationFrame(() => {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    });
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement | HTMLLabelElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (overallIsLoading) return;
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0])
      handleFileSelection(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    handleFileSelection(e.target.files?.[0] ?? null);
  };

  const handleStartClick = async () => {
    setFormError(null);
    let missingFields = [];
    if (!modalFile)
      missingFields.push(
        `Audio/Video File (${ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')})`
      );
    if (!clientNameInput.trim()) missingFields.push('Client Name');
    if (!sessionNameInput.trim()) missingFields.push('Session Name');
    if (!sessionDate) missingFields.push('Date');
    if (missingFields.length > 0) {
      setFormError(
        `Please fill in all required fields: ${missingFields.join(', ')}`
      );
      return;
    }
    if (modalFile) {
      uploadMutation.reset();
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
        console.error('Error initiating upload mutation', err);
        setFormError('An unexpected error occurred while starting the upload.');
      }
    } else {
      setFormError(
        `Please select an audio/video file (${ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')}).`
      );
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && overallIsLoading && !hasFailed) {
      console.log('Cannot close modal while processing.');
      return;
    }
    if (!open) {
      closeModal();
      resetModal();
    }
  };

  const dropAreaClasses = cn(
    'rounded-md p-6 text-center transition-colors duration-200 ease-in-out',
    'flex flex-col items-center justify-center space-y-2 min-h-[10rem]',
    'border-2 border-dashed',
    overallIsLoading
      ? 'bg-gray-100 dark:bg-gray-800/50 cursor-not-allowed opacity-70 border-gray-300 dark:border-gray-700'
      : 'cursor-pointer',
    dragActive && !overallIsLoading
      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
      : modalFile && !overallIsLoading
        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
        : !overallIsLoading
          ? 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          : ''
  );

  const getProgressText = () => {
    if (isUploading) return 'Uploading file...';
    if (sessionStatus) {
      switch (sessionStatus.status) {
        case 'pending':
          return 'Upload complete, waiting to be queued...';
        case 'queued':
          return 'Transcription job is in the queue...';
        case 'transcribing':
          return 'Transcription in progress...';
        case 'completed':
          return 'Processing complete! Finalizing...';
        case 'failed':
          return 'Processing failed.';
      }
    }
    if (uploadMutation.isSuccess && !sessionStatus) {
      return 'Waiting for transcription to start...';
    }
    if (isFinalizing) return 'Finalizing session...';
    if (hasFailed) return overallError || 'Processing Failed';
    return modalFile ? (
      <>
        Selected: <Strong>{modalFile.name}</Strong>
      </>
    ) : dragActive ? (
      `Drop file (${ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')}) here`
    ) : (
      `Drag & drop or click to choose file`
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !overallIsLoading && !currentSessionId) {
      e.preventDefault();
      handleStartClick();
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Content style={{ maxWidth: 550 }}>
        <Dialog.Title>Upload New Session</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Add session details and upload an audio/video file (
          {ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')}) to start
          analysis.
        </Dialog.Description>
        <Flex direction="column" gap="4">
          <label
            htmlFor="audio-upload-input"
            className={dropAreaClasses}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            aria-disabled={overallIsLoading}
            aria-label={
              modalFile
                ? `Selected file: ${modalFile.name}. Click to change.`
                : `Drag and drop audio/video file (${ALLOWED_AUDIO_VIDEO_EXTENSIONS_DISPLAY.join(', ')}) or click here to upload`
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_AUDIO_VIDEO_MIME_TYPES.join(',')}
              className="hidden"
              id="audio-upload-input"
              onChange={handleFileChange}
              disabled={overallIsLoading}
            />
            <Flex direction="column" align="center" gap="1">
              {hasFailed ? (
                <ExclamationTriangleIcon
                  width="32"
                  height="32"
                  className="text-red-600"
                />
              ) : overallIsLoading ? (
                <Spinner size="3" />
              ) : modalFile ? (
                <CheckCircledIcon
                  width="32"
                  height="32"
                  className="text-emerald-600"
                />
              ) : (
                <UploadIcon
                  width="32"
                  height="32"
                  className={cn(
                    dragActive
                      ? 'text-blue-500'
                      : 'text-gray-400 dark:text-gray-500'
                  )}
                />
              )}
              <Text size="2" color="gray" mt="2">
                {getProgressText()}
              </Text>
              {modalFile && !overallIsLoading && !hasFailed && (
                <Box mt="3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    type="button"
                    variant="ghost"
                    color="red"
                    size="1"
                    highContrast
                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                      e.preventDefault();
                      handleFileSelection(null);
                    }}
                    aria-label="Remove selected file"
                  >
                    Remove File
                  </Button>
                </Box>
              )}
              {showLogsButton && (
                <Box mt="2">
                  <Button
                    variant="soft"
                    color="gray"
                    size="1"
                    onClick={() => setShowLogs(!showLogs)}
                  >
                    {showLogs ? 'Hide' : 'Show'} Detailed Logs
                    {showLogs ? (
                      <ChevronUpIcon className="ml-1" />
                    ) : (
                      <ChevronDownIcon className="ml-1" />
                    )}
                  </Button>
                </Box>
              )}
            </Flex>
          </label>

          {showLogs && (
            <Box mt="-2" width="100%">
              <ScrollArea
                type="auto"
                scrollbars="vertical"
                style={{
                  maxHeight: '200px',
                  backgroundColor: 'var(--gray-a2)',
                  borderRadius: 'var(--radius-3)',
                  border: '1px solid var(--gray-a5)',
                }}
              >
                <Box p="2">
                  {isLoadingLogs ? (
                    <Flex align="center" justify="center" p="4">
                      <Spinner size="1" />
                      <Text ml="2" color="gray" size="1">
                        Loading logs...
                      </Text>
                    </Flex>
                  ) : (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--gray-a11)',
                      }}
                    >
                      <code>{logs || 'No log output available.'}</code>
                    </pre>
                  )}
                </Box>
              </ScrollArea>
            </Box>
          )}

          <Flex direction="column" gap="3">
            <label>
              <Text as="div" size="2" mb="1" weight="medium">
                Session Name / Title
              </Text>
              <TextField.Root
                ref={sessionNameRef}
                size="2"
                placeholder="e.g., Weekly Check-in"
                value={sessionNameInput}
                onChange={(e) => setSessionNameInput(e.target.value)}
                disabled={overallIsLoading}
                required
                onKeyDown={handleKeyDown}
              />
            </label>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Client Name
                </Text>
                <TextField.Root
                  size="2"
                  placeholder="Client's Full Name"
                  value={clientNameInput}
                  onChange={(e) => setClientNameInput(e.target.value)}
                  disabled={overallIsLoading}
                  required
                  onKeyDown={handleKeyDown}
                />
              </label>
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Date
                </Text>
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(e) => setSessionDate(e.target.value)}
                  disabled={overallIsLoading}
                  required
                  onKeyDown={handleKeyDown}
                  className={cn(
                    'flex w-full rounded-md border border-[--gray-a7] bg-[--gray-1] focus:border-[--accent-8] focus:shadow-[0_0_0_1px_var(--accent-8)]',
                    'h-8 px-2 py-1 text-sm text-[--gray-12] placeholder:text-[--gray-a9] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                  style={{ lineHeight: 'normal' }}
                />
              </label>
            </Box>
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Session Type
                </Text>
                <Select.Root
                  value={sessionTypeInput}
                  onValueChange={setSessionTypeInput}
                  disabled={overallIsLoading}
                  required
                  size="2"
                >
                  <Select.Trigger
                    placeholder="Select type..."
                    style={{ width: '100%' }}
                  />
                  <Select.Content>
                    {SESSION_TYPES.map((type) => (
                      <Select.Item key={type} value={type}>
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
              <label>
                <Text as="div" size="2" mb="1" weight="medium">
                  Therapy Modality
                </Text>
                <Select.Root
                  value={therapyInput}
                  onValueChange={setTherapyInput}
                  disabled={overallIsLoading || sessionTypeInput === 'Intake'}
                  required
                  size="2"
                >
                  <Select.Trigger
                    placeholder="Select therapy..."
                    style={{ width: '100%' }}
                  />
                  <Select.Content>
                    {THERAPY_TYPES.map((type) => (
                      <Select.Item key={type} value={type}>
                        {type}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </label>
            </Box>
          </Flex>

          {overallError && (
            <Callout.Root color="red" role="alert" size="1" mt="2">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {typeof overallError === 'string'
                  ? overallError
                  : 'An unexpected error occurred.'}
              </Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Button
            type="button"
            variant="soft"
            color="gray"
            onClick={() => handleOpenChange(false)}
            disabled={overallIsLoading && !hasFailed}
          >
            <Cross2Icon />{' '}
            {overallIsLoading && !hasFailed ? 'Processing...' : 'Cancel'}
          </Button>
          {!currentSessionId && !uploadMutation.isSuccess && (
            <Button
              type="button"
              onClick={handleStartClick}
              disabled={!modalFile || isUploading}
            >
              {isUploading ? (
                <>
                  <Spinner size="2" />
                  <Text ml="2">Uploading...</Text>
                </>
              ) : (
                <>
                  <UploadIcon /> Upload & Start
                </>
              )}
            </Button>
          )}
          {hasFailed && (
            <Button type="button" color="orange" onClick={resetModal}>
              Retry Upload
            </Button>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
