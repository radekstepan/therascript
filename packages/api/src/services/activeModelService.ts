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

export const setActiveModelAndContextAndParams = (
  newModelName: string,
  newContextSize?: number | null,
  newTemperature?: number,
  newTopP?: number,
  newRepeatPenalty?: number,
  newNumGpuLayers?: number | null,
  newThinkingBudget?: number | null,
  newBaseUrl?: string | null
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
