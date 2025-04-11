import { atom } from 'jotai';
import {
    sidebarWidthAtom,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH
} from '..'; // Import from the main store index

export const clampedSidebarWidthAtom = atom(
    (get) => {
        const width = get(sidebarWidthAtom);
        return Math.max(MIN_SIDEBAR_WIDTH, Math.min(width, MAX_SIDEBAR_WIDTH));
    },
    (get, set, newWidth: number) => {
        // Clamp the value before setting the base atom
        const clampedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(newWidth, MAX_SIDEBAR_WIDTH));
        set(sidebarWidthAtom, clampedWidth);
    }
);
