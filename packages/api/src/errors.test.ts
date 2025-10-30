import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  NotFoundError,
  BadRequestError,
  ConflictError,
  InternalServerError,
} from './errors.ts';

describe('errors', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('NotFoundError has status 404 and message', () => {
    const e = new NotFoundError('Thing');
    expect(e.status).toBe(404);
    expect(e.message).toBe('Thing not found.');
  });

  it('BadRequestError and ConflictError carry provided messages', () => {
    const b = new BadRequestError('Nope');
    const c = new ConflictError('Conflict here');
    expect(b.status).toBe(400);
    expect(b.message).toBe('Nope');
    expect(c.status).toBe(409);
    expect(c.message).toBe('Conflict here');
  });

  it('InternalServerError includes original error details in non-production', () => {
    process.env.NODE_ENV = 'development';
    const orig = new Error('db exploded');
    const e = new InternalServerError('Oops', orig);
    expect(e.status).toBe(500);
    expect(e.details && typeof e.details === 'object').toBe(true);
  });

  it('InternalServerError hides details in production', () => {
    process.env.NODE_ENV = 'production';
    const orig = new Error('db exploded');
    const e = new InternalServerError('Oops', orig);
    expect(e.details).toBeUndefined();
  });
});
