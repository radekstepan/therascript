// packages/api/src/services/gpuService.ts
import os from 'os';
import { getGpuStats, getSystemMemoryStats } from '@therascript/gpu-utils';
import type { GpuStats } from '@therascript/gpu-utils';
import config from '@therascript/config';

type RuntimeAwareGpuStats = GpuStats & {
  executionProvider: 'gpu' | 'cpu' | 'metal';
};

let cachedStats: RuntimeAwareGpuStats | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 1500; // Cache for 1.5 seconds

export async function getGpuStatsService(): Promise<RuntimeAwareGpuStats> {
  const now = Date.now();
  if (cachedStats && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedStats;
  }

  try {
    const stats = await getGpuStats();
    const executionProvider = determineExecutionProvider(stats);
    const enrichedStats: RuntimeAwareGpuStats = {
      ...stats,
      executionProvider,
    };
    cachedStats = enrichedStats;
    lastFetchTime = now;
    return enrichedStats;
  } catch (error) {
    // If fetching fails, return an 'unavailable' state but don't cache it
    console.error('[GpuService] Failed to get GPU stats:', error);
    const systemMemory = await getSystemMemoryStats();
    return {
      available: false,
      driverVersion: null,
      cudaVersion: null,
      gpus: [],
      summary: {
        gpuCount: 0,
        totalMemoryMb: 0,
        totalMemoryUsedMb: 0,
        avgGpuUtilizationPercent: null,
        avgMemoryUtilizationPercent: null,
        avgTemperatureCelsius: null,
        totalPowerDrawWatts: null,
        totalPowerLimitWatts: null,
        isUnifiedMemory: false,
      },
      executionProvider: determineExecutionProvider(null),
      systemMemory,
    };
  }
}

function determineExecutionProvider(
  stats: GpuStats | null
): 'gpu' | 'cpu' | 'metal' {
  if (stats && stats.available && stats.summary.gpuCount > 0) {
    // Check if this is Apple Silicon with unified memory
    if (
      stats.summary.isUnifiedMemory ||
      (process.platform === 'darwin' &&
        stats.gpus.some((g) => g.name?.toLowerCase().includes('apple')))
    ) {
      return 'metal';
    }
    return 'gpu';
  }
  if (config.ollama.runtime === 'native' && process.platform === 'darwin') {
    return 'metal';
  }
  return 'cpu';
}

export type { RuntimeAwareGpuStats };
