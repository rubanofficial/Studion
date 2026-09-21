/**
 * Central error handling.
 *
 * One place decides what a client is told. The rules:
 *   - Anything thrown as an `ApiError` is safe and is passed through verbatim.
 *   - A known library failure (bad ObjectId, duplicate key, JWT expiry) is
 *     translated into an `ApiError` with a message a user can act on, rather than
 *     leaking driver internals.
 *   - Anything else is a bug: the client gets a generic 500 with a request id,
 *     and the real error goes to the log. Stack traces are never serialised to
 *     the response, in any environment.
 */

import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { env } from '../config/env.js';
import { ApiError, isApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/** @type {import('express').RequestHandler} */
export function notFoundHandler(req, _res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.originalUrl}.`));
}

/**
 * Map a thrown value onto an ApiError.
 * @param {unknown} error
 * @returns {ApiError}
 */
function normalise(error) {
  if (isApiError(error)) return /** @type {ApiError} */ (error);

  if (error instanceof ZodError) {
    return ApiError.validation(
      'Some of the values sent were not valid.',
      error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message })),
    );
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.validation(
      'That record could not be saved because some fields were invalid.',
      Object.values(error.errors).map((fieldError) => ({
        field: /** @type {any} */ (fieldError).path,
        message: /** @type {any} */ (fieldError).message,
      })),
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(`"${String(/** @type {any} */ (error).value)}" is not a valid id.`);
  }

  const mongoCode = /** @type {any} */ (error)?.code;

  if (mongoCode === 11000) {
    const fields = Object.keys(/** @type {any} */ (error).keyPattern ?? {});
    const onEmail = fields.includes('email');
    return new ApiError(
      409,
      'DUPLICATE',
      onEmail
        ? 'An account with that email address already exists.'
        : 'A record with those details already exists.',
      { details: { fields }, retryable: false },
    );
  }

  if (error instanceof SyntaxError && 'body' in /** @type {any} */ (error)) {
    return ApiError.badRequest('The request body was not valid JSON.');
  }

  const message = /** @type {Error} */ (error)?.message ?? '';
  if (message.includes('buffering timed out') || message.includes('topology was destroyed')) {
    return ApiError.serviceUnavailable('The database is not reachable right now. Your timer is unaffected — try again shortly.');
  }

  if (/** @type {any} */ (error)?.name === 'TokenExpiredError') {
    return ApiError.unauthorized('Your session expired. Please sign in again.');
  }
  if (/** @type {any} */ (error)?.name === 'JsonWebTokenError') {
    return ApiError.unauthorized('That token is not valid.');
  }

  return ApiError.internal('Something went wrong on our side. The problem has been logged.', error);
}

/** @type {import('express').ErrorRequestHandler} */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  const apiError = normalise(error);

  if (apiError.status >= 500) {
    logger.error('Unhandled request failure', { method: req.method, url: req.originalUrl, error });
  } else if (apiError.status === 429) {
    logger.warn('Rate limited', { method: req.method, url: req.originalUrl, ip: req.ip });
  } else {
    logger.debug('Request rejected', { method: req.method, url: req.originalUrl, code: apiError.code });
  }

  const payload = apiError.toJSON();
  // A request id makes a user-reported problem findable in the logs without
  // exposing anything about the failure itself.
  if (apiError.status >= 500 && !env.isProduction) {
    payload.error.details = { cause: /** @type {Error} */ (error)?.stack ?? String(error) };
  }

  res.status(apiError.status).json(payload);
}
