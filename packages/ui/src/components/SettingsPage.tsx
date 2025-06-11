// packages/ui/src/components/SettingsPage.tsx
import React, { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Box,
  Heading,
  Text,
  Flex,
  Switch,
  Button,
  Card,
  Separator,
  Container,
  Grid,
  Tooltip,
  Badge,
  AlertDialog,
  Spinner,
  Callout,
} from '@radix-ui/themes';
import { renderMarkdownAtom } from '../store/ui/renderMarkdownAtom';
import { LlmManagementModal } from './SessionView/Modals/LlmManagementModal';
import {
  MixerVerticalIcon,
  LayoutIcon as RadixLayoutIcon,
  CheckIcon,
  ColorWheelIcon,
  UpdateIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  TrashIcon,
} from '@radix-ui/react-icons';
import {
  accentColorAtom,
  RADIX_ACCENT_COLORS,
  type RadixAccentColor,
  type AccentColorValue,
  toastMessageAtom,
} from '../store';
import { requestReindexElasticsearch, requestResetAllData } from '../api/api';

export function SettingsPage() {
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);
  const [currentAccent, setCurrentAccent] = useAtom(accentColorAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const [isReindexConfirmOpen, setIsReindexConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const reindexMutation = useMutation({
    mutationFn: requestReindexElasticsearch,
    onSuccess: (data) => {
      setToast(`✅ Elasticsearch Re-index: ${data.message}`);
      if (data.errors && data.errors.length > 0) {
        console.warn('Re-indexing completed with errors:', data.errors);
        setToast(
          `⚠️ Re-index finished with ${data.errors.length} error(s). Check server logs.`
        );
      }
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setToast(`❌ Re-index Error: ${error.message}`);
      console.error('Re-index failed:', error);
    },
    onSettled: () => {
      setIsReindexConfirmOpen(false);
    },
  });

  const resetAllDataMutation = useMutation({
    mutationFn: requestResetAllData,
    onSuccess: (data) => {
      setToast(`✅ System Reset: ${data.message}`);
      if (data.errors && data.errors.length > 0) {
        console.warn('Reset completed with errors:', data.errors);
        setToast(
          `⚠️ Reset finished with ${data.errors.length} error(s). Check server logs.`
        );
      }
      // Invalidate all queries to refetch data from a now-empty state
      queryClient.invalidateQueries();
    },
    onError: (error: Error) => {
      setToast(`❌ System Reset Error: ${error.message}`);
      console.error('System reset failed:', error);
    },
    onSettled: () => {
      setIsResetConfirmOpen(false);
    },
  });

  const handleMarkdownToggle = () => {
    setRenderMarkdown(!renderMarkdown);
  };

  const handleAccentColorSelect = (color: RadixAccentColor) => {
    setCurrentAccent(color as AccentColorValue);
  };

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const handleReindexClick = () => {
    setIsReindexConfirmOpen(true);
  };
  const handleConfirmReindex = () => {
    reindexMutation.mutate();
  };

  const handleResetAllDataClick = () => {
    setIsResetConfirmOpen(true);
  };
  const handleConfirmResetAllData = () => {
    resetAllDataMutation.mutate();
  };

  return (
    <>
      <Container size="3" px="4" py="6">
        <Heading
          as="h1"
          size="7"
          mb="6"
          className="text-gray-900 dark:text-gray-100"
        >
          Application Settings
        </Heading>

        <Card mb="6">
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200"
            >
              Appearance
            </Heading>
            <Flex align="center" justify="between" mb="4">
              <Flex align="center" gap="2">
                <RadixLayoutIcon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400"
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
                  Render AI messages as Markdown
                </Text>
              </Flex>
              <Switch
                checked={renderMarkdown}
                onCheckedChange={handleMarkdownToggle}
                aria-label="Toggle Markdown rendering for AI responses"
              />
            </Flex>
            <Text size="2" color="gray">
              When enabled, AI responses in chat interfaces will be formatted
              using Markdown. Disable for plain text.
            </Text>
            <Separator my="5" size="4" />
            <Flex align="center" gap="2" mb="3">
              <ColorWheelIcon
                width="20"
                height="20"
                className="text-gray-600 dark:text-gray-400"
              />
              <Text size="3" className="text-gray-700 dark:text-gray-300">
                Accent Color
              </Text>
            </Flex>
            <Grid columns={{ initial: '4', xs: '5', sm: '6', md: '8' }} gap="2">
              {RADIX_ACCENT_COLORS.map((color: RadixAccentColor) => (
                <Tooltip key={color} content={capitalize(color)}>
                  <Button
                    variant={currentAccent === color ? 'solid' : 'outline'}
                    color={
                      color as React.ComponentProps<typeof Button>['color']
                    }
                    onClick={() => handleAccentColorSelect(color)}
                    style={{
                      width: '100%',
                      height: '36px',
                      padding: '0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color:
                        currentAccent === color &&
                        [
                          'ruby',
                          'crimson',
                          'plum',
                          'purple',
                          'violet',
                          'iris',
                          'indigo',
                          'blue',
                          'sky',
                          'cyan',
                          'teal',
                          'jade',
                          'green',
                          'grass',
                          'brown',
                          'gray',
                        ].includes(color)
                          ? 'white'
                          : 'var(--gray-12)',
                    }}
                    title={`Set accent to ${capitalize(color)}`}
                    aria-pressed={currentAccent === color}
                  >
                    {currentAccent === color ? (
                      <CheckIcon width="18" height="18" />
                    ) : (
                      <Box
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          backgroundColor: `var(--${color}-9)`,
                        }}
                      />
                    )}
                  </Button>
                </Tooltip>
              ))}
            </Grid>
            <Text size="2" color="gray" mt="3">
              Select an accent color for the application theme. Changes will
              apply immediately. Your preference is saved locally.
            </Text>
          </Box>
        </Card>

        <Card mb="6">
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200"
            >
              Language Model Management
            </Heading>
            <Flex align="center" justify="between">
              <Flex align="center" gap="2">
                <MixerVerticalIcon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400"
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
                  Manage AI Models
                </Text>
              </Flex>
              <Button variant="soft" onClick={() => setIsLlmModalOpen(true)}>
                Open Model Manager
              </Button>
            </Flex>
            <Text size="2" color="gray" mt="2">
              View available models, download new ones, or set the active model
              for analysis.
            </Text>
          </Box>
        </Card>

        <Card mb="6">
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="4"
              className="text-gray-800 dark:text-gray-200"
            >
              Data Management
            </Heading>
            <Flex align="center" justify="between" mb="2">
              <Flex align="center" gap="2">
                <UpdateIcon
                  width="20"
                  height="20"
                  className="text-gray-600 dark:text-gray-400"
                />
                <Text size="3" className="text-gray-700 dark:text-gray-300">
                  Search Index
                </Text>
              </Flex>
              <Button
                variant="outline"
                color="orange"
                onClick={handleReindexClick}
                disabled={reindexMutation.isPending}
              >
                {reindexMutation.isPending ? (
                  <>
                    <Spinner size="1" /> Re-indexing...
                  </>
                ) : (
                  'Re-index All Data'
                )}
              </Button>
            </Flex>
            <Text size="2" color="gray">
              This will delete all current search index data and re-build it
              from the database. Use if search results seem inconsistent or
              after major data changes. This can take some time.
            </Text>
            {reindexMutation.isError && (
              <Callout.Root color="red" size="1" mt="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Re-index failed: {reindexMutation.error.message}
                </Callout.Text>
              </Callout.Root>
            )}
            {reindexMutation.isSuccess &&
              reindexMutation.data?.errors?.length > 0 && (
                <Callout.Root color="amber" size="1" mt="3">
                  <Callout.Icon>
                    <InfoCircledIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    Re-indexing completed with{' '}
                    {reindexMutation.data.errors.length} error(s). Check server
                    logs.
                    {reindexMutation.data.errors.map((err, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: '0.9em',
                          opacity: 0.8,
                          marginLeft: '1em',
                        }}
                      >
                        -{' '}
                        {err.length > 100 ? err.substring(0, 100) + '...' : err}
                      </div>
                    ))}
                  </Callout.Text>
                </Callout.Root>
              )}
          </Box>
        </Card>

        <Card
          variant="surface"
          style={{ '--card-background': 'var(--red-2)' } as React.CSSProperties}
        >
          <Box p="4">
            <Heading
              as="h2"
              size="5"
              mb="2"
              className="text-red-800 dark:text-red-100"
            >
              Danger Zone
            </Heading>
            <Separator
              my="3"
              size="4"
              style={{ backgroundColor: 'var(--red-6)' }}
            />
            <Flex align="center" justify="between" mb="2">
              <Box>
                <Text
                  size="3"
                  weight="medium"
                  className="text-red-800 dark:text-red-200"
                >
                  Reset All Application Data
                </Text>
                <Text as="p" size="2" color="red" mt="1">
                  This will permanently delete all sessions, chats, messages,
                  and transcripts from the database and search index. This
                  action cannot be undone.
                </Text>
              </Box>
              <Button
                color="red"
                variant="solid"
                onClick={handleResetAllDataClick}
                disabled={resetAllDataMutation.isPending}
              >
                {resetAllDataMutation.isPending ? <Spinner /> : <TrashIcon />}
                <Text ml="2">Reset Everything</Text>
              </Button>
            </Flex>
          </Box>
        </Card>
      </Container>

      <LlmManagementModal
        isOpen={isLlmModalOpen}
        onOpenChange={setIsLlmModalOpen}
      />

      <AlertDialog.Root
        open={isReindexConfirmOpen}
        onOpenChange={setIsReindexConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Confirm Re-index</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete all existing search index data and
            re-index everything from the database? This operation can take some
            time and cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={reindexMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="orange"
                onClick={handleConfirmReindex}
                disabled={reindexMutation.isPending}
              >
                {reindexMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <UpdateIcon />
                )}
                <Text ml={reindexMutation.isPending ? '2' : '1'}>
                  {reindexMutation.isPending
                    ? 'Re-indexing...'
                    : 'Confirm Re-index'}
                </Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={isResetConfirmOpen}
        onOpenChange={setIsResetConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Confirm System Reset</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This is your final confirmation. Are you absolutely sure you want to
            delete ALL data? This includes all sessions, chats, and starred
            templates. This action cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={resetAllDataMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmResetAllData}
                disabled={resetAllDataMutation.isPending}
              >
                {resetAllDataMutation.isPending ? (
                  <Spinner size="1" />
                ) : (
                  <TrashIcon />
                )}
                <Text ml={resetAllDataMutation.isPending ? '2' : '1'}>
                  {resetAllDataMutation.isPending
                    ? 'Resetting...'
                    : 'Yes, Delete Everything'}
                </Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
