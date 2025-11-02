// packages/ui/src/components/User/GpuStatusIndicator.tsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Flex, Text, Tooltip, Progress, Box } from '@radix-ui/themes';
import { Cpu } from 'lucide-react';
import { fetchGpuStats } from '../../api/api';
import type { GpuStats } from '../../types';
import { GpuStatusModal } from './GpuStatusModal';
import { cn } from '../../utils';
import prettyBytes from 'pretty-bytes';

export function GpuStatusIndicator({
  isSidebarOpen,
}: {
  isSidebarOpen: boolean;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    data: gpuStats,
    isLoading,
    error,
  } = useQuery<GpuStats, Error>({
    queryKey: ['gpuStats'],
    queryFn: fetchGpuStats,
    refetchInterval: 2000, // Poll every 2 seconds
    refetchOnWindowFocus: true,
    staleTime: 1000,
  });

  const handleOpenModal = () => {
    if (gpuStats) {
      setIsModalOpen(true);
    }
  };

  const runtimeKey = gpuStats?.executionProvider ?? null;
  const runtimeDisplay = runtimeKey
    ? runtimeKey === 'gpu'
      ? 'GPU'
      : runtimeKey === 'metal'
        ? 'Metal'
        : 'CPU'
    : '—';
  const runtimeTooltip = runtimeKey
    ? runtimeKey === 'gpu'
      ? 'Running with NVIDIA GPU acceleration.'
      : runtimeKey === 'metal'
        ? 'Running with native Apple Metal acceleration.'
        : 'Running on CPU only.'
    : 'Runtime information unavailable.';

  const hasMetrics = Boolean(
    gpuStats && gpuStats.available && gpuStats.summary.gpuCount > 0
  );

  const summary = hasMetrics ? gpuStats!.summary : undefined;
  const vramUsagePercent = summary
    ? summary.totalMemoryMb > 0
      ? (summary.totalMemoryUsedMb / summary.totalMemoryMb) * 100
      : 0
    : 0;

  const getUtilColor = (
    value: number | null
  ): React.ComponentProps<typeof Progress>['color'] => {
    if (value === null) return 'gray';
    if (value > 90) return 'red';
    if (value > 70) return 'amber';
    return 'green';
  };

  const getVramColor = (
    value: number
  ): React.ComponentProps<typeof Progress>['color'] => {
    if (value > 90) return 'red';
    if (value > 75) return 'amber';
    return 'sky';
  };

  return (
    <>
      <button
        title={`Runtime: ${runtimeDisplay}`}
        onClick={handleOpenModal}
        className={cn(
          'flex items-center mt-2 w-full py-2 text-left text-sm hover:bg-[var(--accent-a3)] rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-8)]',
          isSidebarOpen ? 'px-3' : 'justify-center px-0'
        )}
        disabled={!gpuStats && isLoading}
      >
        <Cpu size={18} className={cn(isSidebarOpen ? 'mr-2' : 'mr-0')} />
        {isSidebarOpen && (
          <Flex direction="column" gap="1" style={{ flexGrow: 1 }}>
            <Flex justify="between" align="center">
              <Tooltip content={runtimeTooltip}>
                <Text size="1" weight="medium">
                  Runtime: {runtimeDisplay}
                </Text>
              </Tooltip>
              {hasMetrics && summary ? (
                <Text size="1">{summary.avgTemperatureCelsius ?? '--'}°C</Text>
              ) : null}
            </Flex>
            {hasMetrics && summary ? (
              <>
                <Tooltip
                  content={`GPU Utilization: ${summary.avgGpuUtilizationPercent ?? 'N/A'}%`}
                >
                  <Progress
                    size="1"
                    value={summary.avgGpuUtilizationPercent ?? 0}
                    color={getUtilColor(summary.avgGpuUtilizationPercent)}
                  />
                </Tooltip>
                <Tooltip
                  content={`VRAM: ${prettyBytes(summary.totalMemoryUsedMb * 1024 * 1024)} / ${prettyBytes(summary.totalMemoryMb * 1024 * 1024)}`}
                >
                  <Progress
                    size="1"
                    value={vramUsagePercent}
                    color={getVramColor(vramUsagePercent)}
                  />
                </Tooltip>
              </>
            ) : (
              <Text size="1" color="gray">
                {runtimeKey === 'metal'
                  ? 'Apple Metal runtime (no NVIDIA metrics).'
                  : runtimeKey === 'gpu'
                    ? 'GPU metrics unavailable.'
                    : runtimeKey === 'cpu'
                      ? 'CPU-only runtime.'
                      : 'Runtime data unavailable.'}
              </Text>
            )}
            {error && (
              <Text size="1" color="red">
                {error.message}
              </Text>
            )}
          </Flex>
        )}
      </button>

      <GpuStatusModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        gpuStats={gpuStats}
        isLoading={isLoading}
        error={error}
      />
    </>
  );
}
