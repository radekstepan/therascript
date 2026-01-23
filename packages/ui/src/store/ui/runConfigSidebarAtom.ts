import { atomWithStorage } from 'jotai/utils';

export const MIN_RUN_CONFIG_SIDEBAR_WIDTH = 280;
export const MAX_RUN_CONFIG_SIDEBAR_WIDTH = 500;
export const DEFAULT_RUN_CONFIG_SIDEBAR_WIDTH = 320;

export const isRunConfigSidebarOpenAtom = atomWithStorage<boolean>(
  'runConfigSidebarOpen',
  false
);

export const runConfigSidebarWidthAtom = atomWithStorage<number>(
  'runConfigSidebarWidth',
  DEFAULT_RUN_CONFIG_SIDEBAR_WIDTH
);

export const temperatureAtom = atomWithStorage<number>('modelTemperature', 0.7);

export const topPAtom = atomWithStorage<number>('modelTopP', 0.9);

export const repeatPenaltyAtom = atomWithStorage<number>(
  'modelRepeatPenalty',
  1.1
);

const SYSTEM_PROMPT_OVERRIDE_KEY = 'systemPromptOverride';

interface SystemPromptOverrides {
  [sessionId: string]: string;
}

const systemPromptStorage = {
  getItem: (): SystemPromptOverrides => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(SYSTEM_PROMPT_OVERRIDE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  },
  setItem: (key: string, value: SystemPromptOverrides) => {
    localStorage.setItem(key, JSON.stringify(value));
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key);
  },
};

export const systemPromptOverrideAtom = atomWithStorage<SystemPromptOverrides>(
  SYSTEM_PROMPT_OVERRIDE_KEY,
  {},
  systemPromptStorage
);
