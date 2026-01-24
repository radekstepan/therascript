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
