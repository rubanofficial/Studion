/**
 * Server entrypoint.
 *
 * Two responsibilities: start listening, and shut down without losing anything.
 *
 * Graceful shutdown matters more than it looks for a timer application. A deploy
 * that kills the process mid-request can drop a session the user just ended, and
 * the client would have to reconcile an unknown outcome. So we stop accepting new
 * connections, let in-flight requests finish, then close the database — with a
 * hard deadline so a stuck request cannot hang a deploy forever.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import { logger } from './utils/logger.js';

/**
 * @returns {Promise<import('http').Server>}
 */
export async function startServer() {
  const connection = await connectDatabase();
  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info('FocusForge API listening', {
      url: `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
      env: env.NODE_ENV,
      db: connection.memory ? 'in-memory' : 'mongodb',
    });
  });

  // Node's default keep-alive is 5s, which leaves a socket open across a
  // shutdown window. Shortening it means fewer connections to drain.
  server.keepAliveTimeout = 61_000;
  server.headersTimeout = 65_000;

  const shutdown = async (/** @type {string} */ signal) => {
    logger.info('Shutdown requested', { signal });

    const deadline = setTimeout(() => {
      logger.error('Forced exit after shutdown deadline');
      process.exit(1);
    }, 10_000);
    deadline.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error });
        process.exit(1);
      }
    });
  };

  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
    process.on(signal, () => void shutdown(signal));
  }

  process.on('unhandledRejection', (reason) => {
    // Log loudly but do not exit: a rejected promise in a request path is already
    // handled by the error middleware, and killing the process would take every
    // running timer's server-side state with it.
    logger.error('Unhandled promise rejection', { error: reason });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', { error });
    // An uncaught exception leaves the process in an unknown state; a clean exit
    // lets the platform restart it.
    void shutdown('uncaughtException');
  });

  return server;
}

// Only auto-start when executed directly, so tests can import and bootstrap
// themselves without a listener colliding on the port. Comparing resolved paths
// (rather than string-building a `file://` URL) is what makes this reliable on
// Windows, where drive letters and backslashes make URL comparison fragile.
const isDirectRun =
  typeof process.argv[1] === 'string' && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  startServer().catch((error) => {
    logger.error('Failed to start server', { error });
    process.exit(1);
  });
}
