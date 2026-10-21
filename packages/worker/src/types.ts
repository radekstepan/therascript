// packages/worker/src/types.ts
import type { TranscriptionJob, AnalysisJobPayload } from '@therascript/domain';

export type TranscriptionJobData = TranscriptionJob;
export type AnalysisJobData = AnalysisJobPayload;

/** BullMQ payload for `verification-jobs`: the SQLite `verification_jobs` row id. */
export interface VerificationJobData {
  jobId: number;
}
