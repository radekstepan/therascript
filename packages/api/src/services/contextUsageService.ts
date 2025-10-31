// packages/api/src/services/contextUsageService.ts
// Centralized helpers to estimate context usage for chats (LM Studio–style meter)

import { calculateTokenCount } from './tokenizerService.js';
import {
  getActiveModel,
  getConfiguredContextSize,
} from './activeModelService.js';
import { listModels } from './ollamaService.js';
import { templateRepository } from '../repositories/templateRepository.js';
import { SYSTEM_PROMPT_TEMPLATES } from '@therascript/db/dist/sqliteService.js';
import type { BackendChatMessage, BackendSession } from '../types/index.js';

export interface ContextUsageBreakdown {
  systemTokens: number | null;
  transcriptTokens: number | null;
  chatHistoryTokens: number | null;
  inputDraftTokens: number | null;
}

export interface ContextUsageTotals {
  promptTokens: number | null;
  percentUsed: number | null;
  remainingForPrompt: number | null;
  remainingForOutput: number | null;
}

export interface ContextUsageModelInfo {
  name: string;
  configuredContextSize: number | null;
  defaultContextSize: number | null;
  effectiveContextSize: number | null;
}

export interface ContextUsageResult {
  model: ContextUsageModelInfo;
  breakdown: ContextUsageBreakdown;
  reserved: { outputTokens: number };
  totals: ContextUsageTotals;
  thresholds: { warnAt: number; dangerAt: number };
}

const getSystemPrompt = (
  title: 'system_prompt' | 'system_standalone_prompt'
): string => {
  const template = templateRepository.findByTitle(title);
  if (template) return template.text;
  // Fallbacks to hardcoded defaults from DB package
  return title === 'system_prompt'
    ? SYSTEM_PROMPT_TEMPLATES.SESSION_CHAT.text
    : SYSTEM_PROMPT_TEMPLATES.STANDALONE_CHAT.text;
};

async function resolveModelContextSizes(): Promise<{
  name: string;
  configured: number | null;
  defaultMax: number | null;
}> {
  const name = getActiveModel();
  const configured = getConfiguredContextSize();
  let defaultMax: number | null = null;
  try {
    const models = await listModels();
    const m = models.find((mm) => mm.name === name);
    defaultMax = m?.defaultContextSize ?? null;
  } catch (e) {
    // Leave defaultMax as null if models cannot be listed
  }
  return { name, configured, defaultMax };
}

function sumParts(parts: Array<number | null | undefined>): number | null {
  // Sum only known numeric parts; ignore null/undefined.
  // Return null only if no numeric parts are present.
  let total = 0;
  let hasAny = false;
  for (const p of parts) {
    if (typeof p === 'number' && !Number.isNaN(p)) {
      total += p;
      hasAny = true;
    }
  }
  return hasAny ? total : null;
}

export async function computeContextUsageForChat(options: {
  isStandalone: boolean;
  sessionData?: BackendSession; // required if !isStandalone
  messages: BackendChatMessage[]; // current messages (include latest user message if estimating just-sent)
  inputDraft?: string | null; // optional live input text
  reservedOutputTokens?: number; // default 512
}): Promise<ContextUsageResult> {
  const {
    isStandalone,
    sessionData,
    messages,
    inputDraft,
    reservedOutputTokens,
  } = options;
  const reserved =
    typeof reservedOutputTokens === 'number' && reservedOutputTokens > 0
      ? reservedOutputTokens
      : 512;

  // Resolve which system prompt applies: if chat already has system messages, use those; otherwise default by mode
  const systemMessages = messages.filter((m) => m.sender === 'system');
  const systemText =
    systemMessages.length > 0
      ? systemMessages.map((m) => m.text).join('\n\n')
      : getSystemPrompt(
          isStandalone ? 'system_standalone_prompt' : 'system_prompt'
        );
  const systemTokens = calculateTokenCount(systemText);

  // Transcript tokens: session-based only
  let transcriptTokens: number | null = null;
  if (!isStandalone) {
    const transcriptCount = sessionData?.transcriptTokenCount ?? null;
    transcriptTokens =
      typeof transcriptCount === 'number' ? transcriptCount : null;
  }

  // Chat history tokens: include user/ai turns (exclude system unless they are explicit system messages already counted)
  const nonSystemMessages = messages.filter((m) => m.sender !== 'system');
  const chatHistoryCombined = nonSystemMessages
    .map((m) => `${m.sender}: ${m.text}`)
    .join('\n');
  const chatHistoryTokens = calculateTokenCount(chatHistoryCombined);

  // Input draft tokens: for live preview
  const inputDraftTokens = inputDraft ? calculateTokenCount(inputDraft) : 0;

  // Resolve model context sizes
  const { name, configured, defaultMax } = await resolveModelContextSizes();
  const effective = configured ?? defaultMax ?? null;

  // Totals and percentages
  const promptTokens = sumParts([
    systemTokens,
    // For standalone chats, transcriptTokens is null and should be ignored
    transcriptTokens,
    chatHistoryTokens,
    inputDraftTokens,
  ]);
  const percentUsed =
    promptTokens !== null && effective
      ? Math.min(1, promptTokens / effective)
      : null;
  const remainingForPrompt =
    promptTokens !== null && effective !== null
      ? Math.max(0, effective - promptTokens)
      : null;
  const remainingForOutput =
    remainingForPrompt !== null
      ? Math.max(0, remainingForPrompt - reserved)
      : null;

  return {
    model: {
      name,
      configuredContextSize: configured,
      defaultContextSize: defaultMax,
      effectiveContextSize: effective,
    },
    breakdown: {
      systemTokens,
      transcriptTokens,
      chatHistoryTokens,
      inputDraftTokens,
    },
    reserved: { outputTokens: reserved },
    totals: {
      promptTokens,
      percentUsed,
      remainingForPrompt,
      remainingForOutput,
    },
    thresholds: { warnAt: 0.75, dangerAt: 0.9 },
  };
}

// --- Recommend a context size based on transcript size with buffer ---
export function recommendContextSize(params: {
  transcriptTokens?: number | null;
  modelDefaultMax?: number | null;
}): number | null {
  const transcript = params.transcriptTokens ?? null;
  const max = params.modelDefaultMax ?? null;
  if (transcript === null || transcript < 0) return max ?? null;
  // Heuristic: transcript + 2048 buffer, minimum 4096, rounded up to 256, capped at model max if known
  const base = Math.max(4096, transcript + 2048);
  const rounded = Math.ceil(base / 256) * 256;
  return max != null ? Math.min(rounded, max) : rounded;
}
