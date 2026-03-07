import { describe, it, expect } from 'vitest';
import {
  estimateVramUsage,
  getVramPerToken,
  getBitsPerWeight,
  parseParamCount,
} from './ollamaService.real.js';
import type { OllamaModelInfo } from '@therascript/domain';

describe('estimateVramUsage', () => {
  it('calculates KV cache correctly for Llama 3 8B', () => {
    const model: OllamaModelInfo = {
      name: 'llama3:8b',
      size: 4.8 * 1024 * 1024 * 1024, // 4.8 GB
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '8B',
        quantization_level: 'Q4_K_M',
      },
      architecture: {
        num_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        precision: 2,
      },
    };

    const result = estimateVramUsage(model, 8192);

    expect(result).not.toBeNull();
    if (result !== null) {
      // For Llama 3 8B Q4_K_M:
      // - Weights from quant formula: 8B × 4.5 bpw / 8 = ~4.19 GB
      // - KV cache at 8192 context: ~1 GB
      // - CUDA overhead: 512 MB
      // - Total VRAM: ~5.7 GB
      const expectedVramBytes = 5.7 * 1024 * 1024 * 1024;
      const tolerance = expectedVramBytes * 0.1; // 10% tolerance
      expect(Math.abs(result.vram_bytes - expectedVramBytes)).toBeLessThan(
        tolerance
      );
      // All layers on GPU → no CPU RAM needed
      expect(result.ram_bytes).toBe(0);
      // KV cache and overhead are non-zero
      expect(result.kv_cache_bytes).toBeGreaterThan(0);
      expect(result.overhead_bytes).toBe(512 * 1024 * 1024);
    }
  });

  it('returns null for missing architecture', () => {
    const model: OllamaModelInfo = {
      name: 'unknown',
      size: 1000000000,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'unknown',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
    };

    expect(estimateVramUsage(model, 4096)).toBeNull();
  });

  it('returns null for incomplete architecture', () => {
    const model: OllamaModelInfo = {
      name: 'incomplete',
      size: 1000000000,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'incomplete',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
      architecture: {
        num_layers: 32,
        // Missing other required fields
        precision: 2,
      },
    };

    expect(estimateVramUsage(model, 4096)).toBeNull();
  });

  it('returns null when model size is missing', () => {
    const model: OllamaModelInfo = {
      name: 'nosize',
      size: 0,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'unknown',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
      architecture: {
        num_layers: 32,
        num_attention_heads: 32,
        hidden_size: 4096,
        precision: 2,
      },
    };

    expect(estimateVramUsage(model, 4096)).toBeNull();
  });

  it('uses explicit head_dim when available (Gemma 3 4B)', () => {
    const model: OllamaModelInfo = {
      name: 'gemma3:4b',
      size: 2.6 * 1024 * 1024 * 1024, // ~2.6 GB
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'gemma',
        families: ['gemma'],
        parameter_size: '4B',
        quantization_level: 'Q4_K_M',
      },
      architecture: {
        num_layers: 34,
        num_attention_heads: 8,
        num_key_value_heads: 4,
        hidden_size: 2560,
        head_dim: 256, // Explicit head_dim from metadata
        precision: 2,
      },
    };

    const result = estimateVramUsage(model, 4096);

    expect(result).not.toBeNull();
    if (result !== null) {
      // For Gemma 3 4B with explicit head_dim:
      // - Weights from quant formula: 4B × 4.5 bpw / 8 = 2,250,000,000 bytes
      // - KV cache at 4096 context: 2 × 34 × 4 × 256 × 2 × 4096 = ~569 MB
      // - CUDA overhead: 512 MB
      const kvCacheBytes = 2 * 34 * 4 * 256 * 2 * 4096;
      const weightsBytes = Math.round((4e9 * 4.5) / 8);
      const overhead = 512 * 1024 * 1024;
      const expectedVram = weightsBytes + kvCacheBytes + overhead;
      const tolerance = expectedVram * 0.01; // 1% tolerance
      expect(Math.abs(result.vram_bytes - expectedVram)).toBeLessThan(
        tolerance
      );
      expect(result.ram_bytes).toBe(0);
      expect(result.kv_cache_bytes).toBe(kvCacheBytes);
    }
  });

  it('calculates correctly for Gemma2 with GQA', () => {
    const model: OllamaModelInfo = {
      name: 'gemma2:9b',
      size: 5.5 * 1024 * 1024 * 1024, // 5.5 GB
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'gemma',
        families: ['gemma'],
        parameter_size: '9B',
        quantization_level: 'Q4_K_M',
      },
      architecture: {
        num_layers: 42,
        num_attention_heads: 8,
        num_key_value_heads: 1, // GQA with 8x compression
        hidden_size: 3584,
        precision: 2,
      },
    };

    const result = estimateVramUsage(model, 4096);

    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.vram_bytes).toBeGreaterThan(model.size);
    }
  });
});

