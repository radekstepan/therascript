// @vitest-environment node
// packages/api/src/routes/llmRoutes.test.ts
//
// Response-schema contract tests for the LLM routes.
//
// Background: the status endpoint (`GET /api/llm/status`) used to declare
// its `details` field as `LlmModelDetailSchema` (only the nested
// { format, family, families, parameter_size, quantization_level }
// object), but the route handler at `llmRoutes.ts:637-646` actually
// spreads the full `LlmModelInfo` into `details` — name, modified_at,
// size, digest, details, defaultContextSize, size_vram, expires_at,
// architecture. Elysia 1.2.25's strict response validation (with
// `additionalProperties: false` by default) rejected every status
// response with a 422 and the envelope:
//   { "type": "validation", "on": "response", "found": {...} }
//
// The user-visible symptom: `POST /api/llm/set-model` succeeds (toast:
// "Success"), the model actually loads on LM Studio, but the React
// Query poll of `/api/llm/status` 422s, so the UI's `llmStatus` stays
// `undefined` and the loaded model never appears in the chat panel
// header, the GpuStatusModal, or the configure-modal callout.
//
// These tests pin the contract so a future drift in `checkModelStatus`
// or `listModels` (or the route handlers) can't reintroduce the same
// 422 without `vitest` catching it.
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { llmResponseSchemas } from './llmRoutes.js';
import type { LlmModelInfo } from '@therascript/domain';

const {
  LlmModelInfoSchema,
  LlmStatusResponseSchema,
  AvailableModelsResponseSchema,
} = llmResponseSchemas;

// --- Sample payloads ----------------------------------------------------
// These mirror exactly what `checkModelStatus` (`llamaCppService.ts`)
// and `listModels` (`llamaCppService.ts:459-493`) produce after the
// route handler at `llmRoutes.ts:637-646` ISO-stringifies `modified_at`
// and `expires_at` and coerces `defaultContextSize` to `null` when unset.

const sampleModelDetails = {
  format: 'gguf',
  family: 'qwen35',
  families: null,
  parameter_size: '27B',
  quantization_level: 'Q4_K_S',
};

const sampleModelInfo: LlmModelInfo = {
  name: 'qwen3.6-27b-mtp',
  modified_at: new Date('2026-06-27T04:50:24.083Z'),
  size: 17_964_297_920,
  digest: 'qwen3.6-27b-mtp',
  details: sampleModelDetails,
  defaultContextSize: 262_144,
  size_vram: undefined,
  expires_at: undefined,
  architecture: null,
};

const sampleStatusResponse = {
  status: 'available' as const,
  activeModel: 'qwen3.6-27b-mtp',
  modelChecked: 'qwen3.6-27b-mtp',
  loaded: true,
  details: {
    ...sampleModelInfo,
    modified_at: sampleModelInfo.modified_at.toISOString(),
    expires_at: undefined,
    defaultContextSize: sampleModelInfo.defaultContextSize ?? null,
  },
  configuredContextSize: 30_000,
  configuredTemperature: 0.4,
  configuredTopP: 0.9,
  configuredRepeatPenalty: 1.1,
  configuredNumGpuLayers: null,
  configuredThinkingBudget: -1,
  activeBaseUrl: 'http://192.168.1.113:1234',
  defaultBaseUrl: 'http://localhost:1234',
  isRemoteBaseUrl: true,
  hasRemoteApiToken: false,
};

// --- Tests --------------------------------------------------------------

describe('llmRoutes response schemas', () => {
  it('accepts the exact status payload checkModelStatus produces (the original regression)', () => {
    // This is the shape from the bug report. The earlier schema rejected
    // it because `details` was typed as `LlmModelDetailSchema` (only
    // format/family/...) while the actual value is the full
    // LlmModelInfo. After the fix, the schema must accept it.
    expect(Value.Check(LlmStatusResponseSchema, sampleStatusResponse)).toBe(
      true
    );
  });

  it('accepts a listModels payload wrapped in AvailableModelsResponseSchema', () => {
    // `listModels` always emits `architecture: null`; the schema must
    // allow it (LM Studio does not expose per-layer metadata).
    const availableResponse = {
      models: [
        {
          ...sampleModelInfo,
          modified_at: sampleModelInfo.modified_at.toISOString(),
          defaultContextSize: sampleModelInfo.defaultContextSize ?? null,
        },
      ],
    };
    expect(Value.Check(AvailableModelsResponseSchema, availableResponse)).toBe(
      true
    );
  });

  it('accepts an LlmModelInfo with a populated architecture block', () => {
    // Defensive: when LM Studio eventually starts exposing per-layer
    // metadata, the schema must accept the populated form too. This
    // is a forward-compat guard, not something the current code path
    // emits, but if it ever does it shouldn't 422.
    const withArchitecture = {
      ...sampleModelInfo,
      modified_at: sampleModelInfo.modified_at.toISOString(),
      architecture: {
        num_layers: 48,
        num_attention_heads: 32,
        num_key_value_heads: 8,
        hidden_size: 6144,
        head_dim: 192,
        precision: 4,
      },
    };
    expect(Value.Check(LlmModelInfoSchema, withArchitecture)).toBe(true);
  });

  it('rejects a status payload missing the top-level required fields', () => {
    // Sanity: the schema is still strict on its declared required
    // fields. Stripping `activeBaseUrl` must fail. Guards against a
    // future loosening of the schema accidentally making every shape
    // valid.
    const broken = { ...sampleStatusResponse };
    delete (broken as Record<string, unknown>).activeBaseUrl;
    expect(Value.Check(LlmStatusResponseSchema, broken)).toBe(false);
  });

  it('rejects a status payload whose details is missing required LlmModelInfo fields', () => {
    // The original bug, expressed as a negative test: a `details`
    // value that only has `LlmModelDetailSchema` fields (format,
    // family, ...) is NOT a valid `LlmModelInfo` — it's missing
    // `name`, `modified_at`, `size`, `digest`, `details` (the nested
    // object). The new schema must continue to reject this, so we
    // never silently regress to the wrong type.
    const wrongDetailsShape = {
      ...sampleStatusResponse,
      details: { ...sampleModelDetails },
    };
    expect(Value.Check(LlmStatusResponseSchema, wrongDetailsShape)).toBe(false);
  });

  it('rejects an LlmModelInfo payload missing required `name`/`size`/etc.', () => {
    // Defensive: ensures the schema still requires the LlmModelInfo
    // core fields. If someone later swaps to a more permissive
    // schema, this catches it.
    const broken = { ...sampleModelInfo };
    delete (broken as Record<string, unknown>).name;
    expect(Value.Check(LlmModelInfoSchema, broken)).toBe(false);
  });
});
