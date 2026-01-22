import type { z } from 'zod';

export function queryWithValidation<T>(
  query: () => unknown[],
  schema: z.ZodSchema<T>
): T[] {
  const results = query();

  const validatedResults = results.map((row) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      console.error('[Query Validation Error]:', {
        row,
        errors: result.error.errors,
      });
      throw new Error(
        `Database row validation failed: ${result.error.errors.map((e) => e.message).join(', ')}`
      );
    }
    return result.data;
  });

  return validatedResults;
}

export function queryWithValidationSafe<T>(
  query: () => unknown[],
  schema: z.ZodSchema<T>
): { success: T[]; failed: { row: unknown; error: string }[] } {
  const results = query();

  const validated: T[] = [];
  const failed: { row: unknown; error: string }[] = [];

  for (const row of results) {
    const result = schema.safeParse(row);
    if (result.success) {
      validated.push(result.data);
    } else {
      failed.push({
        row,
        error: result.error.errors.map((e) => e.message).join(', '),
      });
    }
  }

  return { success: validated, failed };
}

export function queryWithValidationSingle<T>(
  query: () => unknown | null,
  schema: z.ZodSchema<T>
): T | null {
  const result = query();

  if (result === null) {
    return null;
  }

  const validationResult = schema.safeParse(result);
  if (!validationResult.success) {
    console.error('[Query Validation Error]:', {
      row: result,
      errors: validationResult.error.errors,
    });
    throw new Error(
      `Database row validation failed: ${validationResult.error.errors.map((e) => e.message).join(', ')}`
    );
  }

  return validationResult.data;
}