describe('getVramPerToken', () => {
  it('calculates bytes per token for Llama 3 8B', () => {
    const model: OllamaModelInfo = {
      name: 'llama3:8b',
      size: 4.8 * 1024 * 1024 * 1024,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'llama',
        families: ['llama'],
        parameter_size: '8B',
        quantization_level: 'Q4_K_M',
      },
      architecture: {
        num_layers: 32,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 4096,
        precision: 2,
      },
    };

    const vramPerToken = getVramPerToken(model);

    expect(vramPerToken).not.toBeNull();
    if (vramPerToken !== null) {
      // For Llama 3 8B:
      // Per-token KV cache = 2 × 32 × 8 × 128 × 2 = ~131,072 bytes = 0.125 MB
      const expectedBytesPerToken = 2 * 32 * 8 * (4096 / 32) * 2;
      expect(vramPerToken).toBe(expectedBytesPerToken);
    }
  });

  it('uses explicit head_dim when available (Gemma 3 4B)', () => {
    const model: OllamaModelInfo = {
      name: 'gemma3:4b',
      size: 2.6 * 1024 * 1024 * 1024,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'gemma',
        families: ['gemma'],
        parameter_size: '4B',
        quantization_level: 'Q4_K_M',
      },
      architecture: {
        num_layers: 34,
        num_attention_heads: 8,
        num_key_value_heads: 4,
        hidden_size: 2560,
        head_dim: 256, // Explicit head_dim from metadata
        precision: 2,
      },
    };

    const vramPerToken = getVramPerToken(model);

    expect(vramPerToken).not.toBeNull();
    if (vramPerToken !== null) {
      // For Gemma 3 4B with explicit head_dim:
      // Per-token KV cache = 2 × 34 × 4 × 256 × 2 = ~138,752 bytes
      const expectedBytesPerToken = 2 * 34 * 4 * 256 * 2;
      expect(vramPerToken).toBe(expectedBytesPerToken);
    }
  });

  it('returns null for missing architecture', () => {
    const model: OllamaModelInfo = {
      name: 'unknown',
      size: 1000000000,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'unknown',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
    };

    expect(getVramPerToken(model)).toBeNull();
  });

  it('returns null for incomplete architecture', () => {
    const model: OllamaModelInfo = {
      name: 'incomplete',
      size: 1000000000,
      digest: 'abc123',
      modified_at: new Date(),
      details: {
        format: 'gguf',
        family: 'incomplete',
        families: null,
        parameter_size: 'unknown',
        quantization_level: 'unknown',
      },
      architecture: {
        num_layers: 32,
        precision: 2,
      },
    };

    expect(getVramPerToken(model)).toBeNull();
  });
});

