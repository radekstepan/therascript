# System RAM Progress Bar Implementation Plan

## Overview

Add system RAM monitoring and display capabilities to the Therascript application. This feature will display real-time system memory usage in the GPU Status sidebar indicator and provide detailed system memory information in the System Resources modal.

## Goals

1. Monitor and track system RAM usage on the backend
2. Display RAM usage as a progress bar in the sidebar below the current GPU/VRAM bars
3. Provide detailed memory information in the System Resources modal
4. Ensure functionality works on all platforms (NVIDIA GPU, Apple Metal, CPU-only)

## Changes Required

### 1. Backend - GPU Utilities (`packages/gpu-utils`)

#### 1.1 Update Type Definitions

**File:** `packages/gpu-utils/src/types.ts`

Add system memory metrics to the `GpuStats` interface:

```typescript
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
  executionProvider?: 'gpu' | 'cpu' | 'metal';
  // NEW: System Memory Metrics
  systemMemory?: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    percentUsed: number;
  };
}
```

#### 1.2 Implement System RAM Monitoring

**File:** `packages/gpu-utils/src/index.ts`

Add Node.js `os` module import and system memory collection:

```typescript
import os from 'os';
```

Create a function to gather system memory metrics:

```typescript
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
```

Update `getGpuStats()` function to include system memory in the return value:

```typescript
export async function getGpuStats(): Promise<GpuStats> {
  const smiPath = await getNvidiaSmiPath();
  const systemMemoryStats = getSystemMemoryStats();

  if (!smiPath) {
    return {
      available: false,
      driverVersion: null,
      cudaVersion: null,
      gpus: [],
      summary: {
        // ... summary fields ...
      },
      executionProvider: 'cpu',
      systemMemory: systemMemoryStats, // Always include system memory
    };
  }

  try {
    const { stdout } = await execAsync(`${smiPath} -q -x`);
    const rawJson = xmlParser.parse(stdout);
    const gpuStats = formatGpuDetails(rawJson);

    return {
      ...gpuStats,
      systemMemory: systemMemoryStats,
    };
  } catch (error) {
    console.error('[gpu-utils] Error executing or parsing nvidia-smi:', error);
    throw new Error('Failed to get GPU statistics from nvidia-smi.');
  }
}
```

### 2. Backend - API Routes (`packages/api`)

#### 2.1 Update API Schema

**File:** `packages/api/src/routes/systemRoutes.ts`

Add system memory schema definition:

```typescript
const SystemMemorySchema = t.Object({
  totalMb: t.Number(),
  usedMb: t.Number(),
  freeMb: t.Number(),
  percentUsed: t.Number(),
});

const GpuStatsResponseSchema = t.Object({
  available: t.Boolean(),
  driverVersion: t.Nullable(t.String()),
  cudaVersion: t.Nullable(t.String()),
  gpus: t.Array(GpuDeviceStatsSchema),
  summary: GpuStatsSummarySchema,
  executionProvider: t.Union([
    t.Literal('gpu'),
    t.Literal('cpu'),
    t.Literal('metal'),
  ]),
  systemMemory: SystemMemorySchema,
});
```

Update the response schema reference:

```typescript
app.get('/gpu-stats', getGpuStatsHandler, {
  response: {
    200: 'gpuStatsResponse',
    500: t.Any(),
  },
  // ...
});
```

### 3. Frontend - UI Components (`packages/ui`)

#### 3.1 Update Type Definitions

**File:** `packages/ui/src/types.ts`

Add system memory interface:

```typescript
export interface SystemMemory {
  totalMb: number;
  usedMb: number;
  freeMb: number;
  percentUsed: number;
}

// Add to GpuStats interface
export interface GpuStats {
  // ... existing fields ...
  systemMemory?: SystemMemory;
}
```

#### 3.2 Update Sidebar Indicator

**File:** `packages/ui/src/components/User/GpuStatusIndicator.tsx`

Add system RAM progress bar below VRAM bar:

```typescript
const getRamColor = (
  value: number
): React.ComponentProps<typeof Progress>['color'] => {
  if (value > 90) return 'red';
  if (value > 75) return 'amber';
  return 'purple';
};

// In the JSX, add after VRAM progress bar:
{gpuStats?.systemMemory && (
  <Tooltip
    content={`System RAM: ${prettyBytes(gpuStats.systemMemory.usedMb * 1024 * 1024)} / ${prettyBytes(gpuStats.systemMemory.totalMb * 1024 * 1024)}`}
  >
    <Progress
      size="1"
      value={gpuStats.systemMemory.percentUsed}
      color={getRamColor(gpuStats.systemMemory.percentUsed)}
    />
  </Tooltip>
)}
```

#### 3.3 Update System Resources Modal

**File:** `packages/ui/src/components/User/GpuStatusModal.tsx`

Add SystemMemoryCard component:

```typescript
const SystemMemoryCard: React.FC<{ memory: SystemMemory }> = ({ memory }) => (
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
```

Add color function:

```typescript
const getRamColor = (
  value: number
): React.ComponentProps<typeof Progress>['color'] => {
  if (value > 90) return 'red';
  if (value > 75) return 'amber';
  return 'purple';
};
```

Add the card to the modal content (after ActiveModelCard, before GPU cards):

```typescript
{gpuStats?.systemMemory && (
  <SystemMemoryCard memory={gpuStats.systemMemory} />
)}
```

