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
import { EditSessionModal } from '../../Shared/EditSessionModal';
import { AppTooltip } from '../../Shared/AppTooltip';
import { RenameSpeakersModal } from './RenameSpeakersModal';
import { getUniqueSpeakers } from './speakerUtils';
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
  Callout,
} from '@radix-ui/themes';
import {
  BookmarkIcon,
  CalendarIcon,
  PersonIcon,
  BadgeIcon as SessionTypeIcon,
  ArchiveIcon,
  ClockIcon,
  DotsHorizontalIcon,
  TrashIcon,
  CopyIcon,
  Pencil1Icon,
  MixerHorizontalIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  EyeOpenIcon,
  EyeClosedIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import {
  updateTranscriptParagraph,
  deleteSessionAudio,
  deleteTranscriptParagraph,
  updateParagraphSpeaker,
  updateSessionMetadata,
  checkSessionAudioAvailability,
} from '../../../api/api';
import { sessionColorMap, therapyColorMap } from '../../../constants';
import { debounce, formatIsoDateToYMD, formatDuration } from '../../../helpers';
import { useSetAtom } from 'jotai';
import { toastMessageAtom } from '../../../store';
import copy from 'copy-to-clipboard';
import { API_BASE_URL } from '../../../api/baseUrl';

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
  isTokenValue?: boolean,
  isDurationValue?: boolean
) => {
  let displayValue: string | number | undefined | null = value;
  if (isDateValue && typeof value === 'string') {
    displayValue = formatIsoDateToYMD(value);
  } else if (isTokenValue && typeof value === 'number') {
    displayValue = value.toLocaleString();
  } else if (isDurationValue && typeof value === 'number') {
    displayValue = formatDuration(value);
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
      <Flex align="center" gap="1">
        <IconComponent
          className={cn(
            'flex-shrink-0',
            isBadge || isTokenValue || isDurationValue
              ? 'opacity-80'
              : 'text-[--gray-a10]'
          )}
          width="14"
          height="14"
        />
        {isBadge && badgeColor ? (
          <Badge color={badgeColor} variant="soft" radius="full" size="1">
            {value}
          </Badge>
        ) : isTokenValue || isDurationValue ? (
          <Text size="1" color="gray" weight="medium">
            {displayValue}
          </Text>
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
  isTabActive?: boolean;
  initialScrollTop?: number;
  onScrollUpdate?: (scrollTop: number) => void;
  isLoadingTranscript: boolean;
  transcriptError?: Error | null;
}

export function Transcription({
  session,
  transcriptContent,
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
  // Server-confirmed audio availability. A populated `audioPath` alone is
  // not proof the file exists (it may have been deleted outside the app),
  // and browser media error code 4 is ambiguous (missing file vs. truly
  // unsupported format), so availability is confirmed via a lightweight
  // server probe before the media element is allowed to load.
  const [audioAvailability, setAudioAvailability] = useState<
    'unknown' | 'available' | 'missing'
  >('unknown');
  // Resolved + in-flight availability probes keyed by session/audio source.
  // The in-flight map keeps StrictMode remounts and concurrent renders to
  // a single request per source.
  const availabilityCacheRef = useRef(
    new Map<string, 'available' | 'missing'>()
  );
  const availabilityInflightRef = useRef(
    new Map<string, Promise<'available' | 'missing'>>()
  );
  const [isDeleteAudioConfirmOpen, setIsDeleteAudioConfirmOpen] =
    useState(false);

  const [paragraphToDelete, setParagraphToDelete] =
    useState<TranscriptParagraphData | null>(null);
  const [isDeleteParaConfirmOpen, setIsDeleteParaConfirmOpen] = useState(false);
  const [isEditSessionModalOpen, setIsEditSessionModalOpen] = useState(false);
  const [isRenameSpeakersModalOpen, setIsRenameSpeakersModalOpen] =
    useState(false);

  const transcriptTokenCount = session?.transcriptTokenCount;
  const sessionId = session?.id;
  const hasAudioPath = !!session?.audioPath;
  const audioSrc = session?.audioPath
    ? `${API_BASE_URL}/api/sessions/${session.id}/audio`
    : null;
  // Confirmed-missing covers both normal in-app deletion (no `audioPath`)
  // and external deletion (stale path whose file no longer exists).
  const audioMissing = !hasAudioPath || audioAvailability === 'missing';
  const isPlaybackAvailable = hasAudioPath && audioAvailability === 'available';

  const handleAudioCanPlay = useCallback(() => {
    setAudioReady(true);
    setIsAudioLoading(false);
    setAudioError(null);
  }, []);

  const handleAudioError = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      // The media element only mounts after the server confirms the file
      // exists, so code 4 here means a genuinely unsupported format — not
      // a missing file. Missing files never reach this handler.
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
      if (!isPlaybackAvailable) return;
      if (playingParagraphIndex === index && isPlaying) pauseAudio();
      else playAudioFromTimestamp(timestampMs, index);
    },
    [
      isPlaying,
      playingParagraphIndex,
      pauseAudio,
      playAudioFromTimestamp,
      isPlaybackAvailable,
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

  const updateSpeakerMutation = useMutation({
    mutationFn: ({
      paragraphId,
      speaker,
    }: {
      paragraphId: number;
      speaker: string;
    }) => updateParagraphSpeaker(session.id, paragraphId, speaker),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transcript', session.id] });
      setToast('Speaker updated.');
    },
    onError: (error: Error) => {
      setToast(`Error updating speaker: ${error.message}`);
    },
  });

  const toggleSpeakersMutation = useMutation({
    mutationFn: (showSpeakers: boolean) =>
      updateSessionMetadata(session.id, { showSpeakers }),
    onMutate: async (showSpeakers) => {
      await queryClient.cancelQueries({
        queryKey: ['sessionMeta', session.id],
      });
      await queryClient.cancelQueries({
        queryKey: ['sessions'],
      });
      const previous = queryClient.getQueryData<Session>([
        'sessionMeta',
        session.id,
      ]);
      const previousSessions = queryClient.getQueryData<Session[]>([
        'sessions',
      ]);
      queryClient.setQueryData<Session>(['sessionMeta', session.id], (old) =>
        old ? { ...old, showSpeakers: showSpeakers ? 1 : 0 } : old
      );
      queryClient.setQueryData<Session[]>(['sessions'], (old) => {
        if (!old) return old;
        return old.map((sessionMeta) =>
          sessionMeta.id === session.id
            ? { ...sessionMeta, showSpeakers: showSpeakers ? 1 : 0 }
            : sessionMeta
        );
      });
      return { previous, previousSessions };
    },
    onError: (error: Error, _, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['sessionMeta', session.id], context.previous);
      }
      if (context?.previousSessions) {
        queryClient.setQueryData(['sessions'], context.previousSessions);
      }
      setToast(`Error updating speaker visibility: ${error.message}`);
    },
    onSuccess: (_, showSpeakers) => {
      queryClient.setQueryData<Session>(['sessionMeta', session.id], (old) =>
        old ? { ...old, showSpeakers: showSpeakers ? 1 : 0 } : old
      );
      queryClient.setQueryData<Session[]>(['sessions'], (old) => {
        if (!old) return old;
        return old.map((sessionMeta) =>
          sessionMeta.id === session.id
            ? { ...sessionMeta, showSpeakers: showSpeakers ? 1 : 0 }
            : sessionMeta
        );
      });
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
      setAudioAvailability('unknown');
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

  // Reset stale error/availability state whenever the session or audio
  // source changes so a previous failure never leaks into the next view.
  useEffect(() => {
    setAudioError(null);
    setAudioReady(false);
    setIsPlaying(false);
    setPlayingParagraphIndex(null);
    setAudioAvailability('unknown');
    setIsAudioLoading(!!audioSrc);
  }, [sessionId, audioSrc]);

  // Confirm file existence with one lightweight server probe per source
  // (no full download). Only a confirmed-missing result shows the
  // missing-file warning; an inconclusive probe (offline/server error)
  // falls through to the media element so genuine network, decode, and
  // unsupported-format failures keep their own messages.
  useEffect(() => {
    if (!audioSrc || sessionId === undefined) return;
    const cacheKey = `${sessionId}:${audioSrc}`;
    const cached = availabilityCacheRef.current.get(cacheKey);
    if (cached) {
      setAudioAvailability(cached);
      if (cached === 'missing') {
        setAudioReady(false);
        setIsAudioLoading(false);
      }
      return;
    }
    let request = availabilityInflightRef.current.get(cacheKey);
    if (!request) {
      request = checkSessionAudioAvailability(sessionId).then(
        (available) => {
          const resolved: 'available' | 'missing' = available
            ? 'available'
            : 'missing';
          availabilityCacheRef.current.set(cacheKey, resolved);
          availabilityInflightRef.current.delete(cacheKey);
          return resolved;
        },
        () => {
          availabilityInflightRef.current.delete(cacheKey);
          return 'available' as const;
        }
      );
      availabilityInflightRef.current.set(cacheKey, request);
    }
    let active = true;
    request.then((resolved) => {
      if (!active) return;
      setAudioAvailability(resolved);
      if (resolved === 'missing') {
        setAudioReady(false);
        setIsPlaying(false);
        setPlayingParagraphIndex(null);
        setIsAudioLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [audioSrc, sessionId]);

  useEffect(() => {
    if (
      audioRef.current &&
      audioSrc &&
      audioAvailability === 'available' &&
      audioRef.current.src !== audioSrc
    ) {
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
  }, [audioSrc, audioAvailability]);

  if (!session)
    return (
      <Box p="4">
        <Text color="gray" style={{ fontStyle: 'italic' }}>
          Session data not available.
        </Text>
      </Box>
    );

  const paragraphs = transcriptContent || [];

  const uniqueSpeakers = getUniqueSpeakers(transcriptContent);
  const hasSpeakers = paragraphs.some((p) => p.speaker);
  const speakersVisible = session.showSpeakers !== 0;

  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Scroll to + briefly highlight one paragraph by id. Shared by the
  // `#paragraph-N` deep-link effect and the document click listener
  // below, so re-clicking the *same* paragraph link (no hash change,
  // so the effect never reruns) still re-highlights.
  const highlightParagraphById = useCallback(
    (paragraphId: number) => {
      const list = transcriptContent || [];
      const idx = list.findIndex((p) => p.id === paragraphId);
      if (idx < 0 || !virtuosoRef.current) return;
      console.log(
        `[Transcription] Scrolling to paragraph id=${paragraphId} at index=${idx}`
      );
      virtuosoRef.current.scrollToIndex({
        index: idx,
        align: 'center',
        behavior: 'smooth',
      });
      setHighlightedParagraphIndex(idx);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      highlightTimeoutRef.current = setTimeout(
        () => setHighlightedParagraphIndex(null),
        2000
      );
    },
    [transcriptContent]
  );

  // Scroll to paragraph based on hash
  useEffect(() => {
    if (!isTabActive) return;
    if (paragraphs.length > 0 && location.hash) {
      const hash = location.hash.substring(1);
      if (hash.startsWith('paragraph-')) {
        const paragraphIdStr = hash.substring('paragraph-'.length);
        const paragraphId = parseInt(paragraphIdStr, 10);
        if (!isNaN(paragraphId)) {
          const timer = setTimeout(() => {
            highlightParagraphById(paragraphId);
          }, 100);
          return () => clearTimeout(timer);
        }
      }
    }
    return undefined;
  }, [location.hash, paragraphs, isTabActive, highlightParagraphById]);

  // Re-clicking a `#paragraph-N` jump link while already on that hash
  // changes nothing in the router (no location update, so the effect
  // above never reruns and the highlight never returns). Catch those
  // clicks at the document level — Fact Check evidence links portal
  // to `document.body`, outside this subtree — and highlight directly.
  // The router still handles different-hash navigation as before;
  // double triggers are harmless (the clear timeout is reset, not
  // stacked).
  useEffect(() => {
    if (!isTabActive) return;
    const onClick = (event: MouseEvent) => {
      // React Router renders hash-only `to`s as full `href`s (e.g.
      // `/sessions/1/chats/10#paragraph-2`), so match on containment.
      const anchor = (event.target as HTMLElement | null)?.closest?.(
        'a[href*="#paragraph-"]'
      );
      if (!anchor) return;
      const match = anchor.getAttribute('href')?.match(/#paragraph-(\d+)$/);
      if (!match) return;
      highlightParagraphById(parseInt(match[1]!, 10));
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
    };
  }, [isTabActive, highlightParagraphById]);

  const handleSaveParagraphInternal = async (
    paragraphId: number,
    newText: string
  ) => {
    if (isPlaying && playingParagraphIndex === paragraphId) pauseAudio();
    saveParagraphMutation.mutate({ paragraphIndex: paragraphId, newText });
  };

  const handleSpeakerCycle = useCallback(
    (paragraph: TranscriptParagraphData) => {
      if (!paragraph.speaker || uniqueSpeakers.length < 2) return;
      const currentIndex = uniqueSpeakers.indexOf(paragraph.speaker);
      const nextSpeaker =
        uniqueSpeakers[(currentIndex + 1) % uniqueSpeakers.length];
      updateSpeakerMutation.mutate({
        paragraphId: paragraph.id,
        speaker: nextSpeaker,
      });
    },
    [uniqueSpeakers, updateSpeakerMutation]
  );

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

  const handleCopyTranscriptClick = () => {
    if (!transcriptContent || transcriptContent.length === 0) {
      setToast('Transcript is empty.');
      return;
    }
    const fullText = transcriptContent
      .map((p) =>
        speakersVisible && p.speaker ? `${p.speaker}: ${p.text}` : p.text
      )
      .join('\n\n');
    copy(fullText);
    setToast('Transcription copied to clipboard.');
  };

  // Banner state: a confirmed-missing file always shows the amber warning
  // (never a stale error or spinner); genuine media failures stay red and
  // distinguishable.
  const audioStatus: 'missing' | 'error' | 'loading' | 'idle' = audioMissing
    ? 'missing'
    : audioError
      ? 'error'
      : isAudioLoading
        ? 'loading'
        : 'idle';

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
        {isPlaybackAvailable && (
          <audio
            key={audioSrc}
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
            {typeof session?.duration === 'number' &&
              renderHeaderDetail(
                ClockIcon,
                session.duration,
                `Transcript Length`,
                undefined,
                false,
                false,
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
              <AppTooltip content="More Options">
                <DropdownMenu.Trigger>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="1"
                    aria-label="Transcription options"
                  >
                    <DotsHorizontalIcon />
                  </IconButton>
                </DropdownMenu.Trigger>
              </AppTooltip>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  onSelect={() => setIsEditSessionModalOpen(true)}
                >
                  <Pencil1Icon className="mr-2 h-4 w-4" /> Edit Details
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => setIsRenameSpeakersModalOpen(true)}
                  disabled={
                    !transcriptContent || transcriptContent.length === 0
                  }
                >
                  <MixerHorizontalIcon className="mr-2 h-4 w-4" /> Rename
                  Speakers
                </DropdownMenu.Item>
                {hasSpeakers && (
                  <DropdownMenu.Item
                    onSelect={(e) => {
                      e.preventDefault();
                      toggleSpeakersMutation.mutate(!speakersVisible);
                    }}
                    disabled={toggleSpeakersMutation.isPending}
                  >
                    {speakersVisible ? (
                      <EyeOpenIcon className="mr-2 h-4 w-4" />
                    ) : (
                      <EyeClosedIcon className="mr-2 h-4 w-4" />
                    )}{' '}
                    {speakersVisible ? 'Hide' : 'Show'} Speaker Labels
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  onSelect={handleCopyTranscriptClick}
                  disabled={
                    !transcriptContent || transcriptContent.length === 0
                  }
                >
                  <CopyIcon className="mr-2 h-4 w-4" /> Copy Transcript
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  color="red"
                  onSelect={handleDeleteAudioClick}
                  disabled={!hasAudioPath || deleteAudioMutation.isPending}
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
            backgroundColor:
              audioStatus === 'error'
                ? 'var(--red-a3)'
                : audioStatus !== 'idle'
                  ? 'var(--amber-a3)'
                  : 'transparent',
            borderBottom:
              audioStatus !== 'idle'
                ? `1px solid ${audioStatus === 'error' ? 'var(--red-a6)' : 'var(--amber-a6)'}`
                : 'none',
            display: audioStatus !== 'idle' ? 'block' : 'none',
            transition: 'background-color 0.3s ease',
          }}
        >
          <Flex align="center" gap="2">
            {audioStatus === 'loading' && <Spinner size="1" />}
            {audioStatus === 'missing' && (
              <ExclamationTriangleIcon
                width="14"
                height="14"
                style={{ color: 'var(--amber-a11)', flexShrink: 0 }}
              />
            )}
            <Text
              size="1"
              color={audioStatus === 'error' ? 'red' : 'amber'}
              data-testid={
                audioStatus === 'missing'
                  ? 'audio-missing-warning'
                  : audioStatus === 'error'
                    ? 'audio-error-message'
                    : audioStatus === 'loading'
                      ? 'audio-loading-message'
                      : undefined
              }
            >
              {audioStatus === 'missing'
                ? "The audio file doesn't exist."
                : audioError ||
                  (audioStatus === 'loading' ? 'Loading audio...' : '')}
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
          <>
            {hasSpeakers && !speakersVisible && (
              <Callout.Root
                color="blue"
                size="1"
                style={{
                  flexShrink: 0,
                  borderRadius: 0,
                  borderBottom: '1px solid var(--blue-a6)',
                }}
              >
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  <Flex align="center" gap="3" justify="between">
                    <Text size="1">
                      Speaker labels are available but currently hidden from
                      transcripts and AI context.
                    </Text>
                    <Button
                      size="1"
                      variant="soft"
                      color="blue"
                      onClick={() => toggleSpeakersMutation.mutate(true)}
                      disabled={toggleSpeakersMutation.isPending}
                    >
                      Enable speakers
                    </Button>
                  </Flex>
                </Callout.Text>
              </Callout.Root>
            )}
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
                    isAudioAvailable={isPlaybackAvailable}
                    isHighlighted={highlightedParagraphIndex === index}
                    showSpeaker={speakersVisible}
                    onSpeakerCycle={
                      paragraph.speaker && uniqueSpeakers.length >= 2
                        ? () => handleSpeakerCycle(paragraph)
                        : undefined
                    }
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
          </>
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
              &ldquo;{paragraphToDelete?.text}&rdquo;
            </Text>
          </Box>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="gray"
              onClick={() => setIsDeleteParaConfirmOpen(false)}
              disabled={deleteParagraphMutation.isPending}
            >
              Cancel
            </Button>
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
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <EditSessionModal
        isOpen={isEditSessionModalOpen}
        onOpenChange={setIsEditSessionModalOpen}
        session={session}
      />
      <RenameSpeakersModal
        isOpen={isRenameSpeakersModalOpen}
        onOpenChange={setIsRenameSpeakersModalOpen}
        sessionId={session?.id ?? 0}
        transcriptContent={transcriptContent}
      />
    </>
  );
}
