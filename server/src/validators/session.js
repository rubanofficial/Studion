/**
 * Focus session schemas.
 *
 * The client never sends durations. It sends *events with timestamps* and the
 * server derives every duration from them. That is the single most important
 * contract in the API: it is what stops a broken clock, a paused tab, or a
 * malicious client from writing fiction into the analytics.
 *
 * The one duration that is accepted from the client is `plannedDuration` — an
 * intention, not a measurement, so it cannot be derived from anything.
 */

import { z } from 'zod';

import { DISTRACTION_KINDS, EVENT_TYPES, SESSION_KINDS } from '@focusforge/core';

import { clientId, device, instant, optionalRef, positiveDurationSeconds, strictBody, timeZone } from './common.js';

/**
 * `at` is required and must be an absolute instant. Offline clients are expected
 * to have recorded these locally; a client that has lost its clock is expected to
 * send `null` rather than guess.
 */
export const sessionEvent = z
  .object({
    type: z.enum(/** @type {[string, ...string[]]} */ (EVENT_TYPES)),
    at: instant,
    kind: z.enum(/** @type {[string, ...string[]]} */ (DISTRACTION_KINDS)).nullable().optional(),
  })
  .strict('An event may only contain type, at and kind.');

/**
 * Bounded so one request cannot be used to write an unbounded document. A four
 * hour session with a heartbeat every minute is ~245 events, so 1000 leaves
 * ample headroom for a long offline batch.
 */
export const eventBatch = z.array(sessionEvent).min(1).max(1000);

export const startSessionSchema = strictBody({
  clientId,
  subjectId: optionalRef,
  taskId: optionalRef,
  kind: z.enum(/** @type {[string, ...string[]]} */ (SESSION_KINDS)).default('focus'),
  plannedDuration: positiveDurationSeconds,
  timeZone: timeZone.default('UTC'),
  device,
  /**
   * When the client recorded the start. Normally now; supplied explicitly so an
   * offline client that reconnects can post a session that began hours ago,
   * instead of having it silently re-dated to the sync time.
   */
  startTime: instant.optional(),
});

export const appendEventsSchema = strictBody({
  events: eventBatch,
});

export const heartbeatSchema = strictBody({
  at: instant.optional(),
});

export const distractionSchema = strictBody({
  kind: z.enum(/** @type {[string, ...string[]]} */ (DISTRACTION_KINDS)),
  at: instant.optional(),
  /** Optional free text when `kind` is `other`. */
  note: z.string().trim().max(200).nullable().optional(),
});

export const extendSessionSchema = strictBody({
  /** Minutes to add to the planned duration, bounded to prevent runaway timers. */
  minutes: z.number().int().min(1).max(240),
});

export const closeSessionSchema = strictBody({
  /**
   * `completed` — the user finished the block.
   * `cancelled`  — the user deliberately stopped short.
   * `interrupted` — something else ended it (idle guard, crash recovery).
   * Omitted means "decide for me": completed if the plan was met, cancelled if not.
   */
  status: z.enum(['completed', 'cancelled', 'interrupted']).optional(),
  /** Final flush of events, so ending offline and syncing later loses nothing. */
  events: z.array(sessionEvent).max(1000).optional(),
  endedAt: instant.optional(),
  interruptedReason: z.string().trim().max(60).nullable().optional(),
  reflection: z.string().trim().max(1000).nullable().optional(),
});

export const updateSessionSchema = strictBody({
  subjectId: optionalRef,
  taskId: optionalRef,
  reflection: z.string().trim().max(1000).nullable().optional(),
});

export const listSessionsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    subjectId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/).optional(),
    taskId: z.string().trim().regex(/^[0-9a-fA-F]{24}$/).optional(),
    status: z.enum(['running', 'paused', 'completed', 'cancelled', 'interrupted']).optional(),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
  })
  .strict();
