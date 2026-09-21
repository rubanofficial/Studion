/**
 * Shared validation primitives.
 *
 * Every schema in the app is built from these, so a rule like "an id is 24 hex
 * characters" or "a timestamp may arrive as ISO or epoch" is defined once and
 * cannot drift between routes.
 *
 * Schemas are `strict()` wherever the input is a body: an unexpected key means
 * the client and server disagree about the contract, and silently ignoring it
 * hides that bug until it becomes a data problem.
 */

import { z } from 'zod';

import { PRIORITIES, SESSION_STATUSES, TASK_STATUSES, isValidTimeZone, toMs } from '@focusforge/core';

/** MongoDB ObjectId as a string. */
export const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id.');

/** Accepts an ObjectId or the literal `null` to detach a reference. */
export const optionalRef = objectId.nullable().optional();

/**
 * A timestamp, accepted as ISO-8601 or epoch milliseconds and normalised to a
 * `Date`. Rejects anything unparseable rather than letting `Invalid Date`
 * propagate into the event log, where it would corrupt every derived duration.
 */
export const instant = z.preprocess((value) => {
  const ms = typeof value === 'string' || typeof value === 'number' || value instanceof Date ? toMs(value) : null;
  return ms === null ? value : new Date(ms);
}, z.date({ invalid_type_error: 'Not a valid timestamp.' }));

/** An IANA timezone name that the platform's `Intl` actually recognises. */
export const timeZone = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimeZone, 'Not a recognised timezone name.');

export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex value like #5eead4.');

/** Duration in seconds, bounded to a day. */
export const durationSeconds = z
  .number()
  .int('Durations must be whole seconds.')
  .min(0)
  .max(24 * 3600, 'A single block cannot exceed 24 hours.');

export const positiveDurationSeconds = z
  .number()
  .int()
  .min(60, 'A focus block must be at least a minute long.')
  .max(24 * 3600, 'A single block cannot exceed 24 hours.');

export const pagination = {
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
};

/** `?from=2026-03-01&to=2026-03-31` */
export const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates must look like 2026-03-02.');

export const dayKeyRange = z
  .object({ from: dayKey.optional(), to: dayKey.optional() })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must not be after the end date.',
    path: ['from'],
  });

export const periodKind = z.enum(['day', 'week', 'month', 'year']);
export const goalPeriod = z.enum(['daily', 'weekly', 'monthly']);
export const weekStart = z.union([z.coerce.number().int().min(0).max(6), z.enum(['sunday', 'monday'])]);

export const taskStatus = z.enum(/** @type {[string, ...string[]]} */ (TASK_STATUSES));
export const priority = z.enum(/** @type {[string, ...string[]]} */ (PRIORITIES));
export const sessionStatus = z.enum(/** @type {[string, ...string[]]} */ (SESSION_STATUSES));

/** Trimmed, length-bounded, non-empty text. */
export const shortText = (max) => z.string().trim().min(1, 'This cannot be empty.').max(max);

/**
 * A client-generated idempotency key.
 *
 * Constrained to a safe alphabet so it can be safely used in logs and index keys,
 * and bounded in length so a hostile client cannot bloat the index.
 */
export const clientId = z
  .string()
  .trim()
  .min(8, 'A client id must be at least 8 characters.')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Client ids may only contain letters, numbers, hyphens and underscores.');

/** Free-form device label from a fixed-ish set, tolerated if unknown. */
export const device = z.string().trim().max(40).default('unknown');

/**
 * Sortable update payloads must not be allowed to overwrite server-owned fields.
 * `strictObject` + explicit field lists in each schema already achieve this; this
 * helper documents the intent and gives a consistent error message.
 * @param {import('zod').ZodRawShape} shape
 */
export function strictBody(shape) {
  return z.object(shape).strict('This field is not accepted here.');
}

/**
 * Parses boolean query parameters safely without Javascript's `Boolean("false") === true` trap.
 */
export const booleanQuery = z.preprocess((val) => {
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
  }
  return val;
}, z.boolean());

