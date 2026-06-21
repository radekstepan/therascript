/* packages/api/src/services/activeModelService.ts */
import config from '@therascript/config';

// Initialize with the value from the config file (.env)
let activeModelName: string = config.llm.modelPath;

// Process-level override for the LLM base URL. `null` means "use config default
// (local)". A non-null value is a normalized explicit URL (e.g. a remote LM
// Studio-compatible server). The override is intentionally process-local; it
// is not persisted and resets to `null` on process restart.
let configuredBaseUrl: string | null = null;

export const setActiveModelName = (name: string): void => {
  activeModelName = name;
};

// Store the configured context size (null means use LLM default)
let configuredContextSize: number | null = null;
export const setConfiguredContextSize = (size: number | null): void => {
  configuredContextSize = size;
};
let configuredTemperature: number = 0.7;
let configuredTopP: number = 0.9;
let configuredRepeatPenalty: number = 1.1;
// null = let llama.cpp decide automatically; >= 0 = explicit layer count
let configuredNumGpuLayers: number | null = null;
let configuredThinkingBudget: number | null = null; // null/-1 = unrestricted
let cachedVramEstimateBytes: number | null = null;

export const getActiveModel = (): string => {
  return activeModelName;
};

// --- New Getter for Context Size ---
export const getConfiguredContextSize = (): number | null => {
  return configuredContextSize;
};
// --- End New Getter ---

// --- New Getters for Sampling Parameters ---
export const getConfiguredTemperature = (): number => configuredTemperature;
export const getConfiguredTopP = (): number => configuredTopP;
export const getConfiguredRepeatPenalty = (): number => configuredRepeatPenalty;
export const getConfiguredNumGpuLayers = (): number | null =>
  configuredNumGpuLayers;
export const getConfiguredThinkingBudget = (): number | null =>
  configuredThinkingBudget;
export const getActiveModelVramEstimateBytes = (): number | null =>
  cachedVramEstimateBytes;
export const setActiveModelVramEstimateBytes = (bytes: number | null): void => {
  cachedVramEstimateBytes = bytes;
};
// --- End New Getters ---

// --- LLM Base URL helpers ---
//
// Semantics:
//   undefined -> do not change the currently configured base URL
//   null      -> reset to local/default base URL
//   string    -> use this explicit base URL (remote or custom local)
//
// `normalizeLlmBaseUrl` trims, validates `http(s)://`, and strips trailing
// slashes. Empty/whitespace becomes `null`. Invalid URLs throw.
export const normalizeLlmBaseUrl = (value?: string | null): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

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

  if (!normalized) {
    throw new Error('config.llm.baseURL is not configured');
  }

  return normalized;
};

export const getActiveBaseUrl = (): string => {
  return configuredBaseUrl || getDefaultBaseUrl();
};

export const isRemoteLlmBaseUrl = (baseUrl?: string | null): boolean => {
  const target = normalizeLlmBaseUrl(baseUrl) || getActiveBaseUrl();
  return target !== getDefaultBaseUrl();
};

export const getConfiguredBaseUrlOverride = (): string | null => {
  return configuredBaseUrl;
};

export const setActiveBaseUrl = (url: string | null): void => {
  configuredBaseUrl = normalizeLlmBaseUrl(url);
};
// --- End LLM Base URL helpers ---

// --- Modified Setter to include context size ---
export const setActiveModelAndContext = (
  newModelName: string,
  newContextSize?: number | null
): void => {
  if (!newModelName || typeof newModelName !== 'string') {
    console.error(
      '[ActiveModelService] Invalid model name provided:',
      newModelName
    );
    return;
  }

  let modelChanged = false;
  let contextChanged = false;

  if (newModelName !== activeModelName) {
    console.log(
      `[ActiveModelService] Changing active model from '${activeModelName}' to '${newModelName}'`
    );
    activeModelName = newModelName;
    modelChanged = true;
    // Clear any stale VRAM estimate from the previous model. The
    // background `loadLlmModel` will populate a fresh estimate for the
    // new model once it finishes loading.
    cachedVramEstimateBytes = null;
  }

  // Validate and update context size
  const validContextSize =
    newContextSize !== undefined &&
    newContextSize !== null &&
    Number.isInteger(newContextSize) &&
    newContextSize > 0
      ? newContextSize
      : null; // Treat invalid/missing input as null (use default)

  if (validContextSize !== configuredContextSize) {
    console.log(
      `[ActiveModelService] Changing configured context size from '${configuredContextSize ?? 'default'}' to '${validContextSize ?? 'default'}'`
    );
    configuredContextSize = validContextSize;
    contextChanged = true;
  }

  if (!modelChanged && !contextChanged) {
    console.log(
      `[ActiveModelService] Model '${newModelName}' and context size '${configuredContextSize ?? 'default'}' are already active.`
    );
  }
};
// --- End Modified Setter ---