describe('getBitsPerWeight', () => {
  it('returns exact bpw for known quantization labels', () => {
    expect(getBitsPerWeight('Q4_K_M')).toBe(4.5);
    expect(getBitsPerWeight('Q4_K_S')).toBe(4.37);
    expect(getBitsPerWeight('Q8_0')).toBe(8.5);
    expect(getBitsPerWeight('Q6_K')).toBe(6.56);
    expect(getBitsPerWeight('Q5_K_M')).toBe(5.5);
    expect(getBitsPerWeight('Q3_K_M')).toBe(3.91);
    expect(getBitsPerWeight('Q2_K')).toBe(2.63);
    expect(getBitsPerWeight('F16')).toBe(16);
    expect(getBitsPerWeight('F32')).toBe(32);
    expect(getBitsPerWeight('IQ4_XS')).toBe(4.25);
  });

  it('is case-insensitive', () => {
    expect(getBitsPerWeight('q4_k_m')).toBe(4.5);
    expect(getBitsPerWeight('f16')).toBe(16);
  });

  it('returns 0 for unknown quantization', () => {
    expect(getBitsPerWeight('UNKNOWN')).toBe(0);
    expect(getBitsPerWeight('')).toBe(0);
  });
});

describe('parseParamCount', () => {
  it('parses billion-scale strings correctly', () => {
    expect(parseParamCount('8B')).toBe(8_000_000_000);
    expect(parseParamCount('70B')).toBe(70_000_000_000);
    expect(parseParamCount('3.8B')).toBe(3_800_000_000);
    expect(parseParamCount('405B')).toBe(405_000_000_000);
  });

  it('is case-insensitive', () => {
    expect(parseParamCount('8b')).toBe(8_000_000_000);
    expect(parseParamCount('12B')).toBe(12_000_000_000);
  });

  it('returns null for unparseable strings', () => {
    expect(parseParamCount('unknown')).toBeNull();
    expect(parseParamCount('')).toBeNull();
  });
});

describe('estimateVramUsage with GPU layer split', () => {
  const model: OllamaModelInfo = {
    name: 'llama3:8b',
    size: 4.8 * 1024 * 1024 * 1024,
    digest: 'abc123',
    modified_at: new Date(),
    details: {
      format: 'gguf',
      family: 'llama',
      families: ['llama'],
      parameter_size: '8B',
      quantization_level: 'Q4_K_M',
    },
    architecture: {
      num_layers: 32,
      num_attention_heads: 32,
      num_key_value_heads: 8,
      hidden_size: 4096,
      precision: 2,
    },
  };

  it('splits weights proportionally between VRAM and RAM', () => {
    // 16 of 32 layers on GPU = 50% on GPU
    const result = estimateVramUsage(model, 4096, 16);
    expect(result).not.toBeNull();
    if (result !== null) {
      const totalWeights = result.weights_bytes;
      expect(result.ram_bytes).toBeCloseTo(totalWeights / 2, -3);
      const weightsVram = totalWeights - result.ram_bytes;
      expect(weightsVram).toBeCloseTo(totalWeights / 2, -3);
      // VRAM includes half weights + KV cache + overhead
      expect(result.vram_bytes).toBe(
        weightsVram + result.kv_cache_bytes + result.overhead_bytes
      );
    }
  });

  it('puts everything on GPU when numGpuLayers equals total layers', () => {
    const result = estimateVramUsage(model, 4096, 32);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.ram_bytes).toBe(0);
      expect(result.overhead_bytes).toBe(512 * 1024 * 1024);
      expect(result.vram_bytes).toBe(
        result.weights_bytes + result.kv_cache_bytes + result.overhead_bytes
      );
    }
  });

  it('moves weights to RAM but keeps KV cache in VRAM when numGpuLayers is 0', () => {
    // Conservative estimate: KV cache is always counted as VRAM (same as LM Studio)
    const result = estimateVramUsage(model, 4096, 0);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.ram_bytes).toBe(result.weights_bytes);
      expect(result.vram_bytes).toBe(result.kv_cache_bytes); // no overhead, no weights in VRAM
      expect(result.overhead_bytes).toBe(0);
    }
  });

  it('defaults to all layers on GPU when numGpuLayers is undefined', () => {
    const all = estimateVramUsage(model, 4096);
    const explicit = estimateVramUsage(model, 4096, 32);
    expect(all).toEqual(explicit);
  });

  it('clamps numGpuLayers to total layer count', () => {
    const result = estimateVramUsage(model, 4096, 999);
    const expected = estimateVramUsage(model, 4096, 32);
    expect(result).toEqual(expected);
  });
});

