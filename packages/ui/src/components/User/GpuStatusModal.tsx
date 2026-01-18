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
  Separator,
} from '@radix-ui/themes';
import {
  Cross2Icon,
  InfoCircledIcon,
  ExclamationTriangleIcon,
  LightningBoltIcon,
  DesktopIcon,
} from '@radix-ui/react-icons';
import type { GpuStats, GpuDeviceStats, OllamaStatus } from '../../types';
import prettyBytes from 'pretty-bytes';

interface GpuStatusModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  gpuStats: GpuStats | undefined;
  ollamaStatus: OllamaStatus | undefined;
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

const getRamColor = (
  value: number | null
): React.ComponentProps<typeof Progress>['color'] => {
  if (value === null) return 'gray';
  if (value > 90) return 'red';
  if (value > 75) return 'amber';
  return 'purple';
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

const ActiveModelCard: React.FC<{ status: OllamaStatus }> = ({ status }) => {
  if (!status.activeModel || !status.loaded || !status.details) return null;

  const details = status.details;
  const sizeVram = details.size_vram || 0;
  const totalSize = details.size; // Model file size on disk (approx weight size)
  // Approximate system RAM usage for weights: Total model size minus what's in VRAM.
  // Note: This is an approximation. If size_vram > totalSize (due to context overhead), we clamp to 0.
  const sizeSystem = Math.max(0, totalSize - sizeVram);

  const percentVram =
    totalSize > 0 ? Math.min(100, Math.round((sizeVram / totalSize) * 100)) : 0;
  const isFullyOffloaded = sizeVram >= totalSize;

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Heading as="h3" size="4">
          Active Model Resources
        </Heading>
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            Model:
          </Text>
          <Text size="2">{status.activeModel}</Text>
        </Flex>

        <Box>
          <Flex justify="between" mb="1">
            <Text size="1" color="gray">
              Offloaded to GPU
            </Text>
            <Text size="1" color="gray">
              {percentVram}%
            </Text>
          </Flex>
          <Progress value={percentVram} size="2" color="blue" />
        </Box>

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Badge color="blue" variant="soft">
              <LightningBoltIcon />
              VRAM Usage: {prettyBytes(sizeVram)}
            </Badge>
            {isFullyOffloaded && (
              <Badge color="green" variant="outline">
                100% Offloaded
              </Badge>
            )}
          </Flex>
          {sizeSystem > 0 && (
            <Flex align="center" gap="2">
              <Badge color="orange" variant="soft">
                <DesktopIcon />
                System RAM: {prettyBytes(sizeSystem)}
              </Badge>
              <Text size="1" color="gray">
                (Estimated weights on CPU)
              </Text>
            </Flex>
          )}
        </Flex>
      </Flex>
    </Card>
  );
};

const SystemMemoryCard: React.FC<{
  memory: import('../../types').SystemMemory;
}> = ({ memory }) => (
  <Card size="2">
    <Flex direction="column" gap="3">
      <Heading as="h3" size="4">
        System Memory
      </Heading>
      <Flex direction="column" gap="2">
        <ProgressBar
          value={memory.percentUsed}
          label="RAM Usage"
          colorFn={getRamColor}
        />
      </Flex>
      <Flex direction="column" gap="1">
        <StatRow
          label="Total RAM"
          value={prettyBytes(memory.totalMb * 1024 * 1024)}
        />
        <StatRow
          label="Used"
          value={prettyBytes(memory.usedMb * 1024 * 1024)}
        />
        <StatRow
          label="Free"
          value={prettyBytes(memory.freeMb * 1024 * 1024)}
        />
      </Flex>
    </Flex>
  </Card>
);

export function GpuStatusModal({
  isOpen,
  onOpenChange,
  gpuStats,
  ollamaStatus,
  isLoading,
  error,
}: GpuStatusModalProps) {
  const runtimeKey = gpuStats?.executionProvider ?? null;
  const runtimeLabel = runtimeKey
    ? runtimeKey === 'gpu'
      ? 'GPU'
      : runtimeKey === 'metal'
        ? 'Metal'
        : 'CPU'
    : 'Unknown';
  const runtimeBadgeColor: React.ComponentProps<typeof Badge>['color'] =
    runtimeKey === 'gpu' ? 'green' : runtimeKey === 'metal' ? 'cyan' : 'gray';
  const runtimeDescription = runtimeKey
    ? runtimeKey === 'gpu'
      ? 'NVIDIA GPU acceleration detected via nvidia-smi.'
      : runtimeKey === 'metal'
        ? 'Running with native Apple Metal acceleration. NVIDIA metrics may be limited.'
        : 'Running on CPU only. NVIDIA GPU metrics are unavailable.'
    : 'Runtime information is not available yet.';

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 650 }}>
        <Dialog.Title>System Resources</Dialog.Title>
        <Dialog.Description size="2" mb="4" color="gray">
          {runtimeDescription}
        </Dialog.Description>
        <Flex mb="3">
          <Badge color={runtimeBadgeColor} variant="soft">
            Runtime: {runtimeLabel}
          </Badge>
        </Flex>
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
            ) : (
              <Flex direction="column" gap="4">
                {ollamaStatus &&
                  ollamaStatus.loaded &&
                  ollamaStatus.details && (
                    <>
                      <ActiveModelCard status={ollamaStatus} />
                      <Separator size="4" />
                    </>
                  )}

                {gpuStats?.systemMemory && (
                  <>
                    <SystemMemoryCard memory={gpuStats.systemMemory} />
                    <Separator size="4" />
                  </>
                )}

                {!gpuStats?.available ? (
                  <Callout.Root color="amber">
                    <Callout.Icon>
                      <InfoCircledIcon />
                    </Callout.Icon>
                    <Callout.Text>
                      {runtimeKey === 'metal'
                        ? 'Running with Apple Metal acceleration. NVIDIA GPU monitoring via nvidia-smi is not available on macOS.'
                        : '`nvidia-smi` command not found on the server. GPU monitoring is unavailable and the system is running on CPU.'}
                    </Callout.Text>
                  </Callout.Root>
                ) : (
                  <>
                    <Flex
                      justify="between"
                      gap="4"
                      style={{ flexWrap: 'wrap' }}
                    >
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
                  </>
                )}
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
