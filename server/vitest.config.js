import { defineConfig } from 'vitest/config';

/**
 * Server test configuration.
 *
 * Three deliberate choices:
 *
 *   - `env.NODE_ENV = 'test'` is set before any module loads, because the
 *     environment module reads it once at import time to decide whether to use an
 *     in-memory database and to disable rate limiting.
 *   - `fileParallelism: false` — each test file starts its own in-memory MongoDB,
 *     and running several at once spends more time scheduling mongod processes
 *     than running assertions.
 *   - Generous hook timeouts, because the first run downloads a MongoDB binary
 *     (cached afterwards) and spinning up mongod is not instantaneous.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Each file's mongod is stopped by its own `afterAll`, so no teardown config
    // is needed here.
    reporters: ['default'],
  },
});
