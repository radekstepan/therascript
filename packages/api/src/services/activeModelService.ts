/* packages/api/src/services/activeModelService.ts */
import config from '../config/index.js';

// Initialize with the value from the config file (.env)
let activeModelName: string = config.vllm.model;
// Store the configured context size (null means use vLLM default)
let configuredContextSize: number | null = null;

export const getActiveModel = (): string => {
  return activeModelName;
};

// --- New Getter for Context Size ---
export const getConfiguredContextSize = (): number | null => {
  return configuredContextSize;
};
// --- End New Getter ---

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

// Function to get the original model from config (might be useful)
export const getConfiguredModel = (): string => {
  return config.vllm.model;
};
