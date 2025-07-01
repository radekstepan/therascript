// packages/ui/src/components/SessionView/Modals/LlmManagementModal.tsx
import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  Button,
  Flex,
  Text,
  Box,
  Spinner,
  Callout,
  ScrollArea,
  Badge,
} from '@radix-ui/themes';
import {
  Cross2Icon,
  CheckCircledIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import { fetchAvailableModels } from '../../../api/vllm';
import type { OllamaModelInfo, AvailableModelsResponse } from '../../../types';
import prettyBytes from 'pretty-bytes';

interface LlmManagementModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LlmManagementModal({
  isOpen,
  onOpenChange,
}: LlmManagementModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const {
    data: availableModelsData,
    isLoading: isLoadingAvailable,
    error: availableError,
  } = useQuery<AvailableModelsResponse, Error>({
    queryKey: ['availableVllmModels'],
    queryFn: fetchAvailableModels,
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const renderModelListItem = (model: OllamaModelInfo) => (
    <Box
      key={model.name}
      p="2"
      style={{ borderBottom: '1px solid var(--gray-a3)' }}
    >
      <Flex justify="between" align="center" gap="3">
        <Flex direction="column" gap="1" style={{ minWidth: 0, flexGrow: 1 }}>
          <Text size="2" weight="medium" truncate title={model.name}>
            {model.name}
          </Text>
        </Flex>
        <Flex align="center" gap="2" flexShrink="0">
          <Badge color="green" variant="soft">
            <CheckCircledIcon /> Serving
          </Badge>
        </Flex>
      </Flex>
    </Box>
  );

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 600 }}>
        <Dialog.Title>Language Model Status</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          The following model is currently being served by the vLLM instance. To
          change the model, you must update the service configuration.
        </Dialog.Description>

        <Box mb="4">
          <Text as="div" size="1" weight="medium" color="gray" mb="2">
            Served Model
          </Text>
          <ScrollArea
            type="auto"
            scrollbars="vertical"
            style={{
              maxHeight: '250px',
              border: '1px solid var(--gray-a6)',
              borderRadius: 'var(--radius-3)',
            }}
          >
            <Box pr="2">
              {isLoadingAvailable && (
                <Flex align="center" justify="center" p="4">
                  <Spinner size="2" />
                  <Text ml="2" color="gray" size="2">
                    Querying vLLM service...
                  </Text>
                </Flex>
              )}
              {availableError && (
                <Callout.Root color="red" size="1" m="2">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    Error loading models: {availableError.message}
                  </Callout.Text>
                </Callout.Root>
              )}
              {!isLoadingAvailable &&
                !availableError &&
                availableModelsData?.models.length === 0 && (
                  <Flex align="center" justify="center" p="4">
                    <Text color="gray" size="2">
                      No model is currently being served or the service is
                      unreachable.
                    </Text>
                  </Flex>
                )}
              {!isLoadingAvailable &&
                !availableError &&
                availableModelsData &&
                availableModelsData.models.length > 0 &&
                availableModelsData.models.map(renderModelListItem)}
            </Box>
          </ScrollArea>
        </Box>

        <Flex gap="3" mt="4" justify="end">
          <Button
            ref={closeButtonRef}
            type="button"
            variant="soft"
            color="gray"
            onClick={() => onOpenChange(false)}
          >
            <Cross2Icon /> Close
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
