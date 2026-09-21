/**
 * Express application.
 *
 * The middleware order here is the security model, so it is worth reading top to
 * bottom:
 *
 *   requestId      → every response and log line can be traced to one request
 *   helmet         → security headers before anything can respond
 *   cors           → an explicit origin allow-list, required because the refresh
 *                    cookie travels cross-origin in production
 *   compression    → JSON is highly compressible; analytics payloads are large
 *   body parsers   → bounded body size, so a huge payload cannot exhaust memory
 *   cookieParser   → the refresh cookie is the only cookie we read
 *   mongoSanitize  → strips `$`/`.` keys before validation sees them
 *   health         → mounted ahead of the limiter so probes are never throttled
 *   apiLimiter     → then the limiter, then the routes
 *   notFound       → a JSON 404 for unknown paths
 *   errorHandler   → one place decides what a client is told
 */

import { randomUUID } from 'node:crypto';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import Layer from 'express/lib/router/layer.js';

// Express 4 does not automatically catch rejections from async route handlers.
// Patching Layer.prototype.handle_request ensures all unhandled promise rejections
// in async controllers are routed to next(err) instead of hanging the request.
const originalHandleRequest = Layer.prototype.handle_request;
Layer.prototype.handle_request = function handle(req, res, next) {
  const fn = this.handle;
  if (fn.length > 3) {
    return originalHandleRequest.apply(this, arguments);
  }
  try {
    const result = fn.call(this, req, res, next);
    if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
      result.catch(next);
    }
  } catch (err) {
    next(err);
  }
};

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { corsMiddleware, mongoSanitize, securityHeaders, apiLimiter } from './middleware/security.js';
import { healthRouter } from './routes/index.js';
import routes from './routes/index.js';
import { sendData } from './utils/http.js';
import { logger } from './utils/logger.js';

/** @returns {import('express').Express} */
export function createApp() {
  const app = express();

  // Behind a proxy (Render, Railway, Fly, nginx) `req.ip` is only trustworthy
  // when Express is told to read the forwarded headers.
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(compression());

  // 256kb is far above the largest legitimate payload (a long offline event
  // batch) and far below anything that could be used to exhaust memory.
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(mongoSanitize);

  app.use('/api/health', healthRouter());
  app.use('/api', apiLimiter, routes);

  app.get('/', (_req, res) =>
    sendData(res, {
      name: 'FocusForge API',
      version: '1.0.0',
      documentation: '/api/capabilities',
      health: '/api/health',
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Attach a request id so a user can quote it and it can be found in the logs.
 * Honours an inbound `X-Request-Id` (so a trace can span services) but bounds its
 * length, since it ends up in log lines.
 * @type {import('express').RequestHandler}
 */
function requestId(req, res, next) {
  const inbound = req.get('x-request-id');
  const id = inbound && inbound.length <= 64 ? inbound : randomUUID();
  res.setHeader('X-Request-Id', id);
  // @ts-expect-error augmenting the request
  req.requestId = id;

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Errors are logged by the error handler with full context; successful
    // requests only need timing, and only at debug level.
    if (res.statusCode < 400) {
      logger.debug('request', {
        id,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(elapsedMs),
      });
    }
  });

  next();
}
