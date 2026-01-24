import { describe, it, expect } from 'vitest';
import { estimateVramUsage, getVramPerToken } from './ollamaService.real.js';
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

    const vram = estimateVramUsage(model, 8192);

    expect(vram).not.toBeNull();
    if (vram !== null) {
      // For Llama 3 8B:
      // - Model weights: ~4.8 GB
      // - KV cache at 8192 context: ~1 GB
      // - Total: ~5.8 GB
      const expectedVramBytes = 5.8 * 1024 * 1024 * 1024;
      const tolerance = expectedVramBytes * 0.1; // 10% tolerance
      expect(Math.abs(vram - expectedVramBytes)).toBeLessThan(tolerance);
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

    const vram = estimateVramUsage(model, 4096);

    expect(vram).not.toBeNull();
    if (vram !== null) {
      // For Gemma 3 4B with explicit head_dim:
      // - Model weights: ~2.6 GB
      // - KV cache at 4096 context: 2 * 34 * 4 * 256 * 2 * 4096 = ~569 MB
      // - Total: ~3.17 GB
      const kvCacheBytes = 2 * 34 * 4 * 256 * 2 * 4096;
      const expectedTotal = model.size + kvCacheBytes;
      const tolerance = expectedTotal * 0.01; // 1% tolerance (using exact formula)
      expect(Math.abs(vram - expectedTotal)).toBeLessThan(tolerance);
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

    const vram = estimateVramUsage(model, 4096);

    expect(vram).not.toBeNull();
    if (vram !== null) {
      expect(vram).toBeGreaterThan(model.size);
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
