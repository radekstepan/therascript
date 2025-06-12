// packages/ui/src/components/TemplatesPage.tsx
import React, { useState, useCallback, RefObject } from 'react';
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
} from '@radix-ui/themes';
import { PlusCircledIcon, Pencil1Icon, TrashIcon } from '@radix-ui/react-icons';
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
      if (!formState.text.trim()) return 'Text is required.';
      return null;
    },
    []
  );

  const handleSave = useCallback(
    async (entityId: number, validatedState: TemplateFormState) => {
      if (templateToEdit) {
        updateMutation.mutate({
          id: templateToEdit.id,
          data: validatedState,
        });
      } else {
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
    ): React.ReactNode => (
      <Flex direction="column" gap="3">
        <label>
          <Text as="div" size="2" mb="1" weight="medium">
            Title
          </Text>
          <TextField.Root
            ref={firstInputRef as React.RefObject<HTMLInputElement>}
            placeholder="Enter a short, descriptive title"
            value={formState.title}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, title: e.target.value }))
            }
            disabled={isSaving}
          />
        </label>
        <label>
          <Text as="div" size="2" mb="1" weight="medium">
            Template Text
          </Text>
          <TextArea
            placeholder="Enter the template text..."
            value={formState.text}
            onChange={(e) =>
              setFormState((prev) => ({ ...prev, text: e.target.value }))
            }
            disabled={isSaving}
            rows={8}
            style={{ minHeight: 120, resize: 'vertical' }}
          />
        </label>
      </Flex>
    ),
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
        <Flex justify="between" align="center" mb="6">
          <Heading as="h1" size="7">
            Message Templates
          </Heading>
          <Button onClick={handleCreateNew}>
            <PlusCircledIcon />
            Create New Template
          </Button>
        </Flex>

        {templates && templates.length > 0 ? (
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{ flexGrow: 1, minHeight: 0 }}
          >
            <Grid columns={{ initial: '1', md: '2' }} gap="4" pr="4">
              {templates.map((template) => (
                <Card key={template.id}>
                  <Flex direction="column" gap="2" height="100%">
                    <Flex justify="between" align="start">
                      <Heading as="h3" size="4" trim="start">
                        {template.title}
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
              <Text color="gray">No templates found.</Text>
              <Text color="gray" size="2">
                Click "Create New Template" or star a message in a chat to get
                started.
              </Text>
            </Flex>
          </Card>
        )}
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
        entityTypeLabel="Template"
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
