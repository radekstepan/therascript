import { db, type DbStatement, type DbRunResult } from '@therascript/db';

export interface UsageLog {
  id: number;
  type: 'llm' | 'whisper';
  source: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  duration: number | null;
  timestamp: number;
}

export interface InsertUsageLogParams {
  type: 'llm' | 'whisper';
  source: string;
  model: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  duration?: number | null;
  timestamp?: number;
}

export interface UsageLogsQuery {
  start?: number;
  end?: number;
  limit?: number;
  offset?: number;
  type?: 'llm' | 'whisper';
  model?: string;
  source?: string;
}

export interface UsageLogsResult {
  items: UsageLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface WeeklyAggregate {
  weekStart: number;
  weekEnd: number;
  llm: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    callCount: number;
  };
  whisper: {
    totalDuration: number;
    callCount: number;
  };
}

export interface WeeklyAggregateByModel {
  weekStart: number;
  weekEnd: number;
  type: 'llm' | 'whisper';
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalDuration: number;
  callCount: number;
}

export interface UsageTotals {
  llm: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    callCount: number;
    callsByModel: Record<string, number>;
    callsBySource: Record<string, number>;
  };
  whisper: {
    totalDuration: number;
    callCount: number;
    callsByModel: Record<string, number>;
  };
}

export interface UsageTotalsByModel {
  type: 'llm' | 'whisper';
  model: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalDuration: number;
  callCount: number;
}

