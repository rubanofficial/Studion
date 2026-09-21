/**
 * Minimal structured logger.
 *
 * Deliberately dependency-free: the app needs levelled, single-line, greppable
 * output and nothing else. Production emits JSON so a log drain can index it;
 * development emits something a human can actually read.
 */

import { env } from '../config/env.js';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

const COLORS = { error: '\u001b[31m', warn: '\u001b[33m', info: '\u001b[36m', debug: '\u001b[90m', reset: '\u001b[0m' };

/**
 * @param {'error'|'warn'|'info'|'debug'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
function write(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const timestamp = new Date().toISOString();

  if (env.isProduction) {
    const payload = { level, time: timestamp, message, ...(meta ?? {}) };
    const line = JSON.stringify(payload, (_key, value) =>
      value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value,
    );
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
    return;
  }

  const colour = COLORS[level] ?? '';
  const suffix = meta && Object.keys(meta).length > 0 ? ` ${formatMeta(meta)}` : '';
  const stamp = timestamp.slice(11, 23);
  (level === 'error' ? process.stderr : process.stdout).write(
    `${COLORS.debug}${stamp}${COLORS.reset} ${colour}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${message}${suffix}\n`,
  );
}

/** @param {Record<string, unknown>} meta */
function formatMeta(meta) {
  return Object.entries(meta)
    .map(([key, value]) => {
      if (value instanceof Error) return `${key}=${value.name}(${value.message})`;
      if (typeof value === 'object' && value !== null) {
        try {
          return `${key}=${JSON.stringify(value)}`;
        } catch {
          return `${key}=[unserialisable]`;
        }
      }
      return `${key}=${String(value)}`;
    })
    .join(' ');
}

export const logger = {
  /** @param {string} message @param {Record<string, unknown>} [meta] */
  error: (message, meta) => write('error', message, meta),
  /** @param {string} message @param {Record<string, unknown>} [meta] */
  warn: (message, meta) => write('warn', message, meta),
  /** @param {string} message @param {Record<string, unknown>} [meta] */
  info: (message, meta) => write('info', message, meta),
  /** @param {string} message @param {Record<string, unknown>} [meta] */
  debug: (message, meta) => write('debug', message, meta),
};
