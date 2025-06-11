// packages/ui/src/components/Transcription/TranscriptParagraph.tsx
import React, {
  useState,
  useRef,
  useEffect,
  Dispatch,
  SetStateAction,
} from 'react';
import {
  Button,
  TextArea,
  Flex,
  Box,
  IconButton,
  Tooltip,
  Text,
} from '@radix-ui/themes';
import {
  Pencil1Icon,
  CheckIcon,
  Cross1Icon,
  PlayIcon,
  PauseIcon,
  UpdateIcon,
  ClockIcon,
} from '@radix-ui/react-icons';
import { cn } from '../../utils';
import type { TranscriptParagraphData } from '../../types';

const textStyles = {
  whiteSpace: 'pre-wrap' as const,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-2)',
  lineHeight: 'var(--line-height-3)',
  wordBreak: 'break-word' as const,
  color: 'var(--gray-a12)',
};

const formatParagraphTimestamp = (ms: number | undefined): string => {
  if (ms === undefined || isNaN(ms)) return '';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

interface TranscriptParagraphProps {
  paragraph: TranscriptParagraphData;
  index: number;
  onSave: (index: number, newText: string) => Promise<void> | void;
  activeEditIndex: number | null;
  setActiveEditIndex: Dispatch<SetStateAction<number | null>>;
  isSaving: boolean;
  onPlayToggle: (timestampMs: number, index: number) => void;
  isPlaying: boolean;
  isAudioAvailable: boolean;
}

export function TranscriptParagraph({
  paragraph,
  index,
  onSave,
  activeEditIndex,
  setActiveEditIndex,
  isSaving,
  onPlayToggle,
  isPlaying,
  isAudioAvailable,
}: TranscriptParagraphProps) {
  const [editValue, setEditValue] = useState(paragraph.text);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const isEditing = activeEditIndex === index;

  const paragraphDomId = `paragraph-${paragraph.id}`;

  // Effect for handling actions when entering or exiting edit mode
  useEffect(() => {
    if (isEditing) {
      // When entering edit mode
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ width: rect.width, height: rect.height });
      }
      // Defer focus and select to ensure textarea is rendered and ready
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.select(); // Select all text only when entering edit mode
        }
      });
    }
  }, [isEditing]); // This effect runs only when `isEditing` changes

  // Effect for syncing `editValue` with `paragraph.text` prop changes when NOT editing
  useEffect(() => {
    if (!isEditing) {
      // If not editing, and the paragraph text prop changes, update local editValue.
      // Also ensures editValue is reset if isEditing becomes false (e.g., on cancel).
      // The check `paragraph.text !== editValue` prevents unnecessary re-renders if
      // `setEditValue` was already called with the same `paragraph.text` (e.g., in handleCancel).
      if (paragraph.text !== editValue) {
        setEditValue(paragraph.text);
      }
    }
    // If `isEditing` is true, user input controls `editValue`.
    // Prop changes to `paragraph.text` during an active edit are intentionally ignored
    // by this effect to preserve the user's current unsaved changes.
  }, [paragraph.text, isEditing, editValue]);

  const handleEditClick = () => {
    if (isPlaying) {
      onPlayToggle(paragraph.timestamp, index);
    }
    setEditValue(paragraph.text); // Reset editValue to original text before editing
    setActiveEditIndex(index); // This will set isEditing to true and trigger the above useEffect
  };

  const handleCancel = () => {
    if (isSaving) return;
    setActiveEditIndex(null); // Sets isEditing to false
    setEditValue(paragraph.text); // Explicitly reset editValue to original
  };

  const handleSave = async () => {
    const trimmedValue = editValue.trim();
    if (isSaving) return;
    if (trimmedValue !== paragraph.text.trim()) {
      try {
        await onSave(index, trimmedValue);
        // setActiveEditIndex(null) is called by onSave success/error in parent or here if needed
      } catch (error) {
        console.error(`Error saving paragraph ${index}:`, error);
        // Optionally handle error display here if not handled by parent
      }
    } else {
      // If no actual change, just exit edit mode
      setActiveEditIndex(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const handlePlayPauseClick = () => {
    if (!isAudioAvailable) return;
    onPlayToggle(paragraph.timestamp, index);
  };

  const renderContent = (isVisible: boolean = true) => (
    <Flex
      align="start"
      gap="2"
      className="group p-1"
      style={{ visibility: isVisible ? 'visible' : 'hidden' }}
    >
      <Flex
        direction="column"
        align="center"
        className="flex-shrink-0 mt-px pt-px"
      >
        {isAudioAvailable && (
          <Tooltip
            content={
              isPlaying
                ? `Pause playback (from ${formatParagraphTimestamp(paragraph.timestamp)})`
                : `Play from ${formatParagraphTimestamp(paragraph.timestamp)}`
            }
          >
            <IconButton
              variant="ghost"
              color={isPlaying ? 'blue' : 'gray'}
              size="1"
              className={cn(
                'transition-opacity p-0 h-5 w-5',
                isEditing ||
                  isPlaying ||
                  'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              )}
              onClick={handlePlayPauseClick}
              title={isPlaying ? 'Pause' : 'Play'}
              aria-label={
                isPlaying
                  ? 'Pause paragraph playback'
                  : 'Play paragraph from timestamp'
              }
              disabled={isEditing}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </IconButton>
          </Tooltip>
        )}
        {!isAudioAvailable && (
          <Tooltip
            content={`Timestamp: ${formatParagraphTimestamp(paragraph.timestamp)} (Audio not available)`}
          >
            <Box className="h-5 w-5 flex items-center justify-center">
              <ClockIcon width="12" height="12" className="text-[--gray-a9]" />
            </Box>
          </Tooltip>
        )}
      </Flex>

      <Box
        as="div"
        className="flex-grow"
        style={textStyles}
        id={paragraphDomId}
      >
        {paragraph.text.trim() ? (
          paragraph.text
        ) : (
          <span style={{ fontStyle: 'italic', color: 'var(--gray-a9)' }}>
            [Empty Paragraph]
          </span>
        )}
      </Box>

      <Flex align="center" className="flex-shrink-0 mt-px pt-px">
        <Tooltip content="Edit paragraph">
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            className={cn(
              'transition-opacity p-0 h-5 w-5',
              !isEditing &&
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
            )}
            onClick={handleEditClick}
            aria-label="Edit paragraph"
            disabled={isEditing}
          >
            <Pencil1Icon />
          </IconButton>
        </Tooltip>
      </Flex>
    </Flex>
  );

  return (
    <Box
      ref={containerRef}
      className={cn(
        'rounded transition-colors duration-150',
        !isEditing && 'hover:bg-[--gray-a3]',
        isPlaying && isAudioAvailable && 'bg-[--blue-a3]'
      )}
      style={{ position: 'relative' }}
    >
      {isEditing ? (
        <>
          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              zIndex: 10,
              padding: 'var(--space-1)',
              backgroundColor: 'var(--color-panel-solid)',
              borderRadius: 'var(--radius-2)',
              boxShadow: 'var(--shadow-3)',
              border: `1px solid var(--gray-a6)`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Flex direction="column" gap="2">
              <Flex align="center" justify="start" gap="1" px="1">
                <ClockIcon
                  width="12"
                  height="12"
                  className="text-[--gray-a10]"
                />
                <Text size="1" color="gray">
                  Timestamp: {formatParagraphTimestamp(paragraph.timestamp)}
                </Text>
              </Flex>
              <TextArea
                ref={textareaRef}
                value={editValue}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setEditValue(e.target.value)
                }
                placeholder="Enter paragraph text..."
                size="2"
                style={{
                  ...textStyles,
                  width: '100%',
                  minHeight:
                    dimensions.height > 50 ? `${dimensions.height}px` : '80px',
                  backgroundColor: 'var(--color-panel-translucent)',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-2)',
                  border: '1px solid var(--gray-a7)',
                }}
                onKeyDown={handleKeyDown}
                aria-label={`Edit paragraph ${index + 1}`}
                disabled={isSaving}
              />
              <Flex justify="end" gap="2" mt="1">
                <Button
                  onClick={handleCancel}
                  size="1"
                  variant="soft"
                  color="gray"
                  title="Cancel (Esc)"
                  disabled={isSaving}
                >
                  <Cross1Icon /> Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  size="1"
                  variant="solid"
                  title="Save (Ctrl+Enter)"
                  disabled={
                    isSaving || editValue.trim() === paragraph.text.trim()
                  }
                >
                  {isSaving ? (
                    <UpdateIcon className="animate-spin" />
                  ) : (
                    <CheckIcon />
                  )}{' '}
                  Save
                </Button>
              </Flex>
            </Flex>
          </Box>
          {/* Render placeholder content with original dimensions to prevent layout shift */}
          {renderContent(false)}
        </>
      ) : (
        renderContent(true)
      )}
    </Box>
  );
}
