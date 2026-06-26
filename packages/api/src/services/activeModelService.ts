/* packages/api/src/services/activeModelService.ts */
import config from '@therascript/config';
import { appSettingsRepository } from '@therascript/data';

let cachedVramEstimateBytes: number | null = null;

export const setActiveModelName = (name: string): void => {
  appSettingsRepository.updateSettings({ llm_model_name: name });
};

export const setConfiguredContextSize = (size: number | null): void => {
  appSettingsRepository.updateSettings({ llm_context_size: size });
};

export const getActiveModel = (): string => {
  const name = appSettingsRepository.getSettings().llm_model_name;
  return name || config.llm.modelPath || 'default';
};

export const getConfiguredContextSize = (): number | null => {
  return appSettingsRepository.getSettings().llm_context_size;
};

export const getConfiguredTemperature = (): number =>
  appSettingsRepository.getSettings().llm_temperature;
export const getConfiguredTopP = (): number =>
  appSettingsRepository.getSettings().llm_top_p;
export const getConfiguredRepeatPenalty = (): number =>
  appSettingsRepository.getSettings().llm_repeat_penalty;
export const getConfiguredNumGpuLayers = (): number | null =>
  appSettingsRepository.getSettings().llm_num_gpu_layers;
export const getConfiguredThinkingBudget = (): number | null =>
  appSettingsRepository.getSettings().llm_thinking_budget;

export const getActiveModelVramEstimateBytes = (): number | null =>
  cachedVramEstimateBytes;
export const setActiveModelVramEstimateBytes = (bytes: number | null): void => {
  cachedVramEstimateBytes = bytes;
};

export const normalizeLlmBaseUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid LLM base URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`LLM base URL must use http or https: ${trimmed}`);
  }

  return parsed.toString().replace(/\/+$/, '');
};

export const getDefaultBaseUrl = (): string => {
  const normalized = normalizeLlmBaseUrl(config.llm.baseURL);
  if (!normalized) throw new Error('config.llm.baseURL is not configured');
  return normalized;
};

export const getConfiguredBaseUrlOverride = (): string | null => {
  return appSettingsRepository.getSettings().llm_base_url;
};

export const getActiveBaseUrl = (): string => {
  return getConfiguredBaseUrlOverride() || getDefaultBaseUrl();
};

export const isRemoteLlmBaseUrl = (baseUrl?: string | null): boolean => {
  const target = normalizeLlmBaseUrl(baseUrl) || getActiveBaseUrl();
  return target !== getDefaultBaseUrl();
};

export const setActiveBaseUrl = (url: string | null): void => {
  appSettingsRepository.updateSettings({
    llm_base_url: normalizeLlmBaseUrl(url),
  });
};

/**
 * Read the currently stored remote LLM API token. Returns `null` when no
 * token is configured (or when the stored value is blank whitespace). The
 * token is global — a single value applies to every remote base URL — and
 * is intentionally never returned by the API surface to the UI; the route
 * handler exposes only its presence as `hasRemoteApiToken` on `LlmStatus`.
 */
