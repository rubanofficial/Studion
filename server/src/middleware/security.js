/**
 * Security middleware.
 *
 * Defence in depth, in the order requests meet it:
 *   helmet → CORS → body parsing → sanitisation → rate limiting → routes.
 */

import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Security headers.
 *
 * CSP is disabled because this process serves JSON only — the React app is built
 * and served separately, and shipping a restrictive CSP from an API is a common
 * source of confusing breakage with no security benefit here.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // The API is consumed cross-origin in development.
  crossOriginEmbedderPolicy: false,
});

/**
 * CORS.
 *
 * `credentials: true` is required because the refresh token travels in an
 * httpOnly cookie. That combination is only safe with an explicit origin
 * allow-list — `origin: true` with credentials would let any site make
 * authenticated requests on the user's behalf.
 */
export const corsMiddleware = cors({
  origin(origin, callback) {
    // Same-origin requests and non-browser clients (curl, tests) send no Origin.
    if (!origin) return callback(null, true);

    // Allow all Vercel deployments (*.vercel.app) automatically
    if (/^https:\/\/([a-zA-Z0-9_-]+\.)*vercel\.app$/.test(origin)) {
      return callback(null, true);
    }

    // Allow local development and preview ports
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    const isAllowed = env.corsOrigins.some((allowed) => {
      if (allowed === '*' || allowed === origin) return true;
      if (allowed.startsWith('*.') || allowed.startsWith('https://*.')) {
        const domain = allowed.replace(/^https?:\/\/\*\./, '');
        return origin.endsWith(`.${domain}`) || origin === `https://${domain}`;
      }
      return false;
    });
    if (isAllowed) return callback(null, true);
    return callback(ApiError.forbidden(`Origin ${origin} is not allowed to make authenticated requests.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
  maxAge: 86400,
});

/**
 * Strip MongoDB operators from user input.
 *
 * Zod schemas already reject unexpected keys, so this is a belt-and-braces layer
 * for any future route that forgets to validate. Implemented locally rather than
 * pulled from a package because the sanitisation rule is three lines and the
 * existing middleware packages have a history of being unmaintained.
 *
 * Note the deliberate decision to only walk plain objects: mutating prototypes or
 * class instances here would be a far bigger risk than the injection it prevents.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {unknown}
 */
function sanitise(value, depth = 0) {
  if (depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => sanitise(item, depth + 1));
  if (value === null || typeof value !== 'object') return value;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  /** @type {Record<string, unknown>} */
  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    // Keys starting with `$` are operators; a `.` enables path traversal into
    // nested documents. Neither can ever be a legitimate field name here.
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = sanitise(nested, depth + 1);
  }
  return clean;
}

/** @type {import('express').RequestHandler} */
export function mongoSanitize(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = sanitise(req.body);
  // `req.query` cannot be reassigned on Express 4 (prototype getter), so its
  // parsed value is stashed where services can prefer it.
  // @ts-expect-error augmenting the request
  req.sanitizedQuery = sanitise(req.query ?? {});
  next();
}

/**
 * @param {{windowMs: number, limit: number, message: string}} options
 */
function makeLimiter(options) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests share one process and would otherwise trip limits between cases.
    skip: () => env.isTest,
    handler: (_req, _res, next) => next(ApiError.tooManyRequests(options.message)),
  });
}

/** Broad limit for the whole API. Generous enough for a sync flush after offline. */
export const apiLimiter = makeLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  limit: env.RATE_LIMIT_MAX,
  message: 'You are sending requests very quickly. Please slow down for a moment.',
});

/**
 * Tight limit on credential endpoints only. Password guessing is the realistic
 * attack, and legitimate users hit these a handful of times a day at most.
 */
export const authLimiter = makeLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many sign-in attempts from this address. Please wait a few minutes and try again.',
});

/**
 * Liveness pings arrive once a minute per running session, so they get their own
 * generous bucket and never eat into the credential allowance.
 */
export const heartbeatLimiter = makeLimiter({
  windowMs: 60_000,
  limit: 240,
  message: 'Heartbeat rate exceeded.',
});
