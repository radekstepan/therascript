import { atomWithStorage } from 'jotai/utils';

export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256;

export const sidebarWidthAtom = atomWithStorage<number>('session-sidebar-width', DEFAULT_SIDEBAR_WIDTH);
