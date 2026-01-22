import { Database } from 'better-sqlite3';
import type { z } from 'zod';
import {
  sessionSchema,
  messageSchema,
  transcriptSchema,
  chatSchema,
  analysisJobSchema,
  intermediateSummarySchema,
  templateSchema,
} from '@therascript/domain';

interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
}

interface TableSchema {
  name: string;
  columns: SchemaColumn[];
}

const getTableSchema = (db: Database, tableName: string): TableSchema => {
  const pragmaResult = db.pragma(`table_info(${tableName})`, {
    simple: false,
  }) as any[];
  const columns = pragmaResult.map((row: any) => ({
    name: row.name,
    type: row.type,
    nullable: row.notnull === 0,
  }));

  return {
    name: tableName,
    columns,
  };
};

const validateSchemaAgainstZod = (
  tableSchema: TableSchema,
  zodSchema: z.ZodSchema<any>,
  tableName: string
): { valid: boolean; warnings: string[] } => {
  const warnings: string[] = [];
  const dbColumns = tableSchema.columns.map((col) => col.name);

  const zodShape = (zodSchema as any)._def?.shape();
  if (!zodShape) {
    return { valid: false, warnings: ['Zod schema has no shape'] };
  }

  const zodFields = Object.keys(zodShape);

  // Check for missing columns
  for (const field of zodFields) {
    if (!dbColumns.includes(field)) {
      warnings.push(
        `Zod field '${field}' not found in database table '${tableName}'`
      );
    }
  }

  // Check for extra columns
  for (const col of dbColumns) {
    if (!zodFields.includes(col) && col !== 'id') {
      warnings.push(
        `Database column '${col}' not found in Zod schema for '${tableName}'`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
};

export const validateDatabaseSchema = (
  db: Database
): {
  valid: boolean;
  warnings: string[];
} => {
  const allWarnings: string[] = [];

  const tables = [
    { name: 'sessions', schema: sessionSchema },
    { name: 'messages', schema: messageSchema },
    { name: 'transcript_paragraphs', schema: transcriptSchema },
    { name: 'chats', schema: chatSchema },
    { name: 'analysis_jobs', schema: analysisJobSchema },
    { name: 'intermediate_summaries', schema: intermediateSummarySchema },
    { name: 'templates', schema: templateSchema },
  ];

  for (const table of tables) {
    try {
      const tableSchema = getTableSchema(db, table.name);
      const result = validateSchemaAgainstZod(
        tableSchema,
        table.schema,
        table.name
      );

      if (result.warnings.length > 0) {
        console.warn(
          `[Schema Validation] Warnings for table '${table.name}':`,
          result.warnings
        );
        allWarnings.push(...result.warnings);
      }
    } catch (error) {
      console.error(
        `[Schema Validation] Error validating table '${table.name}':`,
        error
      );
      allWarnings.push(`Failed to validate table '${table.name}': ${error}`);
    }
  }

  if (allWarnings.length > 0) {
    console.warn('[Schema Validation] Summary:', allWarnings);
  }

  return {
    valid: allWarnings.length === 0,
    warnings: allWarnings,
  };
};