// --- New Setter to include all parameters ---
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

  let modelChanged = false;
  let contextChanged = false;
  let temperatureChanged = false;
  let topPChanged = false;
  let repeatPenaltyChanged = false;
  let numGpuLayersChanged = false;
  let thinkingBudgetChanged = false;

  if (newModelName !== activeModelName) {
    console.log(
      `[ActiveModelService] Changing active model from '${activeModelName}' to '${newModelName}'`
    );
    activeModelName = newModelName;
    modelChanged = true;
    // Clear any stale VRAM estimate from the previous model. The
    // background `loadLlmModel` will populate a fresh estimate for the
    // new model once it finishes loading.
    cachedVramEstimateBytes = null;
  }

  // Validate and update context size
  const validContextSize =
    newContextSize !== undefined &&
    newContextSize !== null &&
    Number.isInteger(newContextSize) &&
    newContextSize > 0
      ? newContextSize
      : null; // Treat invalid/missing input as null (use default)

  if (validContextSize !== configuredContextSize) {
    console.log(
      `[ActiveModelService] Changing configured context size from '${configuredContextSize ?? 'default'}' to '${validContextSize ?? 'default'}'`
    );
    configuredContextSize = validContextSize;
    contextChanged = true;
  }

  // Validate and update temperature
  if (
    newTemperature !== undefined &&
    typeof newTemperature === 'number' &&
    newTemperature >= 0 &&
    newTemperature <= 2
  ) {
    if (newTemperature !== configuredTemperature) {
      console.log(
        `[ActiveModelService] Changing temperature from '${configuredTemperature}' to '${newTemperature}'`
      );
      configuredTemperature = newTemperature;
      temperatureChanged = true;
    }
  }

  // Validate and update top-p
  if (
    newTopP !== undefined &&
    typeof newTopP === 'number' &&
    newTopP >= 0 &&
    newTopP <= 1
  ) {
    if (newTopP !== configuredTopP) {
      console.log(
        `[ActiveModelService] Changing top-p from '${configuredTopP}' to '${newTopP}'`
      );
      configuredTopP = newTopP;
      topPChanged = true;
    }
  }

  // Validate and update repeat penalty
  if (
    newRepeatPenalty !== undefined &&
    typeof newRepeatPenalty === 'number' &&
    newRepeatPenalty >= 0 &&
    newRepeatPenalty <= 2
  ) {
    if (newRepeatPenalty !== configuredRepeatPenalty) {
      console.log(
        `[ActiveModelService] Changing repeat penalty from '${configuredRepeatPenalty}' to '${newRepeatPenalty}'`
      );
      configuredRepeatPenalty = newRepeatPenalty;
      repeatPenaltyChanged = true;
    }
  }

  // Validate and update GPU layers
  const validNumGpuLayers =
    newNumGpuLayers !== undefined &&
    newNumGpuLayers !== null &&
    Number.isInteger(newNumGpuLayers) &&
    newNumGpuLayers >= 0
      ? newNumGpuLayers
      : null; // null = let LLM decide automatically

  if (validNumGpuLayers !== configuredNumGpuLayers) {
    console.log(
      `[ActiveModelService] Changing GPU layers from '${configuredNumGpuLayers ?? 'auto'}' to '${validNumGpuLayers ?? 'auto'}'`
    );
    configuredNumGpuLayers = validNumGpuLayers;
    numGpuLayersChanged = true;
  }

  // Validate and update thinking budget
  const validThinkingBudget =
    newThinkingBudget !== undefined &&
    newThinkingBudget !== null &&
    Number.isInteger(newThinkingBudget)
      ? newThinkingBudget
      : null; // null/-1 = unrestricted

  if (validThinkingBudget !== configuredThinkingBudget) {
    console.log(
      `[ActiveModelService] Changing thinking budget from '${configuredThinkingBudget ?? 'unrestricted'}' to '${validThinkingBudget ?? 'unrestricted'}'`
    );
    configuredThinkingBudget = validThinkingBudget;
    thinkingBudgetChanged = true;
  }

  if (
    !modelChanged &&
    !contextChanged &&
    !temperatureChanged &&
    !topPChanged &&
    !repeatPenaltyChanged &&
    !numGpuLayersChanged &&
    !thinkingBudgetChanged
  ) {
    console.log(
      `[ActiveModelService] Model and all parameters are already active.`
    );
  }

  // Apply base URL change only when caller explicitly provided a value.
  // `undefined` means "do not change", `null` means "reset to default",
  // a non-empty string means "use this URL".
  if (newBaseUrl !== undefined) {
    const normalized = normalizeLlmBaseUrl(newBaseUrl);
    if (normalized !== configuredBaseUrl) {
      console.log(
        `[ActiveModelService] Changing base URL from '${configuredBaseUrl ?? 'default'}' to '${normalized ?? 'default'}'`
      );
      configuredBaseUrl = normalized;
    }
  }
};
// --- End New Setter ---

// Deprecated single setter - use setActiveModelAndContext instead
// export const setActiveModel = (newModelName: string): void => {
//     setActiveModelAndContext(newModelName, configuredContextSize); // Keep current context if only model changes
// };

// Function to get the original model from config (might be useful)
export const getConfiguredModel = (): string => {
  return config.llm.modelPath;
};
