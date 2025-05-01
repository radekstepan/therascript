/**
 * Base class for custom API errors used throughout the application.
 * Allows consistent error handling and setting specific HTTP status codes.
 */
export class ApiError extends Error {
  public readonly status: number; // HTTP status code associated with the error
  public readonly details?: string | Record<string, any>; // Optional additional details (string or structured object)

  /**
   * Creates an instance of ApiError.
   * @param status The HTTP status code (e.g., 404, 400, 500).
   * @param message A human-readable error message.
   * @param details Optional details providing more context about the error.
   */
  constructor(
    status: number,
    message: string,
    details?: string | Record<string, any>
  ) {
    super(message); // Call the parent Error constructor
    this.status = status;
    this.details = details;

    // Maintains proper stack trace in V8 environments (like Node.js)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set the error name to the class name for easier identification
    this.name = this.constructor.name;
  }
}

/**
 * Represents a 404 Not Found error.
 * Used when a requested resource (e.g., session, chat, message) cannot be found.
 */
export class NotFoundError extends ApiError {
  /**
   * Creates an instance of NotFoundError.
   * @param resource A description of the resource that was not found (defaults to 'Resource').
   * @param details Optional additional details.
   */
  constructor(
    resource: string = 'Resource',
    details?: string | Record<string, any>
  ) {
    super(404, `${resource} not found.`, details);
  }
}

/**
 * Represents a 400 Bad Request error.
 * Used for client-side errors like invalid input, missing parameters, or validation failures.
 */
export class BadRequestError extends ApiError {
  /**
   * Creates an instance of BadRequestError.
   * @param message A specific message describing the bad request (defaults to 'Bad Request').
   * @param details Optional additional details, often used for validation error specifics.
   */
  constructor(
    message: string = 'Bad Request',
    details?: string | Record<string, any>
  ) {
    super(400, message, details);
  }
}

/**
 * Represents a 409 Conflict error.
 * Used when a request cannot be completed due to a conflict with the current state of the target resource.
 * Examples: trying to create a resource that already exists (unique constraint), or performing an action on a resource in an invalid state.
 */
export class ConflictError extends ApiError {
  /**
   * Creates an instance of ConflictError.
   * @param message A specific message describing the conflict (defaults to 'Conflict').
   * @param details Optional additional details.
   */
  constructor(
    message: string = 'Conflict',
    details?: string | Record<string, any>
  ) {
    super(409, message, details);
  }
}

/**
 * Represents a 500 Internal Server Error.
 * Used for unexpected server-side issues where the server cannot fulfill a valid request.
 * Avoid exposing sensitive details in production environments.
 */
export class InternalServerError extends ApiError {
  /**
   * Creates an instance of InternalServerError.
   * @param message A generic message for the client (defaults to 'Internal Server Error').
   * @param originalError Optional original Error object that caused this server error.
   *                      Its details (message, stack) are only included in the response
   *                      if `NODE_ENV` is not 'production'.
   */
  constructor(
    message: string = 'Internal Server Error',
    originalError?: Error
  ) {
    // Conditionally include original error details in non-production environments for debugging
    const details =
      process.env.NODE_ENV !== 'production' && originalError
        ? { originalMessage: originalError.message, stack: originalError.stack }
        : undefined;
    super(500, message, details);
  }
}
