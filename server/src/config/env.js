/**
 * Environment configuration.
 *
 * Everything is validated once, at boot, with explicit defaults where a default
 * is genuinely safe. Two rules are enforced here rather than scattered around
 * the codebase:
 *
 *   1. Secrets must be real in production. Booting production with a fallback
 *      JWT secret would silently mint forgeable tokens, so we refuse to start.
 *   2. In development, a missing database is not an error — the app falls back
 *      to an in-memory MongoDB (`USE_MEMORY_DB`). That keeps `npm run dev`
 *      working on a clean machine with no Atlas account and no local mongod.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(serverRoot, '..');

// `.env` at the server root wins; the repo root is checked as a convenience so
// a single top-level file works for the whole monorepo.
for (const candidate of [path.join(serverRoot, '.env'), path.join(repoRoot, '.env')]) {
  if (existsSync(candidate)) dotenv.config({ path: candidate });
}

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === 'true' || value === '1' || value === 'yes');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),

  MONGODB_URI: z.string().optional(),
  MONGODB_DB_NAME: z.string().default('focusforge'),
  /** Run against a throwaway in-memory MongoDB instead of a real server. */
  USE_MEMORY_DB: booleanish.default(false),

  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173'),
  COOKIE_SECURE: booleanish.optional(),
  COOKIE_DOMAIN: z.string().optional(),
  TRUST_PROXY: booleanish.default(false),

  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  LOG_LEVEL: z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info'),

  SEED_DEMO_DATA: booleanish.default(false),
  SEED_DEMO_EMAIL: z.string().default('demo@focusforge.app'),
  SEED_DEMO_PASSWORD: z.string().default('focusforge-demo'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';
const isTest = raw.NODE_ENV === 'test';

/**
 * Development-only fallback secret. Random per boot would log every developer
 * out on every file save, so it is derived deterministically instead — and it is
 * unreachable in production because of the guard below.
 */
function devSecret(name) {
  return `focusforge-dev-only-${name}-${'0'.repeat(24)}`;
}

if (isProduction) {
  const missing = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'].filter((key) => !raw[key]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production without: ${missing.join(', ')}. ` +
        'Set them in the environment — generated fallbacks would produce forgeable tokens or an unusable database.',
    );
  }
}

const useMemoryDb = raw.USE_MEMORY_DB || (isTest ? true : !raw.MONGODB_URI && !isProduction);

export const env = Object.freeze({
  ...raw,
  isProduction,
  isTest,
  isDevelopment: raw.NODE_ENV === 'development',
  useMemoryDb,
  accessSecret: raw.JWT_ACCESS_SECRET || devSecret('access'),
  refreshSecret: raw.JWT_REFRESH_SECRET || devSecret('refresh'),
  /** Cookies must be SameSite=None in cross-site production, which requires Secure. */
  cookieSecure: raw.COOKIE_SECURE ?? isProduction,
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
});

/** A random hex string, used by the seed script and for one-off test fixtures. */
export function randomHex(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

if (useMemoryDb && !isTest) {
  // eslint-disable-next-line no-console
  console.warn(
    '[focusforge] MONGODB_URI is not set — starting an in-memory MongoDB. ' +
      'Data will be lost when the process exits. Set MONGODB_URI for durable storage.',
  );
}
