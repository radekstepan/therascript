/* packages/ui/src/components/SessionView/Chat/StarredTemplatesList.tsx */
import React, { useEffect } from 'react'; // Added useEffect
import { useQuery } from '@tanstack/react-query'; // For fetching starred messages data
import {
  Button,
  Box,
  Text,
  Flex,
  ScrollArea,
  Spinner,
  Callout,
} from '@radix-ui/themes'; // Import Callout
import { StarIcon, Cross1Icon, InfoCircledIcon } from '@radix-ui/react-icons';
import { cn } from '../../../utils'; // Utility for combining class names
import type { ChatMessage } from '../../../types'; // Type for starred messages
import { fetchStarredMessages } from '../../../api/api'; // API function to fetch starred messages

interface StarredTemplatesProps {
  onSelectTemplate: (text: string) => void; // Callback when a template is clicked
  onClose: () => void; // Callback to close the popover
}

/**
 * Fetches and displays a list of starred messages (templates) in a popover.
 * Allows users to select a template to insert into the chat input.
 */
export function StarredTemplatesList({
  onSelectTemplate,
  onClose,
}: StarredTemplatesProps) {
  // --- Fetch starred messages using React Query ---
  const {
    data: starredMessages,
    isLoading,
    error,
  } = useQuery<ChatMessage[], Error>({
    queryKey: ['starredMessages'], // Unique key for caching this query
    queryFn: fetchStarredMessages, // The API function to call
    staleTime: 5 * 60 * 1000, // Cache data for 5 minutes before considering it stale
  });
  // --- End Fetch ---

  // --- Escape Key Handler ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    // Add listener when the component mounts (popover is open)
    document.addEventListener('keydown', handleKeyDown);
    // Remove listener when the component unmounts (popover closes)
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]); // Dependency on onClose ensures the correct function is called

  // CSS classes for the popover container
  const popoverClasses = cn(
    'absolute bottom-full mb-2 left-0 z-50', // Positioning relative to the trigger button
    'w-72 max-h-60 overflow-hidden flex flex-col', // Size constraints and layout
    'rounded-md border shadow-lg', // Appearance
    'bg-[--color-panel-solid] border-[--gray-a6]' // Radix theme variables for background and border
  );

  return (
    // Popover container
    <Box
      className={popoverClasses}
      style={{
        backgroundColor: 'var(--color-panel-solid)',
        borderColor: 'var(--gray-a6)',
      }}
    >
      {/* Popover Header */}
      <Flex
        justify="between"
        align="center"
        p="2"
        flexShrink="0"
        className="border-b"
        style={{ borderColor: 'var(--gray-a6)' }}
      >
        <Text size="1" weight="medium" color="gray">
          Starred Templates
        </Text>
        {/* Close button */}
        <Button
          variant="ghost"
          size="1"
          color="gray"
          onClick={onClose}
          highContrast
        >
          <Cross1Icon />
        </Button>
      </Flex>
      {/* Scrollable Content Area */}
      <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
        <Box p="1">
          {/* Loading State */}
          {isLoading ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              <Spinner size="2" />{' '}
              <Text ml="2" size="2" color="gray">
                Loading...
              </Text>
            </Flex>
          ) : /* Error State */
          error ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              {/* Use Callout for better error display */}
              <Callout.Root color="red" size="1" style={{ width: '100%' }}>
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>Error: {error.message}</Callout.Text>
              </Callout.Root>
            </Flex>
          ) : /* Empty State */
          !starredMessages || starredMessages.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              <Text size="2" color="gray" align="center">
                No starred messages found. <br /> Click the ☆ next to a user
                message to save it as a template.
              </Text>
            </Flex>
          ) : (
            /* Data Loaded State */
            // Sort messages alphabetically by starred name, falling back to text snippet
            [...starredMessages]
              .sort((a, b) =>
                (a.starredName || a.text).localeCompare(b.starredName || b.text)
              )
              .map((msg) => {
                // Determine display name: use starredName if available, otherwise truncate message text
                const displayName =
                  msg.starredName ||
                  msg.text.substring(0, 50) +
                    (msg.text.length > 50 ? '...' : '');
                return (
                  // Button for each template
                  <Button
                    key={msg.id}
                    variant="ghost"
                    // Call the onSelectTemplate callback with the full message text when clicked
                    onClick={() => onSelectTemplate(msg.text)}
                    // Styling for button appearance and text wrapping
                    className="block w-full h-auto text-left p-2 text-sm rounded whitespace-normal justify-start"
                    style={{
                      whiteSpace: 'normal',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                    }}
                    // Tooltip showing a longer preview of the message text
                    title={`Insert: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`}
                    size="2"
                  >
                    {displayName}
                  </Button>
                );
              })
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}