let _insertUsageLogStmt: DbStatement | null = null;
const insertUsageLogStmt = (): DbStatement => {
  if (!_insertUsageLogStmt) {
    _insertUsageLogStmt = db.prepare(
      'INSERT INTO usage_logs (type, source, model, promptTokens, completionTokens, duration, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
  }
  return _insertUsageLogStmt;
};

let _getUsageLogsCountStmt: DbStatement | null = null;
const getUsageLogsCountStmt = (): DbStatement => {
  if (!_getUsageLogsCountStmt) {
    _getUsageLogsCountStmt = db.prepare(
      'SELECT COUNT(*) as count FROM usage_logs'
    );
  }
  return _getUsageLogsCountStmt;
};

export const usageRepository = {
  insertUsageLog: (params: InsertUsageLogParams): void => {
    try {
      const timestamp = params.timestamp ?? Date.now();
      const info: DbRunResult = insertUsageLogStmt().run(
        params.type,
        params.source,
        params.model,
        params.promptTokens ?? null,
        params.completionTokens ?? null,
        params.duration ?? null,
        timestamp
      );
      console.log(
        `[UsageRepo] Inserted usage log: ${params.type}/${params.source}, id: ${info.lastInsertRowid}`
      );
    } catch (error) {
      console.warn(`[UsageRepo] Failed to insert usage log: ${error}`);
    }
  },

  getUsageLogs: (query: UsageLogsQuery = {}): UsageLogsResult => {
    try {
      const { start, end, limit = 50, offset = 0, type, model, source } = query;

      const conditions: string[] = [];
      const params: any[] = [];

      if (start !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(start);
      }
      if (end !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(end);
      }
      if (type !== undefined) {
        conditions.push('type = ?');
        params.push(type);
      }
      if (model !== undefined) {
        conditions.push('model = ?');
        params.push(model);
      }
      if (source !== undefined) {
        conditions.push('source = ?');
        params.push(source);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countSql = `SELECT COUNT(*) as count FROM usage_logs ${whereClause}`;
      const countStmt = db.prepare(countSql);
      const { count } = countStmt.get(...params) as { count: number };

      const dataSql = `SELECT id, type, source, model, promptTokens, completionTokens, duration, timestamp FROM usage_logs ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
      const dataStmt = db.prepare(dataSql);
      const items = dataStmt.all(...params, limit, offset) as UsageLog[];

      return {
        items,
        total: count,
        limit,
        offset,
      };
    } catch (error) {
      console.error(`[UsageRepo] Error fetching usage logs: ${error}`);
      throw new Error(`DB error fetching usage logs: ${error}`);
    }
  },

  getWeeklyAggregates: (
    query: { start?: number; end?: number; groupByModel?: boolean } = {}
  ): WeeklyAggregateByModel[] | WeeklyAggregate[] => {
    try {
      const { start, end, groupByModel = false } = query;

      const conditions: string[] = [];
      const params: any[] = [];

      if (start !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(start);
      }
      if (end !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(end);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const modelSelect = groupByModel ? ', model' : '';
      const modelGroupBy = groupByModel ? ', model' : '';

      const mondayEpochOffset = 345600000;

      const sql = `
        SELECT
          ((timestamp - ${mondayEpochOffset}) / 604800000) * 604800000 + ${mondayEpochOffset} as weekStart,
          ((timestamp - ${mondayEpochOffset}) / 604800000) * 604800000 + ${mondayEpochOffset} + 604799999 as weekEnd,
          type${modelSelect},
          SUM(CASE WHEN type = 'llm' THEN COALESCE(promptTokens, 0) ELSE 0 END) as totalPromptTokens,
          SUM(CASE WHEN type = 'llm' THEN COALESCE(completionTokens, 0) ELSE 0 END) as totalCompletionTokens,
          SUM(CASE WHEN type = 'whisper' THEN COALESCE(duration, 0) ELSE 0 END) as totalDuration,
          COUNT(*) as callCount
        FROM usage_logs
        ${whereClause}
        GROUP BY weekStart, type${modelGroupBy}
        ORDER BY weekStart ASC${groupByModel ? ', type, model' : ''}
      `;

      const rows = db.prepare(sql).all(...params) as Array<{
        weekStart: number;
        weekEnd: number;
        type: 'llm' | 'whisper';
        model?: string;
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalDuration: number;
        callCount: number;
      }>;

      if (groupByModel) {
        return rows as WeeklyAggregateByModel[];
      }

      const weekMap = new Map<number, WeeklyAggregate>();

      for (const row of rows) {
        if (!weekMap.has(row.weekStart)) {
          weekMap.set(row.weekStart, {
            weekStart: row.weekStart,
            weekEnd: row.weekEnd,
            llm: {
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              callCount: 0,
            },
            whisper: {
              totalDuration: 0,
              callCount: 0,
            },
          });
        }

        const aggregate = weekMap.get(row.weekStart)!;
        if (row.type === 'llm') {
          aggregate.llm.totalPromptTokens += row.totalPromptTokens;
          aggregate.llm.totalCompletionTokens += row.totalCompletionTokens;
          aggregate.llm.callCount += row.callCount;
        } else {
          aggregate.whisper.totalDuration += row.totalDuration;
          aggregate.whisper.callCount += row.callCount;
        }
      }

      return Array.from(weekMap.values()).sort(
        (a, b) => a.weekStart - b.weekStart
      );
    } catch (error) {
      console.error(`[UsageRepo] Error fetching weekly aggregates: ${error}`);
      throw new Error(`DB error fetching weekly aggregates: ${error}`);
    }
  },

  getTotals: (
    query: { start?: number; end?: number; groupByModel?: boolean } = {}
  ): UsageTotalsByModel[] | UsageTotals => {
    try {
      const { start, end, groupByModel = false } = query;

      const conditions: string[] = [];
      const params: any[] = [];

      if (start !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(start);
      }
      if (end !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(end);
      }

      if (groupByModel) {
        const whereClause =
          conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const sql = `
          SELECT
            type,
            model,
            SUM(CASE WHEN type = 'llm' THEN COALESCE(promptTokens, 0) ELSE 0 END) as totalPromptTokens,
            SUM(CASE WHEN type = 'llm' THEN COALESCE(completionTokens, 0) ELSE 0 END) as totalCompletionTokens,
            SUM(CASE WHEN type = 'whisper' THEN COALESCE(duration, 0) ELSE 0 END) as totalDuration,
            COUNT(*) as callCount
          FROM usage_logs
          ${whereClause}
          GROUP BY type, model
          ORDER BY type, model
        `;

        const rows = db.prepare(sql).all(...params) as Array<{
          type: 'llm' | 'whisper';
          model: string;
          totalPromptTokens: number;
          totalCompletionTokens: number;
          totalDuration: number;
          callCount: number;
        }>;

        return rows as UsageTotalsByModel[];
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const llmWhereClause = whereClause
        ? `${whereClause} AND type = 'llm'`
        : "WHERE type = 'llm'";
      const whisperWhereClause = whereClause
        ? `${whereClause} AND type = 'whisper'`
        : "WHERE type = 'whisper'";

      const llmSql = `
        SELECT
          SUM(COALESCE(promptTokens, 0)) as totalPromptTokens,
          SUM(COALESCE(completionTokens, 0)) as totalCompletionTokens,
          COUNT(*) as callCount
        FROM usage_logs
        ${llmWhereClause}
      `;

      const llmResult = db.prepare(llmSql).get(...params) as {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        callCount: number;
      };

      const llmByModelSql = `
        SELECT model, COUNT(*) as count
        FROM usage_logs
        ${llmWhereClause}
        GROUP BY model
      `;

      const llmByModelRows = db.prepare(llmByModelSql).all(...params) as Array<{
        model: string;
        count: number;
      }>;

      const llmBySourceSql = `
        SELECT source, COUNT(*) as count
        FROM usage_logs
        ${llmWhereClause}
        GROUP BY source
      `;

      const llmBySourceRows = db
        .prepare(llmBySourceSql)
        .all(...params) as Array<{
        source: string;
        count: number;
      }>;

      const whisperSql = `
        SELECT
          SUM(COALESCE(duration, 0)) as totalDuration,
          COUNT(*) as callCount
        FROM usage_logs
        ${whisperWhereClause}
      `;

      const whisperResult = db.prepare(whisperSql).get(...params) as {
        totalDuration: number;
        callCount: number;
      };

      const whisperByModelSql = `
        SELECT model, COUNT(*) as count
        FROM usage_logs
        ${whisperWhereClause}
        GROUP BY model
      `;

      const whisperByModelRows = db
        .prepare(whisperByModelSql)
        .all(...params) as Array<{
        model: string;
        count: number;
      }>;

      const llmCallsByModel: Record<string, number> = {};
      for (const row of llmByModelRows) {
        llmCallsByModel[row.model] = row.count;
      }

      const llmCallsBySource: Record<string, number> = {};
      for (const row of llmBySourceRows) {
        llmCallsBySource[row.source] = row.count;
      }

      const whisperCallsByModel: Record<string, number> = {};
      for (const row of whisperByModelRows) {
        whisperCallsByModel[row.model] = row.count;
      }

      return {
        llm: {
          totalPromptTokens: llmResult.totalPromptTokens ?? 0,
          totalCompletionTokens: llmResult.totalCompletionTokens ?? 0,
          callCount: llmResult.callCount ?? 0,
          callsByModel: llmCallsByModel,
          callsBySource: llmCallsBySource,
        },
        whisper: {
          totalDuration: whisperResult.totalDuration ?? 0,
          callCount: whisperResult.callCount ?? 0,
          callsByModel: whisperCallsByModel,
        },
      };
    } catch (error) {
      console.error(`[UsageRepo] Error fetching totals: ${error}`);
      throw new Error(`DB error fetching totals: ${error}`);
    }
  },
};
