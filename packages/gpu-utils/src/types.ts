// packages/gpu-utils/src/types.ts

// Simplified types for the raw XML-to-JSON structure from nvidia-smi
export interface RawGpuProcess {
  pid: number;
  process_name: string;
  used_memory: string;
}

export interface RawGpuInfo {
  product_name: string;
  driver_version: string | number;
  cuda_version: string | number;
  fan_speed: string;
  performance_state: string;
  fb_memory_usage?: {
    total: string;
    used: string;
    free: string;
  };
  utilization?: {
    gpu_util: string;
    memory_util: string;
  };
  temperature?: {
    gpu_temp: string;
  };
  power_readings?: {
    power_draw: string;
    power_limit: string;
  };
  processes: {
    process_info: RawGpuProcess | RawGpuProcess[];
  } | null;
}

export interface RawNvidiaSmiLog {
  timestamp: string;
  driver_version: string | number;
  cuda_version: string | number;
  attached_gpus: number;
  gpu: RawGpuInfo | RawGpuInfo[];
}

// Clean, formatted types for API response
export interface GpuProcess {
  pid: number;
  name: string;
  memoryUsedMb: number;
}

export interface GpuDeviceStats {
  id: number;
  name: string;
  fanSpeedPercent: number | null;
  performanceState: string;
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
  };
  utilization: {
    gpuPercent: number | null;
    memoryPercent: number | null;
  };
  temperature: {
    currentCelsius: number | null;
  };
  power: {
    drawWatts: number | null;
    limitWatts: number | null;
  };
  processes: GpuProcess[];
}

export interface GpuStats {
  available: boolean;
  driverVersion: string | null;
  cudaVersion: string | null;
  gpus: GpuDeviceStats[];
  summary: {
    gpuCount: number;
    totalMemoryMb: number;
    totalMemoryUsedMb: number;
    avgGpuUtilizationPercent: number | null;
    avgMemoryUtilizationPercent: number | null;
    avgTemperatureCelsius: number | null;
    totalPowerDrawWatts: number | null;
    totalPowerLimitWatts: number | null;
  };
}
