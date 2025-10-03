// packages/api/src/api/gpuHandler.ts
import { getGpuStatsService } from '../services/gpuService.js';
import { InternalServerError } from '../errors.js';
import type { GpuStats } from '@therascript/gpu-utils';

export const getGpuStatsHandler = async ({ set }: any): Promise<GpuStats> => {
  try {
    const stats = await getGpuStatsService();
    set.status = 200;
    return stats;
  } catch (error) {
    console.error('[GpuHandler] Error getting GPU stats:', error);
    throw new InternalServerError(
      'Failed to retrieve GPU statistics.',
      error instanceof Error ? error : undefined
    );
  }
};
