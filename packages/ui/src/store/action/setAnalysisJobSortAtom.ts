// packages/ui/src/store/action/setAnalysisJobSortAtom.ts
import { atom } from 'jotai';
import {
  analysisJobSortCriteriaAtom,
  analysisJobSortDirectionAtom,
  type AnalysisJobSortCriteria,
} from '..';

/**
 * A write-only Jotai atom to update the analysis jobs sort state.
 */
export const setAnalysisJobSortAtom = atom(
  null,
  (get, set, newCriteria: AnalysisJobSortCriteria) => {
    const currentCriteria = get(analysisJobSortCriteriaAtom);
    const currentDirection = get(analysisJobSortDirectionAtom);

    if (newCriteria === currentCriteria) {
      // Toggle direction if clicking the same column
      set(
        analysisJobSortDirectionAtom,
        currentDirection === 'asc' ? 'desc' : 'asc'
      );
    } else {
      // Set new criteria and default direction
      set(analysisJobSortCriteriaAtom, newCriteria);
      // Default to descending for date fields, ascending for others
      set(
        analysisJobSortDirectionAtom,
        newCriteria === 'created_at' || newCriteria === 'completed_at'
          ? 'desc'
          : 'asc'
      );
    }
  }
);