export const getActiveApiToken = (): string | null => {
  const raw = appSettingsRepository.getSettings().llm_api_token;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Persist a new remote LLM API token, or clear the existing one.
 *   - `null`  -> clear the stored token.
 *   - `''`    -> also clear (treated as "no token").
 *   - any non-empty string -> trimmed and stored.
 * Trims the input so accidental whitespace never reaches the wire.
 */
export const setActiveApiToken = (token: string | null): void => {
  const trimmed = typeof token === 'string' ? token.trim() : null;
  const next = trimmed && trimmed.length > 0 ? trimmed : null;
  const current = getActiveApiToken();
  if (current === next) {
    return;
  }
  appSettingsRepository.updateSettings({ llm_api_token: next });
  console.log(
    `[ActiveModelService] ${next ? 'Set' : 'Cleared'} remote LLM API token.`
  );
};

/** True when a non-null remote LLM API token is currently configured. */
export const hasActiveApiToken = (): boolean => getActiveApiToken() !== null;

/**
 * Reset only the model-derived fields to their schema defaults and clear the
 * in-memory VRAM estimate. Leaves user sampling params (temperature, topP,
 * repeatPenalty, numGpuLayers, thinkingBudget) and the remote base URL
 * override alone — only `llm_model_name`, `llm_context_size`, and
 * `cachedVramEstimateBytes` are meaningless when no model is actually loaded.
 *
 * Called from the server boot sync. Never call this from a per-request code
 * path: it writes to the database and would race with the user's own edits.
 */
export const clearModelAndContext = (): void => {
  const current = appSettingsRepository.getSettings();
  const updates: Partial<typeof current> = {};
  if (current.llm_model_name !== 'default') {
    updates.llm_model_name = 'default';
  }
  if (current.llm_context_size !== null) {
    updates.llm_context_size = null;
  }
  if (Object.keys(updates).length > 0) {
    console.log(
      '[ActiveModelService] Clearing active model + context to defaults.'
    );
    appSettingsRepository.updateSettings(updates);
  }
  cachedVramEstimateBytes = null;
};

export const setActiveModelAndContextAndParams = (
  newModelName: string,
  newContextSize?: number | null,
  newTemperature?: number,
  newTopP?: number,
  newRepeatPenalty?: number,
  newNumGpuLayers?: number | null,
  newThinkingBudget?: number | null,
  newBaseUrl?: string | null,
  newApiToken?: string | null
): void => {
  if (!newModelName || typeof newModelName !== 'string') {
    console.error(
      '[ActiveModelService] Invalid model name provided:',
      newModelName
    );
    return;
  }

  const current = appSettingsRepository.getSettings();
  const updates: Partial<typeof current> = {};

  if (newModelName !== current.llm_model_name) {
    console.log(
      `[ActiveModelService] Changing active model from '${current.llm_model_name}' to '${newModelName}'`
    );
    updates.llm_model_name = newModelName;
    cachedVramEstimateBytes = null;
  }

  const validContextSize =
    newContextSize !== undefined &&
    newContextSize !== null &&
    Number.isInteger(newContextSize) &&
    newContextSize > 0
      ? newContextSize
      : null;
  if (validContextSize !== current.llm_context_size) {
    console.log(
      `[ActiveModelService] Changing configured context size from '${current.llm_context_size ?? 'default'}' to '${validContextSize ?? 'default'}'`
    );
    updates.llm_context_size = validContextSize;
  }

  if (
    newTemperature !== undefined &&
    typeof newTemperature === 'number' &&
    newTemperature >= 0 &&
    newTemperature <= 2
  ) {
    if (newTemperature !== current.llm_temperature) {
      console.log(
        `[ActiveModelService] Changing temperature from '${current.llm_temperature}' to '${newTemperature}'`
      );
      updates.llm_temperature = newTemperature;
    }
  }

  if (
    newTopP !== undefined &&
    typeof newTopP === 'number' &&
    newTopP >= 0 &&
    newTopP <= 1
  ) {
    if (newTopP !== current.llm_top_p) {
      console.log(
        `[ActiveModelService] Changing top-p from '${current.llm_top_p}' to '${newTopP}'`
      );
      updates.llm_top_p = newTopP;
    }
  }

  if (
    newRepeatPenalty !== undefined &&
    typeof newRepeatPenalty === 'number' &&
    newRepeatPenalty >= 0 &&
    newRepeatPenalty <= 2
  ) {
    if (newRepeatPenalty !== current.llm_repeat_penalty) {
      console.log(
        `[ActiveModelService] Changing repeat penalty from '${current.llm_repeat_penalty}' to '${newRepeatPenalty}'`
      );
      updates.llm_repeat_penalty = newRepeatPenalty;
    }
  }

  const validNumGpuLayers =
    newNumGpuLayers !== undefined &&
    newNumGpuLayers !== null &&
    Number.isInteger(newNumGpuLayers) &&
    newNumGpuLayers >= 0
      ? newNumGpuLayers
      : null;
  if (validNumGpuLayers !== current.llm_num_gpu_layers) {
    console.log(
      `[ActiveModelService] Changing GPU layers from '${current.llm_num_gpu_layers ?? 'auto'}' to '${validNumGpuLayers ?? 'auto'}'`
    );
    updates.llm_num_gpu_layers = validNumGpuLayers;
  }

  const validThinkingBudget =
    newThinkingBudget !== undefined &&
    newThinkingBudget !== null &&
    Number.isInteger(newThinkingBudget)
      ? newThinkingBudget
      : null;
  if (validThinkingBudget !== current.llm_thinking_budget) {
    console.log(
      `[ActiveModelService] Changing thinking budget from '${current.llm_thinking_budget ?? 'unrestricted'}' to '${validThinkingBudget ?? 'unrestricted'}'`
    );
    updates.llm_thinking_budget = validThinkingBudget;
  }

  if (newBaseUrl !== undefined) {
    const normalized = normalizeLlmBaseUrl(newBaseUrl);
    if (normalized !== current.llm_base_url) {
      console.log(
        `[ActiveModelService] Changing base URL from '${current.llm_base_url ?? 'default'}' to '${normalized ?? 'default'}'`
      );
      updates.llm_base_url = normalized;
    }
  }

  if (newApiToken !== undefined) {
    const normalized =
      typeof newApiToken === 'string' && newApiToken.trim().length > 0
        ? newApiToken.trim()
        : null;
    if (normalized !== current.llm_api_token) {
      console.log(
        `[ActiveModelService] ${normalized ? 'Setting' : 'Clearing'} remote LLM API token.`
      );
      updates.llm_api_token = normalized;
    }
  }

  if (Object.keys(updates).length > 0) {
    appSettingsRepository.updateSettings(updates);
    console.log(
      `[ActiveModelService] Updated global LLM settings in DB:`,
      updates
    );
  } else {
    console.log(
      `[ActiveModelService] Model and all parameters are already active.`
    );
  }
};

export const getConfiguredModel = (): string => {
  return config.llm.modelPath;
};
