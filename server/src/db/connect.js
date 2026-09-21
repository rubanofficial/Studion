/**
 * Database connection.
 *
 * Two modes, chosen by configuration rather than by branching inside services:
 *
 *   - **Real MongoDB** (Atlas or local) when `MONGODB_URI` is set. This is the
 *     only mode allowed in production.
 *   - **In-memory MongoDB** otherwise, in development and tests. This means a
 *     fresh clone runs with zero infrastructure, and the API is exercised
 *     against a real MongoDB engine rather than a mock — so index behaviour,
 *     upserts and aggregation semantics are all genuinely tested.
 *
 * No transactions are used anywhere in this codebase: they require a replica
 * set, and every write path here is designed to be idempotent instead (see
 * `services/sessionService.js`), which works on a standalone mongod too.
 */

import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** @type {import('mongodb-memory-server').MongoMemoryServer|null} */
let memoryServer = null;

mongoose.set('strictQuery', true);
// Surface genuinely broken queries during development instead of silently
// returning empty collections.
if (!env.isProduction) mongoose.set('debug', env.LOG_LEVEL === 'debug');

/**
 * @param {{uri?: string, dbName?: string}} [options]
 * @returns {Promise<{uri: string, dbName: string, memory: boolean}>}
 */
export async function connectDatabase(options = {}) {
  if (mongoose.connection.readyState === 1) {
    return { uri: mongoose.connection.name, dbName: mongoose.connection.name, memory: memoryServer !== null };
  }

  let uri = options.uri ?? (env.isTest ? undefined : env.MONGODB_URI);
  const dbName = options.dbName ?? env.MONGODB_DB_NAME;
  let memory = false;

  if (!uri) {
    if (env.isProduction) {
      throw new Error('connectDatabase: MONGODB_URI is required in production.');
    }
    // Imported lazily so the dependency never loads in production.
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { dbName } });
    uri = memoryServer.getUri();
    memory = true;
    logger.info('Started in-memory MongoDB', { uri: redact(uri) });
  }

  mongoose.connection.on('error', (error) => logger.error('MongoDB connection error', { error }));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(/** @type {string} */ (uri), {
    dbName,
    // Fail fast rather than letting a request hang for 30 seconds when the
    // database is unreachable.
    serverSelectionTimeoutMS: env.isTest ? 10_000 : 5_000,
    maxPoolSize: env.isTest ? 5 : 20,
    autoIndex: !env.isProduction,
  });

  if (env.isProduction) {
    // Build indexes explicitly in production instead of on every boot, so a
    // rolling deploy never triggers a surprise index build on a large collection.
    await syncIndexes();
  }

  logger.info('Connected to MongoDB', { db: mongoose.connection.name, memory });
  return { uri: /** @type {string} */ (uri), dbName, memory };
}

/**
 * Ensure every declared index exists and drop any that were removed from the
 * schemas. Called on boot in production and by the seed script.
 */
export async function syncIndexes() {
  const models = Object.values(mongoose.models);
  for (const model of models) {
    try {
      await model.syncIndexes();
    } catch (error) {
      logger.error('Failed to sync indexes', { model: model.modelName, error });
      throw error;
    }
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/**
 * Wipe every collection. Used by tests and `npm run seed:reset`.
 * Never callable in production.
 */
export async function clearDatabase() {
  if (env.isProduction) throw new Error('clearDatabase is not available in production.');
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
}

/** @returns {boolean} */
export function isConnected() {
  return mongoose.connection.readyState === 1;
}

/** @param {string} uri */
function redact(uri) {
  return uri.replace(/\/\/[^@]*@/, '//***:***@');
}
