// packages/ui/src/components/SessionView/Transcription/Transcription.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Virtuoso } from 'react-virtuoso';
import type {
  Session,
  StructuredTranscript,
  TranscriptParagraphData,
} from '../../../types';
import { TranscriptParagraph } from '../../Transcription/TranscriptParagraph';
import {
  Box,
  Text,
  Flex,
  Button,
  Badge,
  Spinner,
  Tooltip,
  IconButton,
  DropdownMenu,
  AlertDialog,
} from '@radix-ui/themes';
import {
  Pencil1Icon,
  BookmarkIcon,
  CalendarIcon,
  PersonIcon,
  BadgeIcon as SessionTypeIcon,
  ArchiveIcon,
  DotsHorizontalIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import {
  updateTranscriptParagraph,
  deleteSessionAudio,
  deleteTranscriptParagraph,
} from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants';
import { debounce, formatIsoDateToYMD } from '../../../helpers';
import axios from 'axios';
import { useSetAtom } from 'jotai';
import { toastMessageAtom } from '../../../store';

const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

type BadgeCategory = 'session' | 'therapy';

const getBadgeColor = (
  type: string | undefined,
  category: BadgeCategory
): React.ComponentProps<typeof Badge>['color'] => {
  const map = category === 'session' ? sessionColorMap : therapyColorMap;
  return type ? map[type.toLowerCase()] || map['default'] : map['default'];
};

const renderHeaderDetail = (
  IconComponent: React.ElementType,
  value: string | undefined | number | null,
  label: string,
  category?: BadgeCategory,
  isDateValue?: boolean,
  isTokenValue?: boolean
) => {
  let displayValue: string | number | undefined | null = value;
  if (isDateValue && typeof value === 'string') {
    displayValue = formatIsoDateToYMD(value);
  } else if (isTokenValue && typeof value === 'number') {
    displayValue = value.toLocaleString();
  }

  if (
    displayValue === undefined ||
    displayValue === null ||
    displayValue === ''
  )
    return null;

  const isBadge = category === 'session' || category === 'therapy';
  const badgeColor =
    isBadge && typeof value === 'string'
      ? getBadgeColor(value, category)
      : undefined;

  return (
    <Tooltip content={label}>
      <Flex align="center" gap="1" title={label}>
        <IconComponent
          className={cn(
            'flex-shrink-0',
            isBadge || isTokenValue ? 'opacity-80' : 'text-[--gray-a10]'
          )}
          width="14"
          height="14"
        />
        {isBadge && badgeColor ? (
          <Badge color={badgeColor} variant="soft" radius="full" size="1">
            {value}
          </Badge>
        ) : isTokenValue ? (
          <Badge color="gray" variant="soft" radius="full" size="1">
            {displayValue}
          </Badge>
        ) : (
          <Text size="1" color="gray">
            {displayValue}
          </Text>
        )}
      </Flex>
    </Tooltip>
  );
};

interface TranscriptionProps {
  session: Session;
  transcriptContent: StructuredTranscript | undefined;
  onEditDetailsClick: () => void;
  isTabActive?: boolean;
  initialScrollTop?: number;
  onScrollUpdate?: (scrollTop: number) => void;
  isLoadingTranscript: boolean;
  transcriptError?: Error | null;
}

export function Transcription({
  session,
  transcriptContent,
  onEditDetailsClick,
  isTabActive,
  initialScrollTop = 0,
  onScrollUpdate,
  isLoadingTranscript,
  transcriptError,
}: TranscriptionProps) {
  const [activeEditIndex, setActiveEditIndex] = useState<number | null>(null);
  const virtuosoRef = useRef<any>(null);
  const restoreScrollRef = useRef(false);
  const [highlightedParagraphIndex, setHighlightedParagraphIndex] = useState<
    number | null
  >(null);
  const queryClient = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const setToast = useSetAtom(toastMessageAtom);
  const location = useLocation();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playingParagraphIndex, setPlayingParagraphIndex] = useState<
    number | null
  >(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [isAudioLoading, setIsAudioLoading] = useState(false);
  const [isDeleteAudioConfirmOpen, setIsDeleteAudioConfirmOpen] =
    useState(false);

  const [paragraphToDelete, setParagraphToDelete] =
    useState<TranscriptParagraphData | null>(null);
  const [isDeleteParaConfirmOpen, setIsDeleteParaConfirmOpen] = useState(false);

  const transcriptTokenCount = session?.transcriptTokenCount;
  const isAudioAvailable = !!session?.audioPath;

  const handleAudioCanPlay = useCallback(() => {
    setAudioReady(true);
    setIsAudioLoading(false);
    setAudioError(null);
  }, []);

  const handleAudioError = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const error = (e.target as HTMLAudioElement).error;
      let errorMessage = 'Unknown audio error';
      if (error) {
        switch (error.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            errorMessage = 'Audio playback aborted.';
            break;
          case MediaError.MEDIA_ERR_NETWORK:
            errorMessage = 'Network error loading audio.';
            break;
          case MediaError.MEDIA_ERR_DECODE:
            errorMessage = 'Error decoding audio file.';
            break;
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Audio format not supported.';
            break;
          default:
            errorMessage = `Audio Error Code: ${error.code}`;
        }
      }
      setAudioError(`Audio Error: ${errorMessage}`);
      setIsPlaying(false);
      setPlayingParagraphIndex(null);
      setAudioReady(false);
      setIsAudioLoading(false);
    },
    []
  );

  const handleAudioEnded = useCallback(() => {
    setIsPlaying(false);
    setPlayingParagraphIndex(null);
  }, []);
  const handleAudioPause = useCallback(() => {
    if (audioRef.current && !audioRef.current.seeking) setIsPlaying(false);
  }, []);
  const handleAudioPlay = useCallback(() => {
    setIsPlaying(true);
    setAudioError(null);
    setIsAudioLoading(false);
  }, []);
  const handleAudioWaiting = useCallback(() => {
    setIsAudioLoading(true);
  }, []);
  const handleAudioPlaying = useCallback(() => {
    setIsAudioLoading(false);
  }, []);

  const handleAudioTimeUpdate = useCallback(() => {
    if (!audioRef.current || !transcriptContent || audioRef.current.seeking)
      return;
    const currentTimeMs = audioRef.current.currentTime * 1000;
    let currentParagraphIdx = -1;
    for (let i = 0; i < transcriptContent.length; i++) {
      const p = transcriptContent[i];
      const nextP = transcriptContent[i + 1];
      const pStartTime = p.timestamp;
      const pEndTime = nextP ? nextP.timestamp : Infinity;
      if (currentTimeMs >= pStartTime && currentTimeMs < pEndTime) {
        currentParagraphIdx = i;
        break;
      }
    }
    if (
      isPlaying &&
      currentParagraphIdx !== -1 &&
      currentParagraphIdx !== playingParagraphIndex
    ) {
      setPlayingParagraphIndex(currentParagraphIdx);
    }
  }, [transcriptContent, playingParagraphIndex, isPlaying]);

  const audioSrc = session?.audioPath
    ? `${API_BASE_URL}/api/sessions/${session.id}/audio`
    : null;

  const playAudioFromTimestamp = useCallback(
    (timestampMs: number, index: number) => {
      if (!audioRef.current || !audioSrc) {
        setAudioError('Audio element or source not available.');
        return;
      }
      if (audioRef.current.src !== audioSrc) {
        audioRef.current.src = audioSrc;
        audioRef.current.load();
        setIsAudioLoading(true);
      }
      const seekTimeSeconds = timestampMs / 1000;
      const playAction = () => {
        const playPromise = audioRef.current!.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              setPlayingParagraphIndex(index);
            })
            .catch((err) => {
              setAudioError(
                `Playback error: ${err.message}. Browser might require user interaction first.`
              );
              setIsPlaying(false);
              setPlayingParagraphIndex(null);
              setIsAudioLoading(false);
            });
        }
      };
      if (!isPlaying && playingParagraphIndex === index) {
        playAction();
      } else {
        if (
          audioRef.current.readyState >=
          (HTMLMediaElement.HAVE_FUTURE_DATA || 3)
        ) {
          if (Math.abs(audioRef.current.currentTime - seekTimeSeconds) > 0.2) {
            audioRef.current.currentTime = seekTimeSeconds;
            setPlayingParagraphIndex(index);
            playAction();
          } else {
            playAction();
          }
        } else {
          audioRef.current.currentTime = seekTimeSeconds;
          setPlayingParagraphIndex(index);
          setIsAudioLoading(true);
        }
      }
    },
    [audioSrc, isPlaying, playingParagraphIndex]
  );

  const pauseAudio = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const togglePlayback = useCallback(
    (timestampMs: number, index: number) => {
      if (!isAudioAvailable) return;
      if (playingParagraphIndex === index && isPlaying) pauseAudio();
      else playAudioFromTimestamp(timestampMs, index);
    },
    [
      isPlaying,
      playingParagraphIndex,
      pauseAudio,
      playAudioFromTimestamp,
      isAudioAvailable,
    ]
  );

  const saveParagraphMutation = useMutation({
    mutationFn: ({
      paragraphIndex,
      newText,
    }: {
      paragraphIndex: number;
      newText: string;
    }) => updateTranscriptParagraph(session.id, paragraphIndex, newText),
    onSuccess: (updatedStructuredTranscript, variables) => {
      queryClient.setQueryData(
        ['transcript', session.id],
        updatedStructuredTranscript
      );
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
      setToast('Paragraph saved successfully.');
      setActiveEditIndex(null);
    },
    onError: (error, variables) => {
      setToast(`Error saving paragraph: ${error.message}`);
      setActiveEditIndex(null);
    },
  });

  const deleteParagraphMutation = useMutation({
    mutationFn: ({ paragraphId }: { paragraphId: number }) =>
      deleteTranscriptParagraph(session.id, paragraphId),
    onSuccess: (updatedTranscript) => {
      queryClient.setQueryData(['transcript', session.id], updatedTranscript);
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
      setToast('Paragraph deleted successfully.');
    },
    onError: (error: Error) => {
      setToast(`Error deleting paragraph: ${error.message}`);
    },
    onSettled: () => {
      setIsDeleteParaConfirmOpen(false);
      setParagraphToDelete(null);
    },
  });

  const deleteAudioMutation = useMutation({
    mutationFn: () => {
      if (!session?.id) throw new Error('Session ID is missing');
      return deleteSessionAudio(session.id);
    },
    onSuccess: (data) => {
      setToast(data.message || 'Audio file deleted.');
      queryClient.invalidateQueries({ queryKey: ['sessionMeta', session.id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (audioRef.current) {
        audioRef.current.src = '';
        audioRef.current.load();
      }
      setIsPlaying(false);
      setPlayingParagraphIndex(null);
      setAudioReady(false);
      setAudioError(null);
      setIsAudioLoading(false);
    },
    onError: (error) => {
      setToast(`Error deleting audio: ${error.message}`);
    },
    onSettled: () => {
      setIsDeleteAudioConfirmOpen(false);
    },
  });

  const debouncedScrollSave = useCallback(
    debounce((scrollTop: number) => {
      if (onScrollUpdate) onScrollUpdate(scrollTop);
    }, 150),
    [onScrollUpdate]
  );
  const handleScroll = useCallback(
    (e: any) => {
      if (!restoreScrollRef.current && e.scrollTop !== undefined) {
        debouncedScrollSave(e.scrollTop);
      }
      if (restoreScrollRef.current) restoreScrollRef.current = false;
    },
    [debouncedScrollSave]
  );

  useEffect(() => {
    if (isTabActive) restoreScrollRef.current = true;
    else restoreScrollRef.current = false;
  }, [isTabActive]);
  useEffect(() => {
    if (restoreScrollRef.current && virtuosoRef.current) {
      requestAnimationFrame(() => {
        if (restoreScrollRef.current && virtuosoRef.current) {
          virtuosoRef.current.scrollTo({
            top: initialScrollTop,
            behavior: 'auto',
          });
          restoreScrollRef.current = false;
        }
      });
    }
  }, [isTabActive, initialScrollTop]);

  useEffect(() => {
    if (audioRef.current && audioSrc && audioRef.current.src !== audioSrc) {
      audioRef.current.src = audioSrc;
      audioRef.current.load();
      setIsAudioLoading(true);
      setAudioReady(false);
    } else if (!audioSrc && audioRef.current) {
      audioRef.current.removeAttribute('src');
      audioRef.current.load(); // This stops playback and resets state
      setAudioReady(false);
      setIsPlaying(false);
      setPlayingParagraphIndex(null);
      setAudioError(null);
      setIsAudioLoading(false);
    }
  }, [audioSrc]);

  if (!session)
    return (
      <Box p="4">
        <Text color="gray" style={{ fontStyle: 'italic' }}>
          Session data not available.
        </Text>
      </Box>
    );

  const paragraphs = transcriptContent || [];

  // Scroll to paragraph based on hash
  useEffect(() => {
    if (!isTabActive) return;
    if (paragraphs.length > 0 && location.hash) {
      const hash = location.hash.substring(1);
      if (hash.startsWith('paragraph-')) {
        const paragraphIdStr = hash.substring('paragraph-'.length);
        const paragraphId = parseInt(paragraphIdStr, 10);
        if (!isNaN(paragraphId)) {
          const idx = paragraphs.findIndex((p) => p.id === paragraphId);
          if (idx >= 0) {
            setTimeout(() => {
              if (virtuosoRef.current) {
                console.log(
                  `[Transcription] Scrolling to paragraph id=${paragraphId} at index=${idx}`
                );
                virtuosoRef.current.scrollToIndex({
                  index: idx,
                  align: 'center',
                  behavior: 'smooth',
                });
                setHighlightedParagraphIndex(idx);
                setTimeout(() => setHighlightedParagraphIndex(null), 2000);
              }
            }, 100);
          }
        }
      }
    }
  }, [location.hash, paragraphs, isTabActive]);

  const handleSaveParagraphInternal = async (
    paragraphId: number,
    newText: string
  ) => {
    if (isPlaying && playingParagraphIndex === paragraphId) pauseAudio();
    saveParagraphMutation.mutate({ paragraphIndex: paragraphId, newText });
  };

  const handleDeleteParagraphRequest = (paragraph: TranscriptParagraphData) => {
    setParagraphToDelete(paragraph);
    setIsDeleteParaConfirmOpen(true);
  };

  const handleConfirmDeleteParagraph = () => {
    if (paragraphToDelete) {
      deleteParagraphMutation.mutate({ paragraphId: paragraphToDelete.id });
    }
  };

  const handleDeleteAudioClick = () => setIsDeleteAudioConfirmOpen(true);
  const confirmDeleteAudio = () => {
    if (deleteAudioMutation.isPending) return;
    deleteAudioMutation.mutate();
  };

  return (
    <>
      <style>
        {`
          .highlight-paragraph {
            background-color: var(--yellow-a4); /* Or your preferred Radix accent color */
            transition: background-color 0.5s ease-out;
          }
        `}
      </style>
      <Flex
        direction="column"
        style={{
          height: '100%',
          minHeight: 0,
          border: '1px solid var(--gray-a6)',
          borderRadius: 'var(--radius-3)',
          backgroundColor: 'var(--color-panel-translucent)',
        }}
      >
        {isAudioAvailable && (
          <audio
            ref={audioRef}
            preload="metadata"
            onCanPlay={handleAudioCanPlay}
            onError={handleAudioError}
            onEnded={handleAudioEnded}
            onPause={handleAudioPause}
            onPlay={handleAudioPlay}
            onTimeUpdate={handleAudioTimeUpdate}
            onWaiting={handleAudioWaiting}
            onPlaying={handleAudioPlaying}
            controls={false}
            style={{ display: 'none' }}
          />
        )}
        <Flex
          align="baseline"
          justify="between"
          px="3"
          py="2"
          style={{ borderBottom: '1px solid var(--gray-a6)', flexShrink: 0 }}
          gap="3"
          wrap="wrap"
        >
          <Flex
            align="center"
            gap="3"
            wrap="wrap"
            style={{ minWidth: 0, flexGrow: 1 }}
          >
            {renderHeaderDetail(PersonIcon, session.clientName, 'Client')}
            {renderHeaderDetail(
              CalendarIcon,
              session.date,
              'Date',
              undefined,
              true
            )}
            {renderHeaderDetail(
              SessionTypeIcon,
              session.sessionType,
              'Session Type',
              'session'
            )}
            {renderHeaderDetail(
              BookmarkIcon,
              session.therapy,
              'Therapy Type',
              'therapy'
            )}
            {typeof transcriptTokenCount === 'number' &&
              renderHeaderDetail(
                ArchiveIcon,
                transcriptTokenCount,
                `Transcript Tokens`,
                undefined,
                false,
                true
              )}
          </Flex>
          <Box flexShrink="0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  title="More Options"
                  aria-label="Transcription options"
                >
                  <DotsHorizontalIcon />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item onSelect={onEditDetailsClick}>
                  <Pencil1Icon className="mr-2 h-4 w-4" /> Edit Session Details
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  color="red"
                  onSelect={handleDeleteAudioClick}
                  disabled={!isAudioAvailable || deleteAudioMutation.isPending}
                >
                  <TrashIcon className="mr-2 h-4 w-4" /> Delete Original Audio
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </Box>
        </Flex>

        <Box
          px="3"
          py="1"
          style={{
            backgroundColor: audioError
              ? 'var(--red-a3)'
              : isAudioLoading
                ? 'var(--amber-a3)'
                : 'transparent',
            borderBottom:
              audioError || isAudioLoading
                ? `1px solid ${audioError ? 'var(--red-a6)' : 'var(--amber-a6)'}`
                : 'none',
            display: audioError || isAudioLoading ? 'block' : 'none',
            transition: 'background-color 0.3s ease',
          }}
        >
          <Flex align="center" gap="2">
            {isAudioLoading && <Spinner size="1" />}
            <Text
              size="1"
              color={audioError ? 'red' : isAudioLoading ? 'amber' : 'gray'}
            >
              {audioError || (isAudioLoading ? 'Loading audio...' : '')}
            </Text>
          </Flex>
        </Box>

        {isLoadingTranscript && (
          <Flex
            align="center"
            justify="center"
            style={{ minHeight: '100px', flexGrow: 1 }}
          >
            <Spinner size="2" />{' '}
            <Text ml="2" color="gray">
              Loading transcript...
            </Text>
          </Flex>
        )}
        {transcriptError && !isLoadingTranscript && (
          <Flex
            align="center"
            justify="center"
            style={{ minHeight: '100px', flexGrow: 1 }}
          >
            <Text color="red">
              Error loading transcript: {transcriptError.message}
            </Text>
          </Flex>
        )}
        {!isLoadingTranscript && !transcriptError && (
          <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%' }}
            data={paragraphs}
            computeItemKey={(index, p) => p.id}
            onScroll={handleScroll}
            itemContent={(index, paragraph) => (
              <Box
                p="3"
                pt={index === 0 ? '3' : '0'}
                pb={index === paragraphs.length - 1 ? '3' : '0'}
              >
                <TranscriptParagraph
                  key={paragraph.id}
                  paragraph={paragraph}
                  index={index}
                  onSave={handleSaveParagraphInternal}
                  onDelete={handleDeleteParagraphRequest}
                  activeEditIndex={activeEditIndex}
                  setActiveEditIndex={setActiveEditIndex}
                  isSaving={
                    saveParagraphMutation.isPending &&
                    saveParagraphMutation.variables?.paragraphIndex ===
                      paragraph.id
                  }
                  onPlayToggle={togglePlayback}
                  isPlaying={isPlaying && playingParagraphIndex === index}
                  isAudioAvailable={isAudioAvailable}
                  isHighlighted={highlightedParagraphIndex === index}
                />
              </Box>
            )}
            components={{
              EmptyPlaceholder: () => (
                <Flex
                  align="center"
                  justify="center"
                  style={{ minHeight: '100px' }}
                >
                  <Text color="gray" style={{ fontStyle: 'italic' }}>
                    {session.status === 'completed'
                      ? 'Transcription is empty.'
                      : 'Transcription not available yet.'}
                  </Text>
                </Flex>
              ),
            }}
          />
        )}
      </Flex>
      <AlertDialog.Root
        open={isDeleteAudioConfirmOpen}
        onOpenChange={setIsDeleteAudioConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Audio File</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete the original audio file
            ({session.audioPath || 'unknown name'}) for this session? This
            action cannot be undone.
            <br />
            <br />
            The session transcript and chat history will remain.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setIsDeleteAudioConfirmOpen(false)}
              disabled={deleteAudioMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              color="red"
              onClick={confirmDeleteAudio}
              disabled={deleteAudioMutation.isPending}
            >
              {deleteAudioMutation.isPending ? (
                <Spinner size="1" />
              ) : (
                <TrashIcon />
              )}
              <Text ml="1">Delete Audio</Text>
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <AlertDialog.Root
        open={isDeleteParaConfirmOpen}
        onOpenChange={setIsDeleteParaConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Paragraph</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to permanently delete this paragraph? This
            action cannot be undone.
          </AlertDialog.Description>
          <Box
            my="3"
            p="2"
            style={{
              backgroundColor: 'var(--gray-a3)',
              borderRadius: 'var(--radius-3)',
              border: '1px solid var(--gray-a5)',
              maxHeight: '120px',
              overflowY: 'auto',
            }}
          >
            <Text
              as="p"
              size="1"
              color="gray"
              style={{
                fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {paragraphToDelete?.text}
            </Text>
          </Box>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteParagraphMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDeleteParagraph}
                disabled={deleteParagraphMutation.isPending}
              >
                {deleteParagraphMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml="1">Delete Paragraph</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
