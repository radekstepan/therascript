// packages/ui/src/components/User/GpuStatusModal.tsx
import React from 'react';
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
  Table,
  Heading,
  Progress,
  Card,
} from '@radix-ui/themes';
import {
  Cross2Icon,
  InfoCircledIcon,
  ExclamationTriangleIcon,
} from '@radix-ui/react-icons';
import type { GpuStats, GpuDeviceStats } from '../../types';
import prettyBytes from 'pretty-bytes';

interface GpuStatusModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  gpuStats: GpuStats | undefined;
  isLoading: boolean;
  error: Error | null;
}

const getUtilColor = (
  value: number | null
): React.ComponentProps<typeof Progress>['color'] => {
  if (value === null) return 'gray';
  if (value > 90) return 'red';
  if (value > 70) return 'amber';
  return 'green';
};

const getVramColor = (
  value: number | null
): React.ComponentProps<typeof Progress>['color'] => {
  if (value === null) return 'gray';
  if (value > 90) return 'red';
  if (value > 75) return 'amber';
  return 'sky';
};

const StatRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <Flex justify="between" align="center">
    <Text size="2" color="gray">
      {label}
    </Text>
    <Text size="2" weight="medium">
      {value}
    </Text>
  </Flex>
);

const ProgressBar: React.FC<{
  value: number | null;
  label: string;
  color?: React.ComponentProps<typeof Progress>['color'];
  colorFn?: (
    value: number | null
  ) => React.ComponentProps<typeof Progress>['color'];
}> = ({ value, label, color, colorFn }) => (
  <Box>
    <Flex justify="between">
      <Text size="1" color="gray">
        {label}
      </Text>
      <Text size="1" color="gray">
        {value !== null ? `${Math.round(value)}%` : 'N/A'}
      </Text>
    </Flex>
    <Progress
      value={value ?? 0}
      color={colorFn ? colorFn(value) : color}
      size="1"
      mt="1"
    />
  </Box>
);

const GpuDeviceCard: React.FC<{ device: GpuDeviceStats }> = ({ device }) => {
  const memUsagePercent =
    device.memory.totalMb > 0
      ? (device.memory.usedMb / device.memory.totalMb) * 100
      : 0;

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Heading as="h3" size="4">
          GPU {device.id}: {device.name}
        </Heading>
        <Flex direction="column" gap="2">
          <ProgressBar
            value={device.utilization.gpuPercent}
            label="GPU Utilization"
            colorFn={getUtilColor}
          />
          <ProgressBar
            value={memUsagePercent}
            label="VRAM Usage"
            colorFn={getVramColor}
          />
        </Flex>
        <Flex direction="column" gap="1">
          <StatRow
            label="VRAM"
            value={`${prettyBytes(device.memory.usedMb * 1024 * 1024)} / ${prettyBytes(device.memory.totalMb * 1024 * 1024)}`}
          />
          <StatRow
            label="Temperature"
            value={
              device.temperature.currentCelsius !== null
                ? `${device.temperature.currentCelsius}°C`
                : 'N/A'
            }
          />
          <StatRow
            label="Power"
            value={
              device.power.drawWatts !== null &&
              device.power.limitWatts !== null
                ? `${device.power.drawWatts}W / ${device.power.limitWatts}W`
                : 'N/A'
            }
          />
          <StatRow
            label="Fan Speed"
            value={`${device.fanSpeedPercent ?? 'N/A'}%`}
          />
        </Flex>

        {device.processes.length > 0 && (
          <Box>
            <Text as="div" size="2" color="gray" mb="2">
              Processes
            </Text>
            <Table.Root size="1" variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>PID</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Process Name</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell align="right">
                    Memory
                  </Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {device.processes.map((proc) => (
                  <Table.Row key={proc.pid}>
                    <Table.Cell>{proc.pid}</Table.Cell>
                    <Table.Cell>
                      <Text truncate>{proc.name}</Text>
                    </Table.Cell>
                    <Table.Cell align="right">
                      {prettyBytes(proc.memoryUsedMb * 1024 * 1024)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </Flex>
    </Card>
  );
};

export function GpuStatusModal({
  isOpen,
  onOpenChange,
  gpuStats,
  isLoading,
  error,
}: GpuStatusModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 650 }}>
        <Dialog.Title>GPU Status</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          Real-time statistics for NVIDIA GPU devices from `nvidia-smi`.
        </Dialog.Description>
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: '60vh', minHeight: '200px' }}
        >
          <Box pr="4">
            {isLoading && !gpuStats ? (
              <Flex align="center" justify="center" py="6">
                <Spinner size="3" />
                <Text ml="2" color="gray">
                  Loading GPU status...
                </Text>
              </Flex>
            ) : error ? (
              <Callout.Root color="red" role="alert">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>
                  Error fetching GPU status: {error.message}
                </Callout.Text>
              </Callout.Root>
            ) : !gpuStats?.available ? (
              <Callout.Root color="amber">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text>
                  `nvidia-smi` command not found on the server. GPU monitoring
                  is unavailable.
                </Callout.Text>
              </Callout.Root>
            ) : (
              <Flex direction="column" gap="4">
                <Flex justify="between" gap="4">
                  <Badge color="gray" variant="soft">
                    Driver: {gpuStats.driverVersion}
                  </Badge>
                  <Badge color="gray" variant="soft">
                    CUDA: {gpuStats.cudaVersion}
                  </Badge>
                </Flex>
                {gpuStats.gpus.map((device) => (
                  <GpuDeviceCard key={device.id} device={device} />
                ))}
              </Flex>
            )}
          </Box>
        </ScrollArea>
        <Flex gap="3" mt="4" justify="end">
          <Button
            type="button"
            variant="surface"
            onClick={() => onOpenChange(false)}
          >
            <Cross2Icon /> Close
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
