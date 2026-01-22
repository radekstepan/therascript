import { z } from 'zod';
import { BadRequestError } from '../errors.js';
import type { SessionRow, ChatRow, MessageRow } from '@therascript/domain';

export function validateWithZod<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): T => {
    const result = schema.safeParse(data);
    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      console.error('[Validation Error]:', JSON.stringify(errors, null, 2));
      throw new BadRequestError(
        `Validation failed: ${errors[0]?.message || 'Invalid data'}`,
        { validationErrors: errors }
      );
    }
    return result.data;
  };
}

export function createTypedContext<
  TBody = unknown,
  TParams = unknown,
  TQuery = unknown,
>() {
  return {} as {
    body?: TBody;
    params?: TParams;
    query?: TQuery;
    set: { status?: number | string; headers?: Record<string, string> };
    signal?: AbortSignal;
    sessionData?: SessionRow;
    chatData?: ChatRow;
    messageData?: MessageRow;
  };
}
