/* packages/ui/src/components/SessionView/Chat/ChatMessages.tsx */
import React, {
  useState,
  useRef,
  useCallback,
  RefObject,
  useMemo,
} from 'react';
import { useSetAtom, useAtomValue } from 'jotai';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Virtuoso } from 'react-virtuoso';
import {
  Box,
  Flex,
  Text,
  TextArea,
  TextField,
  Button,
  Spinner,
} from '@radix-ui/themes';
import { createTemplate } from '../../../api/templates';
import { toastMessageAtom, renderMarkdownAtom } from '../../../store';
import type { ChatMessage, Template } from '../../../types';
import { ChatMessageBubble } from './ChatMessageBubble';
import { EditEntityModal, type BaseEntity } from '../../Shared/EditEntityModal';

interface ChatMessagesProps {
  messages: ChatMessage[];
  activeChatId: number | null;
  isStandalone: boolean;
  streamingMessageId: number | null;
  activeSessionId: number | null;
  isAiResponding: boolean;
  streamingTokensPerSecond?: number | null;
}

interface TemplateFormState {
  title: string;
  text: string;
}

// Helper function to strip HTML tags for plain text fallback
function stripHtmlTags(html: string): string {
  const SCRIPT_REGEX = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;
  let scriptless = html.replace(SCRIPT_REGEX, '');
  const STYLE_REGEX = /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi;
  scriptless = scriptless.replace(STYLE_REGEX, '');
  const div = document.createElement('div');
  div.innerHTML = scriptless;
  return div.textContent || div.innerText || '';
}

export function ChatMessages({
  messages,
  isAiResponding,
  streamingMessageId,
  streamingTokensPerSecond,
}: ChatMessagesProps) {
  const queryClient = useQueryClient();
  const setToast = useSetAtom(toastMessageAtom);
  const renderMd = useAtomValue(renderMarkdownAtom);

  const virtuosoRef = useRef<any>(null);

  // Auto-scroll when new messages arrive or during streaming
  const followOutput = useMemo(() => {
    return isAiResponding ? 'smooth' : false;
  }, [isAiResponding]);

  // Scroll to bottom when messages change
  const handleScrolledToBottom = useCallback(() => {
    // Virtuoso's followOutput handles this automatically
  }, []);

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateToCreate, setTemplateToCreate] =
    useState<TemplateFormState | null>(null);

  const createTemplateMutation = useMutation({
    mutationFn: (data: { title: string; text: string }) => createTemplate(data),
    onSuccess: () => {
      setToast('Template saved successfully.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setIsTemplateModalOpen(false);
      setTemplateToCreate(null);
    },
    onError: (error: Error) => {
      setToast(`Error saving template: ${error.message}`);
    },
  });

  const handleStarClick = (message: ChatMessage) => {
    if (message.sender !== 'user') return;
    setTemplateToCreate({
      title: `From chat on ${new Date().toLocaleDateString()}`,
      text: message.text,
    });
    setIsTemplateModalOpen(true);
  };

  const getInitialFormState = useCallback(
    (entity: BaseEntity | null): TemplateFormState => {
      // The entity will be null when creating, so we use the state `templateToCreate`
      return templateToCreate || { title: '', text: '' };
    },
    [templateToCreate]
  );

  const validateForm = useCallback(
    (formState: TemplateFormState): string | null => {
      if (!formState.title.trim()) return 'Title is required.';
      if (!formState.text.trim()) return 'Text is required.';
      return null;
    },
    []
  );

  const handleSaveTemplate = async (
    entityId: number,
    validatedState: TemplateFormState
  ) => {
    createTemplateMutation.mutate(validatedState);
  };

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
            rows={6}
          />
        </label>
      </Flex>
    ),
    []
  );

  const handleCopyClick = async (copyPayload: {
    text: string;
    html?: string;
  }) => {
    const { text, html } = copyPayload;
    if (html && navigator.clipboard && navigator.clipboard.write) {
      try {
        const plainTextBlob = new Blob([stripHtmlTags(html)], {
          type: 'text/plain',
        });
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': plainTextBlob,
        });
        await navigator.clipboard.write([clipboardItem]);
        setToast('Formatted message copied to clipboard!');
        return;
      } catch (err) {
        console.warn(
          'Failed to copy HTML to clipboard, falling back to plain text:',
          err
        );
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast('Message text copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy text to clipboard:', err);
      setToast('Error copying text.');
    }
  };

  return (
    <>
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={messages}
        computeItemKey={(index, m) => m.id}
        followOutput={followOutput}
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
        increaseViewportBy={{ top: 0, bottom: 200 }}
        onScroll={handleScrolledToBottom}
        itemContent={(index, message) => {
          const isCurrentlyStreaming = message.id === streamingMessageId;
          const tokensPerSecond = isCurrentlyStreaming
            ? streamingTokensPerSecond
            : message.completionTokens &&
                message.duration &&
                message.duration > 10
              ? (message.completionTokens * 1000) / message.duration
              : null;
          return (
            <Box py="2" px="4">
              <ChatMessageBubble
                key={message.id}
                message={message}
                isCurrentlyStreaming={isCurrentlyStreaming}
                isAiResponding={isAiResponding}
                renderMd={renderMd}
                onStarClick={handleStarClick}
                onCopyClick={handleCopyClick}
                tokensPerSecond={tokensPerSecond}
              />
            </Box>
          );
        }}
      />

      <EditEntityModal
        isOpen={isTemplateModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsTemplateModalOpen(false);
            setTemplateToCreate(null);
          }
        }}
        entity={null}
        entityTypeLabel="Template"
        getInitialFormState={getInitialFormState}
        renderFormFields={renderFormFields}
        validateForm={validateForm}
        onSave={handleSaveTemplate}
        isSaving={createTemplateMutation.isPending}
        saveError={createTemplateMutation.error?.message}
      />
    </>
  );
}
