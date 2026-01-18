// packages/gpu-utils/src/index.ts
import { promisify } from 'util';
import { exec } from 'child_process';
import { XMLParser } from 'fast-xml-parser';
import which from 'which';
import os from 'os';
import type {
  GpuStats,
  GpuDeviceStats,
  GpuProcess,
  RawNvidiaSmiLog,
  RawGpuInfo,
  RawGpuProcess,
} from './types.js';

export * from './types.js';

const execAsync = promisify(exec);
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: true,
  parseTagValue: true,
});

let _nvidiaSmiPath: string | null = null;
let _nvidiaSmiChecked = false;

function getSystemMemoryStats() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;

  return {
    totalMb: Math.round(totalBytes / (1024 * 1024)),
    usedMb: Math.round(usedBytes / (1024 * 1024)),
    freeMb: Math.round(freeBytes / (1024 * 1024)),
    percentUsed: (usedBytes / totalBytes) * 100,
  };
}

async function getNvidiaSmiPath(): Promise<string | null> {
  if (_nvidiaSmiChecked) {
    return _nvidiaSmiPath;
  }
  try {
    _nvidiaSmiPath = await which('nvidia-smi');
    _nvidiaSmiChecked = true;
    return _nvidiaSmiPath;
  } catch (error) {
    _nvidiaSmiPath = null;
    _nvidiaSmiChecked = true;
    return null;
  }
}

function parseValue(value: string | number | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  // Use parseFloat which reads numbers from the beginning of a string
  // e.g., parseFloat("38 W") returns 38, parseFloat("[N/A]") returns NaN
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function formatGpuDetails(rawJson: {
  nvidia_smi_log: RawNvidiaSmiLog;
}): GpuStats {
  const log = rawJson.nvidia_smi_log;
  const rawGpus = Array.isArray(log.gpu) ? log.gpu : [log.gpu];

  const gpus: GpuDeviceStats[] = rawGpus.map(
    (gpu: RawGpuInfo, index: number) => {
      const memTotal = parseValue(gpu.fb_memory_usage?.total) || 0;
      const memUsed = parseValue(gpu.fb_memory_usage?.used) || 0;

      let processes: GpuProcess[] = [];
      if (gpu.processes && gpu.processes.process_info) {
        const rawProcesses = Array.isArray(gpu.processes.process_info)
          ? gpu.processes.process_info
          : [gpu.processes.process_info];
        processes = rawProcesses.map((p: RawGpuProcess) => ({
          pid: p.pid,
          name: p.process_name,
          memoryUsedMb: parseValue(p.used_memory) || 0,
        }));
      }

      return {
        id: index,
        name: gpu.product_name,
        fanSpeedPercent: parseValue(gpu.fan_speed),
        performanceState: gpu.performance_state,
        memory: {
          totalMb: memTotal,
          usedMb: memUsed,
          freeMb: parseValue(gpu.fb_memory_usage?.free) || 0,
        },
        utilization: {
          gpuPercent: parseValue(gpu.utilization?.gpu_util),
          memoryPercent: parseValue(gpu.utilization?.memory_util),
        },
        temperature: {
          currentCelsius: parseValue(gpu.temperature?.gpu_temp),
        },
        power: {
          drawWatts: parseValue(gpu.power_readings?.power_draw),
          limitWatts: parseValue(gpu.power_readings?.power_limit),
        },
        processes: processes,
      };
    }
  );

  const summary = gpus.reduce(
    (acc, gpu) => {
      acc.totalMemoryMb += gpu.memory.totalMb;
      acc.totalMemoryUsedMb += gpu.memory.usedMb;
      acc.totalPowerDrawWatts += gpu.power.drawWatts ?? 0;
      acc.totalPowerLimitWatts += gpu.power.limitWatts ?? 0;
      acc.gpuUtilSum += gpu.utilization.gpuPercent ?? 0;
      acc.memUtilSum += gpu.utilization.memoryPercent ?? 0;
      acc.tempSum += gpu.temperature.currentCelsius ?? 0;
      if (gpu.utilization.gpuPercent !== null) acc.gpuUtilCount++;
      if (gpu.utilization.memoryPercent !== null) acc.memUtilCount++;
      if (gpu.temperature.currentCelsius !== null) acc.tempCount++;
      return acc;
    },
    {
      totalMemoryMb: 0,
      totalMemoryUsedMb: 0,
      totalPowerDrawWatts: 0,
      totalPowerLimitWatts: 0,
      gpuUtilSum: 0,
      gpuUtilCount: 0,
      memUtilSum: 0,
      memUtilCount: 0,
      tempSum: 0,
      tempCount: 0,
    }
  );

  return {
    available: true,
    driverVersion: String(log.driver_version),
    cudaVersion: String(log.cuda_version),
    gpus: gpus,
    summary: {
      gpuCount: gpus.length,
      totalMemoryMb: summary.totalMemoryMb,
      totalMemoryUsedMb: summary.totalMemoryUsedMb,
      avgGpuUtilizationPercent:
        summary.gpuUtilCount > 0
          ? Math.round(summary.gpuUtilSum / summary.gpuUtilCount)
          : null,
      avgMemoryUtilizationPercent:
        summary.memUtilCount > 0
          ? Math.round(summary.memUtilSum / summary.memUtilCount)
          : null,
      avgTemperatureCelsius:
        summary.tempCount > 0
          ? Math.round(summary.tempSum / summary.tempCount)
          : null,
      totalPowerDrawWatts:
        summary.totalPowerDrawWatts > 0 ? summary.totalPowerDrawWatts : null,
      totalPowerLimitWatts:
        summary.totalPowerLimitWatts > 0 ? summary.totalPowerLimitWatts : null,
    },
    systemMemory: getSystemMemoryStats(),
  };
}

export async function getGpuStats(): Promise<GpuStats> {
  const smiPath = await getNvidiaSmiPath();
  if (!smiPath) {
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
      systemMemory: getSystemMemoryStats(),
    };
  }
  try {
    const { stdout } = await execAsync(`${smiPath} -q -x`);
    const rawJson = xmlParser.parse(stdout);
    return formatGpuDetails(rawJson);
  } catch (error) {
    console.error('[gpu-utils] Error executing or parsing nvidia-smi:', error);
    throw new Error('Failed to get GPU statistics from nvidia-smi.');
  }
}
