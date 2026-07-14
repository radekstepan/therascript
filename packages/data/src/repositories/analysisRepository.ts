import { db, run, all, get } from '@therascript/db';
import type { AnalysisJob, IntermediateSummary } from '@therascript/domain';

const insertJobSql = `
    INSERT INTO analysis_jobs (original_prompt, short_prompt, status, created_at, model_name, context_size, strategy_json, thinking_budget, temperature, top_p, repeat_penalty, num_gpu_layers, map_phase_system_prompt, llm_base_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

const insertJobSessionSql = `
    INSERT INTO analysis_job_sessions (analysis_job_id, session_id) 
    VALUES (?, ?)
`;
const selectAllJobSessionsSql = 'SELECT * FROM analysis_job_sessions';

const insertIntermediateSummarySql = `
    INSERT INTO intermediate_summaries (analysis_job_id, session_id, status) 
    VALUES (?, ?, ?)
`;
// Both summary queries return rows ordered by the underlying session's
// calendar date ascending, with `intermediate_summaries.id` as a stable
// tiebreaker for sessions sharing a date. This is the single source of
// truth for the "oldest → newest" guarantee that the analysis worker's
// reduce phase contracts with the LLM via the strategy prompt (see
// SYSTEM_PROMPT_TEMPLATES.ANALYSIS_STRATEGIST in @therascript/db).
// INNER JOIN is safe here because intermediate_summaries.session_id has
// ON DELETE CASCADE to sessions(id), so an orphan summary is impossible.
const selectPendingSummariesByJobIdSql = `
    SELECT intermediate_summaries.*
    FROM intermediate_summaries
    INNER JOIN sessions s ON s.id = intermediate_summaries.session_id
    WHERE intermediate_summaries.analysis_job_id = ?
      AND intermediate_summaries.status = 'pending'
    ORDER BY s.date ASC, intermediate_summaries.id ASC
`;
const selectAllSummariesByJobIdSql = `
    SELECT intermediate_summaries.*
    FROM intermediate_summaries
    INNER JOIN sessions s ON s.id = intermediate_summaries.session_id
    WHERE intermediate_summaries.analysis_job_id = ?
    ORDER BY s.date ASC, intermediate_summaries.id ASC
`;
const selectAllIntermediateSummariesSql =
  'SELECT * FROM intermediate_summaries';
const updateIntermediateSummarySql = `
    UPDATE intermediate_summaries 
    SET summary_text = ?, status = ?, error_message = ? 
    WHERE id = ?
`;

export const analysisRepository = {
  createJob: (
    prompt: string,
    shortPrompt: string,
    sessionIds: number[],
    modelName: string | null,
    contextSize: number | null,
    strategyJson: string | null,
    initialStatus: AnalysisJob['status'] = 'pending',
    llmParams: {
      thinkingBudget?: number | null;
      temperature?: number | null;
      topP?: number | null;
      repeatPenalty?: number | null;
      numGpuLayers?: number | null;
    } = {},
    mapPhaseSystemPrompt: string | null = null,
    llmBaseUrl: string | null = null
  ): AnalysisJob => {
    try {
      const createdAt = Date.now();
      const newJobId = db.transaction(() => {
        const jobInfo = run(
          insertJobSql,
          prompt,
          shortPrompt,
          initialStatus,
          createdAt,
          modelName,
          contextSize,
          strategyJson,
          llmParams.thinkingBudget ?? null,
          llmParams.temperature ?? null,
          llmParams.topP ?? null,
          llmParams.repeatPenalty ?? null,
          llmParams.numGpuLayers ?? null,
          mapPhaseSystemPrompt,
          llmBaseUrl
        );
        const jobId = jobInfo.lastInsertRowid as number;

        const sessionStmt = db.prepare(insertJobSessionSql);
        for (const sessionId of sessionIds) {
          sessionStmt.run(jobId, sessionId);
        }

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
