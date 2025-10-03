// packages/api/src/repositories/analysisRepository.ts
import { db, run, all, get } from '@therascript/db';
import type { AnalysisJob, IntermediateSummary } from '../types/index.js';

// --- SQL Statements ---

// Analysis Jobs
const insertJobSql = `
    INSERT INTO analysis_jobs (original_prompt, short_prompt, status, created_at, model_name, context_size, strategy_json) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
`;
const selectJobByIdSql = 'SELECT * FROM analysis_jobs WHERE id = ?';
const selectAllJobsSql = 'SELECT * FROM analysis_jobs ORDER BY created_at DESC';
const updateJobStatusSql = `
    UPDATE analysis_jobs 
    SET status = ?, error_message = ?, final_result = ?, completed_at = ?
    WHERE id = ?
`;
const updateJobShortPromptSql =
  'UPDATE analysis_jobs SET short_prompt = ? WHERE id = ?';
const updateJobStrategyAndStatusSql =
  "UPDATE analysis_jobs SET strategy_json = ?, status = 'pending' WHERE id = ?";
const deleteJobSql = 'DELETE FROM analysis_jobs WHERE id = ?';

// Analysis Job Sessions (Join Table)
const insertJobSessionSql = `
    INSERT INTO analysis_job_sessions (analysis_job_id, session_id) 
    VALUES (?, ?)
`;
const selectAllJobSessionsSql = 'SELECT * FROM analysis_job_sessions';

// Intermediate Summaries
const insertIntermediateSummarySql = `
    INSERT INTO intermediate_summaries (analysis_job_id, session_id, status) 
    VALUES (?, ?, ?)
`;
const selectPendingSummariesByJobIdSql = `
    SELECT * FROM intermediate_summaries 
    WHERE analysis_job_id = ? AND status = 'pending'
`;
const selectAllSummariesByJobIdSql = `
    SELECT * FROM intermediate_summaries WHERE analysis_job_id = ?
`;
const selectAllIntermediateSummariesSql =
  'SELECT * FROM intermediate_summaries';
const updateIntermediateSummarySql = `
    UPDATE intermediate_summaries 
    SET summary_text = ?, status = ?, error_message = ? 
    WHERE id = ?
`;

// --- Repository Implementation ---

