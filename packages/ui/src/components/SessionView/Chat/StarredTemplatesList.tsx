/* packages/ui/src/components/SessionView/Chat/StarredTemplatesList.tsx */
import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Box,
  Text,
  Flex,
  ScrollArea,
  Spinner,
  Callout,
} from '@radix-ui/themes';
import { Cross1Icon, InfoCircledIcon } from '@radix-ui/react-icons';
import { cn } from '../../../utils';
import type { Template } from '../../../types';
import { fetchTemplates } from '../../../api/templates';

interface StarredTemplatesListProps {
  onSelectTemplate: (text: string) => void;
  onClose: () => void;
}

export function StarredTemplatesList({
  onSelectTemplate,
  onClose,
}: StarredTemplatesListProps) {
  const {
    data: templates,
    isLoading,
    error,
  } = useQuery<Template[], Error>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
    staleTime: 5 * 60 * 1000,
  });

  const userTemplates = useMemo(() => {
    if (!templates) return [];
    return templates.filter(
      (template) => !template.title.startsWith('system_')
    );
  }, [templates]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const popoverClasses = cn(
    'absolute bottom-full mb-2 left-0 z-50',
    'w-72 max-h-60 overflow-hidden flex flex-col',
    'rounded-md border shadow-lg',
    'bg-[--color-panel-solid] border-[--gray-a6]'
  );

  return (
    <Box
      className={popoverClasses}
      style={{
        backgroundColor: 'var(--color-panel-solid)',
        borderColor: 'var(--gray-a6)',
      }}
    >
      <Flex
        justify="between"
        align="center"
        p="2"
        flexShrink="0"
        className="border-b"
        style={{ borderColor: 'var(--gray-a6)' }}
      >
        <Text size="1" weight="medium" color="gray">
          Templates
        </Text>
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
      <ScrollArea type="auto" scrollbars="vertical" style={{ flexGrow: 1 }}>
        <Box p="1">
          {isLoading ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              <Spinner size="2" />
              <Text ml="2" size="2" color="gray">
                Loading...
              </Text>
            </Flex>
          ) : error ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              <Callout.Root color="red" size="1" style={{ width: '100%' }}>
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>Error: {error.message}</Callout.Text>
              </Callout.Root>
            </Flex>
          ) : !userTemplates || userTemplates.length === 0 ? (
            <Flex
              align="center"
              justify="center"
              p="4"
              style={{ minHeight: 80 }}
            >
              <Text size="2" color="gray" align="center">
                No templates found. <br /> Click the ☆ next to a user message to
                save it as a template.
              </Text>
            </Flex>
          ) : (
            [...userTemplates]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((template) => {
                return (
                  <Button
                    key={template.id}
                    variant="ghost"
                    onClick={() => onSelectTemplate(template.text)}
                    className="block w-full h-auto text-left p-2 text-sm rounded whitespace-normal justify-start"
                    style={{
                      whiteSpace: 'normal',
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                    }}
                    title={`Insert: "${template.text.substring(0, 100)}${template.text.length > 100 ? '...' : ''}"`}
                    size="2"
                  >
                    {template.title}
                  </Button>
                );
              })
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}
