// packages/ui/src/components/SystemPromptsPage.tsx
import React, { useState, useCallback, RefObject, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import {
  Box,
  Heading,
  Flex,
  Text,
  Spinner,
  Card,
  Grid,
  ScrollArea,
  Button,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { Pencil1Icon } from '@radix-ui/react-icons';
import { toastMessageAtom } from '../store';
import type { Template } from '../types';
import { fetchTemplates, updateTemplate } from '../api/templates';
import { EditEntityModal } from './Shared/EditEntityModal';
import { formatTimestamp } from '../helpers';

interface PromptFormState {
  title: string;
  text: string;
}

const formatTitleForDisplay = (title: string): string => {
  return title
    .replace(/^system_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

export function SystemPromptsPage() {
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [promptToEdit, setPromptToEdit] = useState<Template | null>(null);

  const {
    data: templates,
    isLoading,
    error,
  } = useQuery<Template[], Error>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  });

  const systemPrompts = useMemo(() => {
    if (!templates) return [];
    return templates.filter((template) => template.title.startsWith('system_'));
  }, [templates]);

  const updateMutation = useMutation({
    mutationFn: (vars: { id: number; data: { title: string; text: string } }) =>
      updateTemplate(vars.id, vars.data),
    onSuccess: () => {
      setToast('System prompt updated successfully.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setIsEditModalOpen(false);
      setPromptToEdit(null);
    },
    onError: (err: Error) => {
      setToast(`Error updating prompt: ${err.message}`);
    },
  });

  const handleEdit = (prompt: Template) => {
    setPromptToEdit(prompt);
    setIsEditModalOpen(true);
  };

  const getInitialFormState = useCallback(
    (entity: Template | null): PromptFormState => ({
      title: entity?.title || '',
      text: entity?.text || '',
    }),
    []
  );

  const validateForm = useCallback(
    (formState: PromptFormState): string | null => {
      if (!formState.text.trim()) return 'Prompt text cannot be empty.';
      return null;
    },
    []
  );

  const handleSave = useCallback(
    async (entityId: number, validatedState: PromptFormState) => {
      if (promptToEdit) {
        updateMutation.mutate({
          id: promptToEdit.id,
          data: { title: promptToEdit.title, text: validatedState.text }, // Ensure title is not changed
        });
      }
    },
    [promptToEdit, updateMutation]
  );

  const renderFormFields = useCallback(
    (
      formState: PromptFormState,
      setFormState: React.Dispatch<React.SetStateAction<PromptFormState>>,
      isSaving: boolean,
      firstInputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
    ): React.ReactNode => (
      <Flex direction="column" gap="3">
        <label>
          <Text as="div" size="2" mb="1" weight="medium">
            Title (Read-only)
          </Text>
          <TextField.Root
            value={formatTitleForDisplay(formState.title)}
            disabled={true}
          />
        </label>
        <label>
          <Text as="div" size="2" mb="1" weight="medium">
            Prompt Text
          </Text>
          <TextArea
            ref={firstInputRef as React.RefObject<HTMLTextAreaElement>}
            placeholder="Enter the prompt text..."
            value={formState.text}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, text: e.target.value }))
            }
            disabled={isSaving}
            rows={15}
            style={{
              minHeight: 250,
              resize: 'vertical',
              fontFamily: 'var(--font-mono)',
            }}
          />
        </label>
      </Flex>
    ),
    []
  );

  if (isLoading) {
    return (
      <Flex align="center" justify="center" p="6" style={{ height: '100%' }}>
        <Spinner size="3" /> <Text ml="2">Loading system prompts...</Text>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex align="center" justify="center" p="6" style={{ height: '100%' }}>
        <Text color="red">Error loading prompts: {error.message}</Text>
      </Flex>
    );
  }

  return (
    <>
      <Box
        className="flex-grow flex flex-col"
        px={{ initial: '4', md: '6' }}
        py="6"
      >
        <Flex justify="between" align="center" mb="6">
          <Heading as="h1" size="7">
            System Prompts
          </Heading>
        </Flex>

        {systemPrompts.length > 0 ? (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            <Grid columns={{ initial: '1' }} gap="4" pr="4">
              {systemPrompts.map((prompt) => (
                <Card key={prompt.id}>
                  <Flex direction="column" gap="2" height="100%">
                    <Flex justify="between" align="start">
                      <Heading as="h3" size="4" trim="start">
                        {formatTitleForDisplay(prompt.title)}
                      </Heading>
                      <Button
                        variant="soft"
                        size="1"
                        onClick={() => handleEdit(prompt)}
                      >
                        <Pencil1Icon />
                        Edit
                      </Button>
                    </Flex>
                    <Text
                      as="p"
                      color="gray"
                      size="2"
                      className="line-clamp-4 flex-grow"
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {prompt.text}
                    </Text>
                    <Box mt="auto" pt="2">
                      <Text size="1" color="gray">
                        Last Updated: {formatTimestamp(prompt.createdAt)}
                      </Text>
                    </Box>
                  </Flex>
                </Card>
              ))}
            </Grid>
          </ScrollArea>
        ) : (
          <Card>
            <Flex
              direction="column"
              align="center"
              justify="center"
              p="6"
              gap="3"
            >
              <Text color="gray">No system prompts found in the database.</Text>
            </Flex>
          </Card>
        )}
      </Box>

      <EditEntityModal<Template | null, PromptFormState>
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditModalOpen(false);
            setPromptToEdit(null);
          }
        }}
        entity={promptToEdit}
        entityTypeLabel="System Prompt"
        getInitialFormState={getInitialFormState}
        renderFormFields={renderFormFields}
        validateForm={validateForm}
        onSave={(id, state) => handleSave(id, state)}
        isSaving={updateMutation.isPending}
        saveError={updateMutation.error?.message}
      />
    </>
  );
}