## Implementation Order

1. **Step 1:** Update `packages/gpu-utils/src/types.ts` - Add `SystemMemory` interface to `GpuStats`
2. **Step 2:** Update `packages/gpu-utils/src/index.ts` - Implement `getSystemMemoryStats()` function and integrate into `getGpuStats()`
3. **Step 3:** Update `packages/api/src/routes/systemRoutes.ts` - Add `SystemMemorySchema` and update response schema
4. **Step 4:** Build `packages/gpu-utils` to generate updated TypeScript definitions
5. **Step 5:** Update `packages/ui/src/types.ts` - Sync `GpuStats` type with backend
6. **Step 6:** Update `packages/ui/src/components/User/GpuStatusIndicator.tsx` - Add RAM progress bar in sidebar
7. **Step 7:** Update `packages/ui/src/components/User/GpuStatusModal.tsx` - Add SystemMemoryCard component

## Testing Checklist

- [ ] Verify system RAM metrics are returned on all platforms (Linux, macOS, Windows)
- [ ] Test sidebar display shows RAM usage bar below VRAM bar
- [ ] Verify tooltip shows correct memory usage in human-readable format (GB/MB)
- [ ] Test color coding: purple (<75%), amber (75-90%), red (>90%)
- [ ] Verify System Resources modal displays new System Memory card
- [ ] Test on CPU-only systems (no GPU) - ensure RAM data is still displayed
- [ ] Test on NVIDIA GPU systems - ensure RAM data appears alongside GPU data
- [ ] Test on macOS with Metal - ensure RAM data appears
- [ ] Verify memory calculations are accurate (used + free = total)
- [ ] Check for memory leaks in polling logic

## Notes

- System RAM monitoring uses Node.js built-in `os` module (no external dependencies)
- Memory data is polled alongside GPU stats at the same interval (2 seconds in UI)
- The `os.freemem()` value includes cached memory; for more accurate "available" memory, platform-specific methods would be needed, but `freemem()` is sufficient for general usage monitoring
- System memory data is always returned, even when GPU is unavailable, providing useful feedback for CPU-only environments

## Code Details & Corrections

### Type Export in gpu-utils

The `systemMemory` field in `GpuStats` should be made **required** (not optional) since it will always be returned. This simplifies frontend code by removing null checks.

### API Schema - Optional Field Handling

In `packages/api/src/routes/systemRoutes.ts`, the `executionProvider` field is currently required in the schema but **optional** in the TypeScript types (`executionProvider?: 'gpu' | 'cpu' | 'metal'`). Either:
1. Make it required in the TypeScript type (recommended), or
2. Wrap it with `t.Optional()` in the Elysia schema

For this implementation, the `systemMemory` schema should be **required** since it's always returned:

```typescript
const SystemMemorySchema = t.Object({
  totalMb: t.Number(),
  usedMb: t.Number(),
  freeMb: t.Number(),
  percentUsed: t.Number(),
});

const GpuStatsResponseSchema = t.Object({
  // ... existing fields ...
  systemMemory: SystemMemorySchema, // Required, not optional
});
```

### Sidebar Indicator - Display Logic Fix

The current `GpuStatusIndicator.tsx` only shows progress bars when `hasMetrics` is true (i.e., when NVIDIA GPU is available). The RAM progress bar should be displayed **regardless** of GPU availability. Update the JSX structure:

```typescript
// Show RAM bar even when no GPU metrics exist
{gpuStats?.systemMemory && (
  <Tooltip
    content={`System RAM: ${prettyBytes(gpuStats.systemMemory.usedMb * 1024 * 1024)} / ${prettyBytes(gpuStats.systemMemory.totalMb * 1024 * 1024)}`}
  >
    <Progress
      size="1"
      value={gpuStats.systemMemory.percentUsed}
      color={getRamColor(gpuStats.systemMemory.percentUsed)}
    />
  </Tooltip>
)}
```

This should be placed **outside** the `{hasMetrics && summary ? (...) : (...)}` conditional block, after the runtime text display.

### Modal - Card Placement

In `GpuStatusModal.tsx`, the `SystemMemoryCard` should appear:
- **After** the `ActiveModelCard` (if present)
- **Before** the GPU availability callout/GPU device cards
- Should be visible **even when** `gpuStats?.available` is false

Update the modal content structure:

```typescript
<Flex direction="column" gap="4">
  {/* Active Model Card */}
  {ollamaStatus && ollamaStatus.loaded && ollamaStatus.details && (
    <>
      <ActiveModelCard status={ollamaStatus} />
      <Separator size="4" />
    </>
  )}

  {/* System Memory Card - Always shown when available */}
  {gpuStats?.systemMemory && (
    <>
      <SystemMemoryCard memory={gpuStats.systemMemory} />
      <Separator size="4" />
    </>
  )}

  {/* GPU Cards or Unavailable Message */}
  {!gpuStats?.available ? (
    <Callout.Root color="amber">...</Callout.Root>
  ) : (
    <>
      {/* Driver/CUDA badges and GPU device cards */}
    </>
  )}
</Flex>
```

### Color Scheme Consistency

The plan uses `purple` for RAM under 75% to differentiate from GPU utilization (green) and VRAM (sky/blue). Verify this matches design expectations. Color choices:
- **GPU Utilization**: green → amber → red
- **VRAM Usage**: sky → amber → red  
- **System RAM**: purple → amber → red
