import { atomWithStorage } from 'jotai/utils';

// Define Sort Direction Type here
export type SortDirection = 'asc' | 'desc';

export const sessionSortDirectionAtom = atomWithStorage<SortDirection>('session-sort-direction', 'desc');
