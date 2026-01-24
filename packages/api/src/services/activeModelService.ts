/* packages/api/src/services/activeModelService.ts */
import config from '@therascript/config';

// Initialize with the value from the config file (.env)
let activeModelName: string = config.ollama.model;
// Store the configured context size (null means use Ollama default)
let configuredContextSize: number | null = null;
let configuredTemperature: number = 0.7;
let configuredTopP: number = 0.9;
let configuredRepeatPenalty: number = 1.1;

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
// --- End New Getters ---

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
// --- End Modified Setter ---

// --- New Setter to include all parameters ---
export const setActiveModelAndContextAndParams = (
  newModelName: string,
  newContextSize?: number | null,
  newTemperature?: number,
  newTopP?: number,
  newRepeatPenalty?: number
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

  if (
    !modelChanged &&
    !contextChanged &&
    !temperatureChanged &&
    !topPChanged &&
    !repeatPenaltyChanged
  ) {
    console.log(
      `[ActiveModelService] Model and all parameters are already active.`
    );
  }
};
// --- End New Setter ---

// Deprecated single setter - use setActiveModelAndContext instead
// export const setActiveModel = (newModelName: string): void => {
//     setActiveModelAndContext(newModelName, configuredContextSize); // Keep current context if only model changes
// };

// Function to get the original model from config (might be useful)
export const getConfiguredModel = (): string => {
  return config.ollama.model;
};
