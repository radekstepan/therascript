import { atomWithStorage } from 'jotai/utils';

// TODO should be inferred from the API
export type SessionSortCriteria = 'sessionName' | 'clientName' | 'sessionType' | 'therapy' | 'date' | 'id';

export const sessionSortCriteriaAtom = atomWithStorage<SessionSortCriteria>('session-sort-criteria', 'date');
