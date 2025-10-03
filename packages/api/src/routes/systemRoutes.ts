import { Elysia, t } from 'elysia';
import { getGpuStatsHandler } from '../api/gpuHandler.js';
import type { GpuStats } from '@therascript/gpu-utils';

// --- GPU Stats Schemas ---
const GpuProcessSchema = t.Object({
  pid: t.Number(),
  name: t.String(),
  memoryUsedMb: t.Number(),
});

const GpuDeviceStatsSchema = t.Object({
  id: t.Number(),
  name: t.String(),
  fanSpeedPercent: t.Nullable(t.Number()),
  performanceState: t.String(),
  memory: t.Object({
    totalMb: t.Number(),
    usedMb: t.Number(),
    freeMb: t.Number(),
  }),
  utilization: t.Object({
    gpuPercent: t.Nullable(t.Number()),
    memoryPercent: t.Nullable(t.Number()),
  }),
  temperature: t.Object({
    currentCelsius: t.Nullable(t.Number()),
  }),
  power: t.Object({
    drawWatts: t.Nullable(t.Number()),
    limitWatts: t.Nullable(t.Number()),
  }),
  processes: t.Array(GpuProcessSchema),
});

const GpuStatsSummarySchema = t.Object({
  gpuCount: t.Number(),
  totalMemoryMb: t.Number(),
  totalMemoryUsedMb: t.Number(),
  avgGpuUtilizationPercent: t.Nullable(t.Number()),
  avgMemoryUtilizationPercent: t.Nullable(t.Number()),
  avgTemperatureCelsius: t.Nullable(t.Number()),
  totalPowerDrawWatts: t.Nullable(t.Number()),
  totalPowerLimitWatts: t.Nullable(t.Number()),
});

const GpuStatsResponseSchema = t.Object({
  available: t.Boolean(),
  driverVersion: t.Nullable(t.String()),
  cudaVersion: t.Nullable(t.String()),
  gpus: t.Array(GpuDeviceStatsSchema),
  summary: GpuStatsSummarySchema,
});
// --- End GPU Stats Schemas ---

export const systemRoutes = new Elysia({ prefix: '/api/system' })
  .model({
    gpuStatsResponse: GpuStatsResponseSchema,
  })
  .group('', { detail: { tags: ['System'] } }, (app) =>
    app.get('/gpu-stats', getGpuStatsHandler, {
      response: {
        200: 'gpuStatsResponse',
        500: t.Any(), // Use a generic error schema if you have one
      },
      detail: {
        summary: 'Get NVIDIA GPU Statistics',
        description:
          "Retrieves detailed statistics for available NVIDIA GPUs using 'nvidia-smi'. Returns 'available: false' if nvidia-smi is not found in the system's PATH.",
      },
    })
  );
