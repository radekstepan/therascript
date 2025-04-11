import { atomWithStorage } from 'jotai/utils';

// --- Constants for Sidebar Width ---
// Keep constants here as they are tightly coupled
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 256;

// --- Sidebar Width Atom ---
export const sidebarWidthAtom = atomWithStorage<number>('session-sidebar-width', DEFAULT_SIDEBAR_WIDTH);
