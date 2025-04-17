// packages/api/src/services/activeModelService.ts
import config from '../config/index.js';

// Initialize with the value from the config file (.env)
let activeModelName: string = config.ollama.model;

export const getActiveModel = (): string => {
    return activeModelName;
};

export const setActiveModel = (newModelName: string): void => {
    if (!newModelName || typeof newModelName !== 'string') {
        console.error("[ActiveModelService] Invalid model name provided:", newModelName);
        // Optionally throw an error or just log and keep the old one
        return;
    }
    if (newModelName !== activeModelName) {
        console.log(`[ActiveModelService] Changing active model from '${activeModelName}' to '${newModelName}'`);
        activeModelName = newModelName;
    } else {
        console.log(`[ActiveModelService] Model '${newModelName}' is already the active model.`);
    }
};

// Function to get the original model from config (might be useful)
export const getConfiguredModel = (): string => {
    return config.ollama.model;
};
