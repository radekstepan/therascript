/**
 * Base class for custom API errors.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly details?: string | Record<string, any>; // Allow structured details

  constructor(status: number, message: string, details?: string | Record<string, any>) {
      super(message);
      this.status = status;
      this.details = details;
      // Maintains proper stack trace
      if (Error.captureStackTrace) {
          Error.captureStackTrace(this, this.constructor);
      }
      this.name = this.constructor.name; // Set the error name
  }
}

/**
* Represents a 404 Not Found error.
*/
export class NotFoundError extends ApiError {
  constructor(resource: string = 'Resource', details?: string | Record<string, any>) {
      super(404, `${resource} not found.`, details);
  }
}

/**
* Represents a 400 Bad Request error.
* Often used for validation errors or invalid input.
*/
export class BadRequestError extends ApiError {
  constructor(message: string = 'Bad Request', details?: string | Record<string, any>) {
      super(400, message, details);
  }
}

/**
* Represents a 409 Conflict error.
* Often used for unique constraint violations or state conflicts.
*/
export class ConflictError extends ApiError {
  constructor(message: string = 'Conflict', details?: string | Record<string, any>) {
      super(409, message, details);
  }
}

/**
* Represents a 500 Internal Server Error.
* Used for unexpected server-side issues.
*/
export class InternalServerError extends ApiError {
  constructor(message: string = 'Internal Server Error', originalError?: Error) {
      // Optionally include original error details in non-production environments
      const details = process.env.NODE_ENV !== 'production' && originalError
          ? { originalMessage: originalError.message, stack: originalError.stack }
          : undefined;
      super(500, message, details);
  }
}
