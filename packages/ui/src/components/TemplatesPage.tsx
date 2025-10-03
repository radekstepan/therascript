// packages/ui/src/components/TemplatesPage.tsx
import React, { useState, useCallback, RefObject, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import {
  Box,
  Heading,
  Flex,
  Text,
  Button,
  Spinner,
  Card,
  Grid,
  ScrollArea,
  IconButton,
  AlertDialog,
  TextArea,
  TextField,
  Separator,
  Callout,
} from '@radix-ui/themes';
import {
  PlusCircledIcon,
  Pencil1Icon,
  TrashIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { BrainCircuit } from 'lucide-react';
import { toastMessageAtom } from '../store';
import type { Template } from '../types';
import {
  fetchTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../api/templates';
import { EditEntityModal } from './Shared/EditEntityModal';
import { formatTimestamp } from '../helpers';

interface TemplateFormState {
  title: string;
  text: string;
}

const formatTitleForDisplay = (title: string): string => {
  if (title.startsWith('system_')) {
    return title
      .replace(/^system_/, '')
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return title;
};

export function TemplatesPage() {
  const setToast = useSetAtom(toastMessageAtom);
  const queryClient = useQueryClient();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [templateToEdit, setTemplateToEdit] = useState<Template | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<Template | null>(
    null
  );

  const {
    data: templates,
    isLoading,
    error,
  } = useQuery<Template[], Error>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  });

  const { userTemplates, systemPrompts } = useMemo(() => {
    if (!templates) return { userTemplates: [], systemPrompts: [] };
    const user: Template[] = [];
    const system: Template[] = [];
    templates.forEach((t) => {
      if (t.title.startsWith('system_')) {
        system.push(t);
      } else {
        user.push(t);
      }
    });
    return { userTemplates: user, systemPrompts: system };
  }, [templates]);

  const mutationCallbacks = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err: Error) => {
      setToast(`Error: ${err.message}`);
    },
    onSettled: () => {
      setIsEditModalOpen(false);
      setTemplateToEdit(null);
      setIsDeleteConfirmOpen(false);
      setTemplateToDelete(null);
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: { title: string; text: string }) => createTemplate(data),
    onSuccess: () => {
      setToast('Template created successfully.');
      mutationCallbacks.onSuccess();
    },
    onError: mutationCallbacks.onError,
    onSettled: mutationCallbacks.onSettled,
  });

  const updateMutation = useMutation({
    mutationFn: (vars: { id: number; data: { title: string; text: string } }) =>
      updateTemplate(vars.id, vars.data),
    onSuccess: () => {
      setToast('Template updated successfully.');
      mutationCallbacks.onSuccess();
    },
    onError: mutationCallbacks.onError,
    onSettled: mutationCallbacks.onSettled,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteTemplate(id),
    onSuccess: () => {
      setToast('Template deleted successfully.');
      mutationCallbacks.onSuccess();
    },
    onError: mutationCallbacks.onError,
    onSettled: mutationCallbacks.onSettled,
  });

  const getInitialFormState = useCallback(
    (entity: Template | null): TemplateFormState => ({
      title: entity?.title || '',
      text: entity?.text || '',
    }),
    []
  );

  const validateForm = useCallback(
    (formState: TemplateFormState): string | null => {
      if (!formState.title.trim()) return 'Title is required.';
      if (
        formState.title.startsWith('system_') &&
        formState.title !== templateToEdit?.title
      ) {
        return 'System prompt titles cannot be changed.';
      }
      if (!formState.text.trim()) return 'Text is required.';
      return null;
    },
    [templateToEdit]
  );

  const handleSave = useCallback(
    async (entityId: number, validatedState: TemplateFormState) => {
      if (templateToEdit) {
        // Always an update from this page
        updateMutation.mutate({
          id: templateToEdit.id,
          data: { title: templateToEdit.title, text: validatedState.text }, // Ensure title is not changed for system prompts
        });
      } else {
        // Create mode
        createMutation.mutate(validatedState);
      }
    },
    [templateToEdit, createMutation, updateMutation]
  );

  const renderFormFields = useCallback(
    (
      formState: TemplateFormState,
      setFormState: React.Dispatch<React.SetStateAction<TemplateFormState>>,
      isSaving: boolean,
      firstInputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
    ): React.ReactNode => {
      const isSystemPrompt = formState.title.startsWith('system_');
      return (
        <Flex direction="column" gap="3">
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Title
            </Text>
            <TextField.Root
              ref={
                !isSystemPrompt
                  ? (firstInputRef as React.RefObject<HTMLInputElement>)
                  : null
              }
              placeholder="Enter a short, descriptive title"
              value={
                isSystemPrompt
                  ? formatTitleForDisplay(formState.title)
                  : formState.title
              }
              onChange={(e) =>
                !isSystemPrompt &&
                setFormState((prev) => ({ ...prev, title: e.target.value }))
              }
              disabled={isSaving || isSystemPrompt}
            />
          </label>
          <label>
            <Text as="div" size="2" mb="1" weight="medium">
              Template Text
            </Text>
            <TextArea
              ref={
                isSystemPrompt
                  ? (firstInputRef as React.RefObject<HTMLTextAreaElement>)
                  : null
              }
              placeholder="Enter the template text..."
              value={formState.text}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, text: e.target.value }))
              }
              disabled={isSaving}
              rows={isSystemPrompt ? 15 : 8}
              style={{
                minHeight: isSystemPrompt ? 250 : 120,
                resize: 'vertical',
              }}
            />
          </label>
        </Flex>
      );
    },
    []
  );

  const handleCreateNew = () => {
    setTemplateToEdit(null); // Ensure we are in "create" mode
    setIsEditModalOpen(true);
  };

  const handleEdit = (template: Template) => {
    setTemplateToEdit(template);
    setIsEditModalOpen(true);
  };

  const handleDelete = (template: Template) => {
    setTemplateToDelete(template);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (templateToDelete) {
      deleteMutation.mutate(templateToDelete.id);
    }
  };

  if (isLoading) {
    return (
      <Flex align="center" justify="center" p="6" style={{ height: '100%' }}>
        <Spinner size="3" /> <Text ml="2">Loading templates...</Text>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex align="center" justify="center" p="6" style={{ height: '100%' }}>
        <Text color="red">Error loading templates: {error.message}</Text>
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
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ flexGrow: 1, minHeight: 0 }}
        >
          <Box pr="4">
            {/* User Templates Section */}
            <Flex justify="between" align="center" mb="4">
              <Heading as="h1" size="7">
                Message Templates
              </Heading>
              <Button onClick={handleCreateNew}>
                <PlusCircledIcon />
                Create New Template
              </Button>
            </Flex>

            {userTemplates.length > 0 ? (
              <Grid columns={{ initial: '1', md: '2' }} gap="4">
                {userTemplates.map((template) => (
                  <Card key={template.id}>
                    <Flex direction="column" gap="2" height="100%">
                      <Flex justify="between" align="start">
                        <Heading as="h3" size="4" trim="start">
                          {formatTitleForDisplay(template.title)}
                        </Heading>
                        <Flex gap="2" flexShrink="0">
                          <IconButton
                            variant="soft"
                            size="1"
                            onClick={() => handleEdit(template)}
                          >
                            <Pencil1Icon />
                          </IconButton>
                          <IconButton
                            variant="soft"
                            color="red"
                            size="1"
                            onClick={() => handleDelete(template)}
                          >
                            <TrashIcon />
                          </IconButton>
                        </Flex>
                      </Flex>
                      <Text
                        as="p"
                        color="gray"
                        size="2"
                        className="line-clamp-4 flex-grow"
                      >
                        {template.text}
                      </Text>
                      <Box mt="auto" pt="2">
                        <Text size="1" color="gray">
                          Created: {formatTimestamp(template.createdAt)}
                        </Text>
                      </Box>
                    </Flex>
                  </Card>
                ))}
              </Grid>
            ) : (
              <Card>
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  p="6"
                  gap="3"
                >
                  <Text color="gray">No user-created templates found.</Text>
                  <Text color="gray" size="2">
                    Click "Create New Template" or star a message in a chat to
                    get started.
                  </Text>
                </Flex>
              </Card>
            )}

            {/* System Prompts Section */}
            <Separator my="6" size="4" />
            <Flex justify="between" align="center" mb="4">
              <Heading as="h2" size="6">
                <Flex align="center" gap="2">
                  <BrainCircuit /> System Prompts
                </Flex>
              </Heading>
            </Flex>
            <Callout.Root color="amber" size="1" mb="4">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                Editing these prompts will change the core behavior of the AI.
                Proceed with caution.
              </Callout.Text>
            </Callout.Root>

            {systemPrompts.length > 0 ? (
              <Grid columns={{ initial: '1', md: '2' }} gap="4">
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
                    </Flex>
                  </Card>
                ))}
              </Grid>
            ) : (
              <Card>
                <Flex
                  direction="column"
                  align="center"
                  justify="center"
                  p="6"
                  gap="3"
                >
                  <Text color="gray">
                    No system prompts found in the database.
                  </Text>
                </Flex>
              </Card>
            )}
          </Box>
        </ScrollArea>
      </Box>

      <EditEntityModal<Template | null, TemplateFormState>
        isOpen={isEditModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditModalOpen(false);
            setTemplateToEdit(null);
          }
        }}
        entity={templateToEdit}
        entityTypeLabel={
          templateToEdit?.title.startsWith('system_')
            ? 'System Prompt'
            : 'Template'
        }
        getInitialFormState={getInitialFormState}
        renderFormFields={renderFormFields}
        validateForm={validateForm}
        onSave={(id, state) => handleSave(id, state)}
        isSaving={createMutation.isPending || updateMutation.isPending}
        saveError={
          createMutation.error?.message || updateMutation.error?.message
        }
      />

      <AlertDialog.Root
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
      >
        <AlertDialog.Content style={{ maxWidth: 450 }}>
          <AlertDialog.Title>Delete Template</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to delete the template "
            <Text weight="bold">{templateToDelete?.title}</Text>"? This action
            cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button
                variant="soft"
                color="gray"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="red"
                onClick={handleConfirmDelete}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? <Spinner /> : <TrashIcon />}
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
