// packages/ui/src/store/analysisJobSortCriteriaAtom.ts
import { atomWithStorage } from 'jotai/utils';

export type AnalysisJobSortCriteria =
  | 'original_prompt'
  | 'short_prompt'
  | 'status'
  | 'created_at'
  | 'completed_at'
  | 'model_name';

/**
 * Atom storing the current sort criteria for the analysis jobs list.
 */
export const analysisJobSortCriteriaAtom =
  atomWithStorage<AnalysisJobSortCriteria>(
    'analysis-job-sort-criteria',
    'created_at' // Default sort
  );
