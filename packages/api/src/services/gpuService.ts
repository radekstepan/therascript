// packages/api/src/services/gpuService.ts
import { getGpuStats } from '@therascript/gpu-utils';
import type { GpuStats } from '@therascript/gpu-utils';

let cachedStats: GpuStats | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 1500; // Cache for 1.5 seconds

export async function getGpuStatsService(): Promise<GpuStats> {
  const now = Date.now();
  if (cachedStats && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedStats;
  }

  try {
    cachedStats = await getGpuStats();
    lastFetchTime = now;
    return cachedStats;
  } catch (error) {
    // If fetching fails, return an 'unavailable' state but don't cache it
    console.error('[GpuService] Failed to get GPU stats:', error);
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
      },
    };
  }
}
