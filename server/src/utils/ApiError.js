/**
 * Errors that are safe to show a user.
 *
 * The contract is: anything thrown as an `ApiError` has a stable machine code, a
 * human message, an HTTP status, and optional field-level detail. Anything else
 * that reaches the handler is a bug, and is reported as a generic 500 with the
 * real cause logged server-side only — never leaked to the client.
 */

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code stable machine-readable code, e.g. `SESSION_ALREADY_OPEN`
   * @param {string} message sentence written for a user to read
   * @param {{details?: unknown, cause?: unknown, retryable?: boolean}} [options]
   */
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.retryable = options.retryable ?? status >= 500;
    if (options.cause !== undefined) this.cause = options.cause;
    Error.captureStackTrace?.(this, ApiError);
  }

  /** @param {string} [message] @param {unknown} [details] */
  static badRequest(message = 'That request could not be understood.', details) {
    return new ApiError(400, 'BAD_REQUEST', message, { details, retryable: false });
  }

  /** @param {unknown} [details] */
  static validation(message = 'Some of the values sent were not valid.', details) {
    return new ApiError(422, 'VALIDATION_ERROR', message, { details, retryable: false });
  }

  /** @param {string} [message] */
  static unauthorized(message = 'You need to sign in to do that.') {
    return new ApiError(401, 'UNAUTHORIZED', message, { retryable: false });
  }

  /** @param {string} [message] */
  static forbidden(message = 'You do not have access to that.') {
    return new ApiError(403, 'FORBIDDEN', message, { retryable: false });
  }

  /** @param {string} [message] @param {unknown} [details] */
  static notFound(message = 'That resource does not exist.', details) {
    return new ApiError(404, 'NOT_FOUND', message, { details, retryable: false });
  }

  /**
   * A conflict the client can resolve, so `details` normally carries the current
   * server state (for example the session that is already open).
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  static conflict(code, message, details) {
    return new ApiError(409, code, message, { details, retryable: false });
  }

  /** @param {string} [message] */
  static tooManyRequests(message = 'Too many attempts. Please wait a moment and try again.') {
    return new ApiError(429, 'RATE_LIMITED', message, { retryable: true });
  }

  /** @param {string} [message] @param {unknown} [cause] */
  static internal(message = 'Something went wrong on our side.', cause) {
    return new ApiError(500, 'INTERNAL_ERROR', message, { cause, retryable: true });
  }

  /** @param {string} [message] @param {unknown} [cause] */
  static serviceUnavailable(message = 'The service is temporarily unavailable.', cause) {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message, { cause, retryable: true });
  }

  /**
   * Serialise for the wire. `details` is omitted rather than sent as null so the
   * client can distinguish "no detail" from "explicitly empty".
   * @returns {{error: {code: string, message: string, retryable: boolean, details?: unknown}}}
   */
  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

/** @param {unknown} value @returns {value is ApiError} */
export function isApiError(value) {
  return value instanceof ApiError;
}
