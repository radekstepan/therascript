import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll use vi.doMock per test to avoid hoist issues

describe('gpu-utils.getGpuStats', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns available=false when nvidia-smi not found', async () => {
    vi.doMock('which', () => ({
      default: vi.fn().mockRejectedValue(new Error('nope')),
    }));
    // child_process won't be used but provide a stub to be safe
    vi.doMock('child_process', () => ({ exec: vi.fn() }));
    const mod = await import('./index.ts');
    const stats = await mod.getGpuStats();
    expect(stats.available).toBe(false);
    expect(stats.summary.gpuCount).toBe(0);
  });

  it('parses XML output when nvidia-smi exists', async () => {
    vi.doMock('which', () => ({
      default: vi.fn().mockResolvedValue('/usr/bin/nvidia-smi'),
    }));
    const xml = `<?xml version=\"1.0\"?><nvidia_smi_log><driver_version>555.12</driver_version><cuda_version>12.4</cuda_version><gpu><product_name>RTX</product_name><fan_speed>35 %</fan_speed><performance_state>P2</performance_state><fb_memory_usage><total>10240 MiB</total><used>5120 MiB</used><free>5120 MiB</free></fb_memory_usage><utilization><gpu_util>50 %</gpu_util><memory_util>40 %</memory_util></utilization><temperature><gpu_temp>70 C</gpu_temp></temperature><power_readings><power_draw>120 W</power_draw><power_limit>250 W</power_limit></power_readings><processes><process_info><pid>123</pid><process_name>python</process_name><used_memory>1024 MiB</used_memory></process_info></processes></gpu></nvidia_smi_log>`;
    vi.doMock('child_process', () => ({
      exec: (cmd: string, cb: any) => cb(null, { stdout: xml }),
    }));
    const mod = await import('./index.ts');
    const stats = await mod.getGpuStats();
    expect(stats.available).toBe(true);
    expect(stats.gpus[0].name).toBe('RTX');
    expect(stats.summary.gpuCount).toBe(1);
    expect(stats.summary.totalMemoryMb).toBeGreaterThan(0);
  });
});