describe('estimateVramUsage — Gemma 3 12B (the problematic model)', () => {
  const gemma3_12b: OllamaModelInfo = {
    name: 'gemma3:12b',
    size: 8.1 * 1024 * 1024 * 1024,
    digest: 'abc123',
    modified_at: new Date(),
    details: {
      format: 'gguf',
      family: 'gemma3',
      families: ['gemma3'],
      parameter_size: '12B',
      quantization_level: 'Q4_K_M',
    },
    architecture: {
      num_layers: 46,
      num_attention_heads: 8,
      num_key_value_heads: 4,
      hidden_size: 3840,
      head_dim: 256,
      precision: 2,
    },
  };

  it('all layers on GPU: no RAM usage, CUDA overhead present', () => {
    const result = estimateVramUsage(gemma3_12b, 8192);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.ram_bytes).toBe(0);
      expect(result.overhead_bytes).toBe(512 * 1024 * 1024);
      expect(result.vram_bytes).toBe(
        result.weights_bytes + result.kv_cache_bytes + result.overhead_bytes
      );
    }
  });

  it('numGpuLayers=1 (the accidental setting): nearly all weights go to RAM', () => {
    const result = estimateVramUsage(gemma3_12b, 8192, 1);
    expect(result).not.toBeNull();
    if (result !== null) {
      // Only 1/46 layers on GPU → 97.8% of weights in RAM
      const gpuRatio = 1 / 46;
      const expectedRam = Math.round(result.weights_bytes * (1 - gpuRatio));
      expect(result.ram_bytes).toBe(expectedRam);
      // VRAM = tiny slice of weights + KV cache + CUDA overhead (GPU still active)
      expect(result.vram_bytes).toBeLessThan(result.ram_bytes);
      // CUDA overhead still present because at least one layer is on GPU
      expect(result.overhead_bytes).toBe(512 * 1024 * 1024);
    }
  });

  it('numGpuLayers=0 (CPU only): all weights in RAM, VRAM = KV cache only', () => {
    const result = estimateVramUsage(gemma3_12b, 8192, 0);
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(result.ram_bytes).toBe(result.weights_bytes);
      expect(result.vram_bytes).toBe(result.kv_cache_bytes);
      expect(result.overhead_bytes).toBe(0);
    }
  });

  it('numGpuLayers=46 (explicit all): same result as auto', () => {
    const auto = estimateVramUsage(gemma3_12b, 8192);
    const explicit = estimateVramUsage(gemma3_12b, 8192, 46);
    expect(auto).toEqual(explicit);
  });

  it('numGpuLayers=23 (half): VRAM ≈ RAM for weights', () => {
    const result = estimateVramUsage(gemma3_12b, 8192, 23);
    expect(result).not.toBeNull();
    if (result !== null) {
      const gpuRatio = 23 / 46; // exactly 0.5
      const expectedRam = Math.round(result.weights_bytes * (1 - gpuRatio));
      expect(result.ram_bytes).toBe(expectedRam);
      const weightsOnGpu = result.weights_bytes - result.ram_bytes;
      // VRAM = half weights + KV cache + CUDA overhead (GPU still active)
      expect(result.vram_bytes).toBe(
        weightsOnGpu + result.kv_cache_bytes + result.overhead_bytes
      );
      expect(result.overhead_bytes).toBe(512 * 1024 * 1024);
    }
  });

  it('KV cache grows with context size', () => {
    const small = estimateVramUsage(gemma3_12b, 4096);
    const large = estimateVramUsage(gemma3_12b, 32768);
    expect(small).not.toBeNull();
    expect(large).not.toBeNull();
    if (small && large) {
      expect(large.kv_cache_bytes).toBeGreaterThan(small.kv_cache_bytes);
      // KV cache should scale linearly with context
      expect(large.kv_cache_bytes / small.kv_cache_bytes).toBeCloseTo(8, 1); // 32768 / 4096 = 8
    }
  });
});
