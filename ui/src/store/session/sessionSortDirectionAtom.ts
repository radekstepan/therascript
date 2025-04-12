import { atomWithStorage } from 'jotai/utils';

// TODO import from an types enum
export type SortDirection = 'asc' | 'desc';

export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');
