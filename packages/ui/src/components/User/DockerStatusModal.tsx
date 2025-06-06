// packages/ui/src/components/User/DockerStatusModal.tsx
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
  Badge,
  ScrollArea,
} from '@radix-ui/themes';
import {
  Cross2Icon,
  CheckCircledIcon,
  CrossCircledIcon,
  QuestionMarkCircledIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { fetchDockerStatus } from '../../api/api';
import type { DockerContainerStatus } from '../../types';
import { cn } from '../../utils'; // If needed

interface DockerStatusModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const getStatusVisuals = (
  state: string
): {
  color: React.ComponentProps<typeof Badge>['color'];
  Icon: React.ElementType;
} => {
  const lowerState = state.toLowerCase();
  if (lowerState === 'running')
    return { color: 'green', Icon: CheckCircledIcon };
  if (lowerState === 'exited' || lowerState === 'stopped')
    return { color: 'red', Icon: CrossCircledIcon };
  if (lowerState === 'not_found')
    return { color: 'gray', Icon: QuestionMarkCircledIcon };
  return { color: 'yellow', Icon: InfoCircledIcon };
};

const formatPorts = (ports: DockerContainerStatus['ports']): string => {
  if (!ports || ports.length === 0) return 'None';
  return ports
    .map(
      (p) =>
        `${p.PublicPort ? `${p.IP || '0.0.0.0'}:${p.PublicPort}->` : ''}${p.PrivatePort}/${p.Type}`
    )
    .join(', ');
};

export function DockerStatusModal({
  isOpen,
  onOpenChange,
}: DockerStatusModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const {
    data: containers,
    isLoading,
    error,
    refetch,
  } = useQuery<DockerContainerStatus[], Error>({
    queryKey: ['dockerStatus'],
    queryFn: fetchDockerStatus,
    enabled: isOpen,
    staleTime: 10 * 1000,
    refetchInterval: isOpen ? 10000 : false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 650 }}>
        <Dialog.Title>Docker Container Status</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Status of relevant Docker containers (Whisper, Ollama) for this
          project.
        </Dialog.Description>
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: '50vh', minHeight: '200px' }}
        >
          <Box pr="4">
            {isLoading && (
              <Flex align="center" justify="center" py="6">
                <Spinner size="3" />
                <Text ml="2" color="gray">
                  Loading Docker status...
                </Text>
              </Flex>
            )}
            {error && !isLoading && (
              <Callout.Root color="red" role="alert" size="1" mt="2">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error fetching Docker status: {error.message}
                </Callout.Text>
              </Callout.Root>
            )}
            {!isLoading && !error && containers && containers.length > 0 && (
              <Box className="space-y-3">
                {containers.map((container) => {
                  const { color, Icon } = getStatusVisuals(container.state);
                  return (
                    <Box
                      key={container.id + container.name}
                      p="3"
                      style={{
                        backgroundColor: 'var(--gray-a2)',
                        borderRadius: 'var(--radius-3)',
                      }}
                    >
                      <Flex justify="between" align="start" gap="3">
                        <Flex
                          direction="column"
                          gap="1"
                          style={{ minWidth: 0 }}
                        >
                          <Flex align="center" gap="2">
                            <Text
                              size="2"
                              weight="medium"
                              truncate
                              title={container.name}
                            >
                              {container.name}
                            </Text>
                            <Badge color={color} variant="soft" size="1">
                              <Icon
                                width="12"
                                height="12"
                                style={{ marginRight: '3px' }}
                              />
                              {container.state}
                            </Badge>
                          </Flex>
                          <Text
                            size="1"
                            color="gray"
                            truncate
                            title={container.image}
                          >
                            {container.image}
                          </Text>
                        </Flex>
                        <Flex
                          direction="column"
                          gap="1"
                          align="end"
                          flexShrink="0"
                          style={{ textAlign: 'right' }}
                        >
                          <Text size="1" color="gray" title={container.status}>
                            {container.status}
                          </Text>
                          <Text
                            size="1"
                            color="gray"
                            truncate
                            title={`Ports: ${formatPorts(container.ports)}`}
                          >
                            Ports: {formatPorts(container.ports)}
                          </Text>
                        </Flex>
                      </Flex>
                    </Box>
                  );
                })}
              </Box>
            )}
            {!isLoading &&
              !error &&
              (!containers || containers.length === 0) && (
                <Flex align="center" justify="center" py="6">
                  <Text color="gray">No project containers found.</Text>
                </Flex>
              )}
          </Box>
        </ScrollArea>
        <Flex gap="3" mt="4" justify="end">
          <Button
            type="button"
            variant="soft"
            color="gray"
            onClick={() => refetch()}
            disabled={isLoading}
            title="Refetch container status"
          >
            Refresh
          </Button>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="surface"
            onClick={handleClose}
          >
            <Cross2Icon /> Close
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
