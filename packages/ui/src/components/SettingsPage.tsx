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
  Strong,
} from '@radix-ui/themes';
import { renderMarkdownAtom } from '../store/ui/renderMarkdownAtom';
import { LlmManagementModal } from './SessionView/Modals/LlmManagementModal';
import { UsageSection } from './UsageSection';
import {
  MixerVerticalIcon,
  LayoutIcon as RadixLayoutIcon,
  CheckIcon,
  ColorWheelIcon,
  UpdateIcon,
  ExclamationTriangleIcon,
  InfoCircledIcon,
  TrashIcon,
  DownloadIcon,
  UploadIcon,
} from '@radix-ui/react-icons';
import {
  accentColorAtom,
  RADIX_ACCENT_COLORS,
  type RadixAccentColor,
  type AccentColorValue,
  toastMessageAtom,
} from '../store';
import {
  requestReindexElasticsearch,
  requestResetAllData,
  requestImportData,
} from '../api/api';
import { cn } from '../utils';
import axios from 'axios';

const API_BASE_URL = axios.defaults.baseURL || 'http://localhost:3001';

export function SettingsPage() {
  const [renderMarkdown, setRenderMarkdown] = useAtom(renderMarkdownAtom);
  const [isLlmModalOpen, setIsLlmModalOpen] = useState(false);
  const [currentAccent, setCurrentAccent] = useAtom(accentColorAtom);
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const [isReindexConfirmOpen, setIsReindexConfirmOpen] = useState(false);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

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

  const importMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('backupFile', file);
      return requestImportData(formData);
    },
    onSuccess: (data) => {
      setToast(`✅ Import successful: ${data.message}`);
      queryClient.invalidateQueries();
      setImportFile(null);
    },
    onError: (error: Error) => {
      setToast(`❌ Import failed: ${error.message}`);
    },
    onSettled: () => {
      setIsImportConfirmOpen(false);
    },
  });

  const handleMarkdownToggle = () => setRenderMarkdown(!renderMarkdown);
  const handleAccentColorSelect = (color: RadixAccentColor) =>
    setCurrentAccent(color as AccentColorValue);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const handleReindexClick = () => setIsReindexConfirmOpen(true);
  const handleConfirmReindex = () => reindexMutation.mutate();

  const handleResetAllDataClick = () => setIsResetConfirmOpen(true);
  const handleConfirmResetAllData = () => resetAllDataMutation.mutate();

  const handleExportClick = () => {
    window.location.href = `${API_BASE_URL}/api/admin/export-data`;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type === 'application/x-tar' || file.name.endsWith('.tar')) {
        setImportFile(file);
      } else {
        setToast('Invalid file type. Please select a .tar backup file.');
        setImportFile(null);
        e.target.value = '';
      }
    }
  };

  const handleImportClick = () => {
    if (importFile) setIsImportConfirmOpen(true);
    else setToast('Please select a backup file to import.');
  };

  const handleConfirmImport = () => {
    if (importFile) importMutation.mutate(importFile);
  };

  return (
    <>
      <Box
        className={cn(
          'flex-grow flex flex-col overflow-y-auto',
          'px-4 md:px-6 lg:px-8',
          'py-6'
        )}
      >
        <Container size="3">
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
              <Heading as="h2" size="5" mb="4">
                Appearance
              </Heading>
              <Flex align="center" justify="between" mb="4">
                <Flex align="center" gap="2">
                  <RadixLayoutIcon width="20" height="20" />
                  <Text size="3">Render AI messages as Markdown</Text>
                </Flex>
                <Switch
                  checked={renderMarkdown}
                  onCheckedChange={handleMarkdownToggle}
                />
              </Flex>
              <Separator my="5" size="4" />
              <Flex align="center" gap="2" mb="3">
                <ColorWheelIcon width="20" height="20" />
                <Text size="3">Accent Color</Text>
              </Flex>
              <Grid
                columns={{ initial: '4', xs: '5', sm: '6', md: '8' }}
                gap="2"
              >
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
            </Box>
          </Card>

          <Card mb="6">
            <Box p="4">
              <Heading as="h2" size="5" mb="4">
                Language Model Management
              </Heading>
              <Flex align="center" justify="between">
                <Flex align="center" gap="2">
                  <MixerVerticalIcon width="20" height="20" />
                  <Text size="3">Manage AI Models</Text>
                </Flex>
                <Button variant="soft" onClick={() => setIsLlmModalOpen(true)}>
                  Open Model Manager
                </Button>
              </Flex>
            </Box>
          </Card>

          <Card
            variant="surface"
            style={
              { '--card-background': 'var(--amber-2)' } as React.CSSProperties
            }
            mb="6"
          >
            <Box p="4">
              <Heading as="h2" size="5" mb="4">
                Data Management
              </Heading>
              {/* Export */}
              <Flex align="center" justify="between" mb="2">
                <Text size="3" weight="medium">
                  Export All Data
                </Text>
                <Button variant="soft" onClick={handleExportClick}>
                  <DownloadIcon /> Export All Data
                </Button>
              </Flex>
              <Text as="p" size="2" color="gray" mb="4">
                Download a full backup of your database and uploaded audio files
                as a single `.tar` archive.
              </Text>
              <Separator my="4" size="4" />
              {/* Import */}
              <Text as="div" size="3" weight="medium" mb="2">
                Import Backup
              </Text>
              <Flex gap="3" align="center">
                <input
                  type="file"
                  accept=".tar,application/x-tar"
                  onChange={handleFileChange}
                  style={{ flexGrow: 1 }}
                  className="text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent-a3)] file:text-[var(--accent-a11)] hover:file:bg-[var(--accent-a4)]"
                />
                <Button
                  variant="outline"
                  onClick={handleImportClick}
                  disabled={!importFile || importMutation.isPending}
                >
                  {importMutation.isPending ? <Spinner /> : <UploadIcon />}
                  <Text ml="1">Import</Text>
                </Button>
              </Flex>
              <Callout.Root color="amber" size="1" mt="3">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  <Strong>Warning:</Strong> Importing a backup will completely
                  overwrite all current data. This action cannot be undone.
                </Callout.Text>
              </Callout.Root>
            </Box>
          </Card>

          <Card mb="6">
            <Box p="4">
              <Heading as="h2" size="5" mb="4">
                Usage & Cost
              </Heading>
              <UsageSection />
            </Box>
          </Card>

          <Card
            variant="surface"
            style={
              { '--card-background': 'var(--red-2)' } as React.CSSProperties
            }
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
                <Text
                  size="3"
                  weight="medium"
                  className="text-red-800 dark:text-red-200"
                >
                  Re-index Search Data
                </Text>
                <Button
                  variant="outline"
                  color="orange"
                  onClick={handleReindexClick}
                  disabled={reindexMutation.isPending}
                >
                  {reindexMutation.isPending ? <Spinner /> : <UpdateIcon />}
                  <Text ml="1">Re-index Search</Text>
                </Button>
              </Flex>
              <Text as="p" size="2" color="red" mb="4">
                Rebuilds the search index from the database. Use if search
                results are inconsistent.
              </Text>
              <Separator
                my="3"
                size="4"
                style={{ backgroundColor: 'var(--red-6)' }}
              />
              <Box>
                <Flex align="center" justify="between">
                  <Text
                    size="3"
                    weight="medium"
                    className="text-red-800 dark:text-red-200"
                  >
                    Reset All Application Data
                  </Text>
                  <Button
                    color="red"
                    variant="solid"
                    onClick={handleResetAllDataClick}
                    disabled={resetAllDataMutation.isPending}
                  >
                    {resetAllDataMutation.isPending ? (
                      <Spinner />
                    ) : (
                      <TrashIcon />
                    )}
                    <Text ml="2">Reset Everything</Text>
                  </Button>
                </Flex>
                <Text as="p" size="2" color="red" mt="1">
                  Permanently deletes all sessions, chats, and files. This
                  action cannot be undone.
                </Text>
              </Box>
            </Box>
          </Card>
        </Container>
      </Box>

      <LlmManagementModal
        isOpen={isLlmModalOpen}
        onOpenChange={setIsLlmModalOpen}
      />

      <AlertDialog.Root
        open={isImportConfirmOpen}
        onOpenChange={setIsImportConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Confirm Data Import</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to import from{' '}
            <Strong>{importFile?.name}</Strong>? All current data in the
            application will be permanently deleted and replaced with the
            contents of this backup. This cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={importMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmImport}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? <Spinner /> : <UploadIcon />}
                <Text ml="1">Yes, Import Backup</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={isReindexConfirmOpen}
        onOpenChange={setIsReindexConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Confirm Re-index</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete all existing search index data and
            re-index everything?
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
                {reindexMutation.isPending ? <Spinner /> : <UpdateIcon />}
                <Text ml="1">Confirm Re-index</Text>
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
            delete ALL data?
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
                {resetAllDataMutation.isPending ? <Spinner /> : <TrashIcon />}
                <Text ml="1">Yes, Delete Everything</Text>
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