export const analysisRepository = {
  /**
   * Creates a new analysis job and its associated session links and intermediate tasks.
   */
  createJob: (
    prompt: string,
    shortPrompt: string,
    sessionIds: number[],
    modelName: string | null,
    contextSize: number | null,
    strategyJson: string | null,
    initialStatus: AnalysisJob['status'] = 'pending'
  ): AnalysisJob => {
    try {
      const createdAt = Date.now();
      const newJobId = db.transaction(() => {
        // 1. Create the main job
        const jobInfo = run(
          insertJobSql,
          prompt,
          shortPrompt,
          initialStatus,
          createdAt,
          modelName,
          contextSize,
          strategyJson
        );
        const jobId = jobInfo.lastInsertRowid as number;

        // 2. Link sessions to the job
        const sessionStmt = db.prepare(insertJobSessionSql);
        for (const sessionId of sessionIds) {
          sessionStmt.run(jobId, sessionId);
        }

        // 3. Create pending intermediate summary tasks
        const summaryStmt = db.prepare(insertIntermediateSummarySql);
        for (const sessionId of sessionIds) {
          summaryStmt.run(jobId, sessionId, 'pending');
        }

        return jobId;
      })();

      const newJob = get<AnalysisJob>(selectJobByIdSql, newJobId);
      if (!newJob) {
        throw new Error('Failed to retrieve job immediately after creation.');
      }
      return newJob;
    } catch (error) {
      console.error('[AnalysisRepo] Error creating analysis job:', error);
      throw new Error('Database error while creating analysis job.');
    }
  },

  getJobById: (jobId: number): AnalysisJob | null => {
    try {
      const job = get<AnalysisJob>(selectJobByIdSql, jobId);
      return job ?? null;
    } catch (error) {
      console.error(`[AnalysisRepo] Error finding job by id ${jobId}:`, error);
      throw new Error('Database error fetching analysis job.');
    }
  },

  listJobs: (): AnalysisJob[] => {
    try {
      return all<AnalysisJob>(selectAllJobsSql);
    } catch (error) {
      console.error('[AnalysisRepo] Error listing all jobs:', error);
      throw new Error('Database error fetching analysis jobs.');
    }
  },

  updateJobStatus: (
    jobId: number,
    status: AnalysisJob['status'],
    result: string | null = null,
    errorMessage: string | null = null
  ): boolean => {
    try {
      const terminalStates: AnalysisJob['status'][] = [
        'completed',
        'failed',
        'canceled',
      ];
      const completedAt = terminalStates.includes(status) ? Date.now() : null;
      const info = run(
        updateJobStatusSql,
        status,
        errorMessage,
        result,
        completedAt,
        jobId
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error updating job ${jobId} status to ${status}:`,
        error
      );
      throw new Error('Database error updating job status.');
    }
  },

  updateJobShortPrompt: (jobId: number, shortPrompt: string): boolean => {
    try {
      const info = run(updateJobShortPromptSql, shortPrompt, jobId);
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error updating short prompt for job ${jobId}:`,
        error
      );
      throw new Error('Database error updating job short prompt.');
    }
  },

  updateJobStrategyAndSetPending: (
    jobId: number,
    strategyJson: string
  ): boolean => {
    try {
      const info = run(updateJobStrategyAndStatusSql, strategyJson, jobId);
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error updating strategy and status for job ${jobId}:`,
        error
      );
      throw new Error('Database error updating job strategy and status.');
    }
  },

  deleteJob: (jobId: number): boolean => {
    try {
      // ON DELETE CASCADE will handle analysis_job_sessions and intermediate_summaries
      const info = run(deleteJobSql, jobId);
      return info.changes > 0;
    } catch (error) {
      console.error(`[AnalysisRepo] Error deleting job ${jobId}:`, error);
      throw new Error('Database error deleting analysis job.');
    }
  },

  getPendingSummariesForJob: (jobId: number): IntermediateSummary[] => {
    try {
      return all<IntermediateSummary>(selectPendingSummariesByJobIdSql, jobId);
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error getting pending summaries for job ${jobId}:`,
        error
      );
      throw new Error('Database error fetching pending summaries.');
    }
  },

  getAllSummariesForJob: (jobId: number): IntermediateSummary[] => {
    try {
      return all<IntermediateSummary>(selectAllSummariesByJobIdSql, jobId);
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error getting all summaries for job ${jobId}:`,
        error
      );
      throw new Error('Database error fetching summaries.');
    }
  },

  findAllJobSessions: (): { analysis_job_id: number; session_id: number }[] => {
    try {
      return all<{ analysis_job_id: number; session_id: number }>(
        selectAllJobSessionsSql
      );
    } catch (error) {
      console.error('[AnalysisRepo] Error listing all job sessions:', error);
      throw new Error('Database error fetching analysis job sessions.');
    }
  },

  findAllIntermediateSummaries: (): IntermediateSummary[] => {
    try {
      return all<IntermediateSummary>(selectAllIntermediateSummariesSql);
    } catch (error) {
      console.error(
        '[AnalysisRepo] Error listing all intermediate summaries:',
        error
      );
      throw new Error('Database error fetching intermediate summaries.');
    }
  },

  updateIntermediateSummary: (
    summaryId: number,
    status: IntermediateSummary['status'],
    summaryText: string | null = null,
    errorMessage: string | null = null
  ): boolean => {
    try {
      const info = run(
        updateIntermediateSummarySql,
        summaryText,
        status,
        errorMessage,
        summaryId
      );
      return info.changes > 0;
    } catch (error) {
      console.error(
        `[AnalysisRepo] Error updating intermediate summary ${summaryId}:`,
        error
      );
      throw new Error('Database error updating intermediate summary.');
    }
  },
};
