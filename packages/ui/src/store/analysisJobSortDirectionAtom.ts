// packages/ui/src/store/analysisJobSortDirectionAtom.ts
import { atomWithStorage } from 'jotai/utils';
import type { SortDirection } from './session/sessionSortDirectionAtom';

/**
 * Atom storing the current sort direction for the analysis jobs list.
 */
export const analysisJobSortDirectionAtom = atomWithStorage<SortDirection>(
  'analysis-job-sort-direction',
  'desc' // Default to descending for 'created_at'
);
