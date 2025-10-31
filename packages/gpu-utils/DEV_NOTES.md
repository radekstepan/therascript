# @therascript/gpu-utils — Developer Notes

Purpose: Utilities to read NVIDIA GPU status for UI.

## Key files
- `src/index.ts`, `src/types.ts`

## Behavior
- Uses `nvidia-smi` (if available) to parse XML and provide structured stats for UI.

## Gotchas
- Requires NVIDIA drivers and `nvidia-smi` on host; in CPU-only environments, handle absence gracefully at call sites.