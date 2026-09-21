/**
 * Focus session service — the heart of the API.
 *
 * Every rule that makes the timer trustworthy lives here:
 *
 *   **The server is the authority.** Controllers accept *events with timestamps*;
 *   durations are always folded from that log by `@focusforge/core`. A client
 *   cannot report that it focused for two hours, only that it observed two hours
 *   of wall time with liveness evidence.
 *
 *   **Everything is idempotent.** Each session carries a device-generated
 *   `clientId`, enforced unique per user at the database level. An offline queue
 *   can therefore be flushed twice — after a reconnect, a retry, or a
 *   service-worker replay — and the outcome is identical.
 *
 *   **Cross-device is adoption, not duplication.** Starting on device B while
 *   device A holds an open session adopts A's session rather than opening a
 *   second one, which is what "the timer survives device switching" has to mean
 *   in practice. A session that has gone silent for long enough to be abandoned
 *   is closed first, so a truly dead tab can never block the user.
 *
 *   **Rollups follow every write.** Any change to history rebuilds the affected
 *   days from sessions, so caches are always a pure function of the record.
 */

import {
  EVENT,
  HEARTBEAT_INTERVAL_MS,
  IDLE_GAP_MS,
  SESSION_STATUS,
  dayKey,
} from '@focusforge/core';

import { FocusSession } from '../models/FocusSession.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

import { toPublicSession, toSessionRecord } from './sessionMapper.js';
import { affectedDayKeys, recomputeDays } from './statsService.js';
import * as settingsService from './settingsService.js';
import * as taskService from './taskService.js';
import { nameAndColorMap, resolveOwnedSubjectId } from './subjectService.js';
import { assertFound } from './support.js';

/**
 * How long a session may go without evidence of life before it is treated as
 * abandoned and closed.
 *
 * Comfortably above the worst browser timer throttle (one tick per five minutes)
 * so a backgrounded tab is never mistaken for a dead one, and short enough that a
 * crashed tab does not leave the user unable to start a new session.
 */
export const STALE_OPEN_MS = 10 * 60_000;

/** Statuses that mean "still live on some device". */
const OPEN = [SESSION_STATUS.RUNNING, SESSION_STATUS.PAUSED];

/** @param {any} userId @param {any} sessionId */
async function loadOwned(userId, sessionId) {
  return assertFound(await FocusSession.findOne({ _id: sessionId, user: userId }), 'Session');
}

/** @param {any} userId */
export async function findOpenSession(userId) {
  return FocusSession.findOne({ user: userId, status: { $in: OPEN } }).sort({ startTime: -1 });
}

/**
 * The most recent moment we have proof the client was alive.
 * @param {any} session
 * @returns {Date}
 */
function lastEvidenceAt(session) {
  if (session.lastHeartbeatAt) return new Date(session.lastHeartbeatAt);
  const events = session.events ?? [];
  if (events.length > 0) return new Date(events[events.length - 1].at);
  return new Date(session.startTime);
}

/**
 * Close an abandoned session at the last moment we know the user was present.
 *
 * Ending at the last heartbeat rather than at "now" is the honest choice: the
 * wall-clock time after that is unattested, and billing it as focus would be
 * exactly the fiction the whole design exists to prevent.
 *
 * @param {any} userId
 * @param {{timeZone: string, successThresholdSeconds: number}} rollupContext
 * @returns {Promise<any|null>} the closed session, or null if nothing was stale
 */
export async function reconcileStaleSession(userId, rollupContext) {
  const open = await findOpenSession(userId);
  if (!open) return null;

  const evidence = lastEvidenceAt(open);
  const silentForMs = Date.now() - evidence.getTime();
  if (silentForMs <= STALE_OPEN_MS) return null;

  const focused = open.focusedSeconds ?? 0;
  const planned = open.plannedDuration ?? 0;
  const status = focused >= 60 && planned > 0 && focused >= planned * 0.9 ? SESSION_STATUS.COMPLETED : SESSION_STATUS.INTERRUPTED;

  open.appendEvents([{ type: EVENT.END, at: evidence }]);
  open.endTime = evidence;
  open.status = status;
  open.interruptedReason = 'abandoned';
  await open.save();

  await recomputeDays(userId, affectedDayKeys(open, open.timeZone), rollupContext);
  logger.info('Closed abandoned session', {
    userId: String(userId),
    sessionId: String(open._id),
    silentForMinutes: Math.round(silentForMs / 60_000),
  });

  return open;
}

/**
 * Rebuild the daily rollups a session affects, plus its task rollup.
 * @param {any} userId
 * @param {any} session
 * @param {{timeZone: string, successThresholdSeconds: number}} rollupContext
 */
async function refreshRollups(userId, session, rollupContext) {
  await recomputeDays(userId, affectedDayKeys(session, session.timeZone || rollupContext.timeZone), rollupContext);
  if (session.task) await taskService.recomputeRollup(userId, session.task);
}

/** @param {any} settings */
function rollupContextFor(settings) {
  return { timeZone: settings.timeZone, successThresholdSeconds: settings.successThresholdSeconds };
}

/**
 * Start a focus session, or adopt the one already running.
 *
 * @param {any} user
 * @param {{clientId: string, subjectId?: string|null, taskId?: string|null, kind?: string, plannedDuration: number, timeZone: string, device?: string, startTime?: Date}} input
 * @param {{userAgent?: string|null}} [context]
 */
export async function startSession(user, input, context = {}) {
  const settings = await settingsService.getOrCreate(user._id, { timeZone: input.timeZone });
  const rollupContext = rollupContextFor(settings);

  // 1. Is this the same request arriving twice?
  const alreadyCreated = await FocusSession.findOne({ user: user._id, clientId: input.clientId });
  if (alreadyCreated) {
    return { session: alreadyCreated, created: false, adopted: false, idempotent: true };
  }

  // 2. Clear anything abandoned, then adopt anything genuinely live.
  await reconcileStaleSession(user._id, rollupContext);
  const open = await findOpenSession(user._id);
  if (open) {
    return { session: open, created: false, adopted: true, idempotent: false };
  }

  const subjectId = await resolveOwnedSubjectId(user._id, input.subjectId);
  let task = null;
  if (input.taskId) task = await taskService.get(user._id, input.taskId);

  const startTime = input.startTime ?? new Date();
  const timeZone = input.timeZone || settings.timeZone;

  const session = new FocusSession({
    user: user._id,
    clientId: input.clientId,
    subject: subjectId,
    task: task?._id ?? null,
    taskTitleSnapshot: task?.title ?? null,
    kind: input.kind ?? 'focus',
    status: SESSION_STATUS.RUNNING,
    startTime,
    plannedDuration: input.plannedDuration,
    timeZone,
    dayKey: dayKey(startTime, timeZone),
    device: input.device ?? 'unknown',
    userAgent: context.userAgent ? String(context.userAgent).slice(0, 300) : null,
    events: [{ type: EVENT.START, at: startTime }],
  });

  try {
    await session.save();
  } catch (error) {
    // Lost a race with a concurrent retry of the same clientId — its document is
    // the canonical one.
    if (/** @type {any} */ (error)?.code === 11000) {
      const winner = await FocusSession.findOne({ user: user._id, clientId: input.clientId });
      if (winner) return { session: winner, created: false, adopted: false, idempotent: true };
    }
    throw error;
  }

  await refreshRollups(user._id, session, rollupContext);
  return { session, created: true, adopted: false, idempotent: false };
}

/**
 * Append events to a session.
 *
 * Late events for an already-closed session are accepted as long as they fall
 * inside its recorded window — an offline device flushing a distraction log after
 * the session has been closed elsewhere is a normal case, and rejecting it would
 * silently discard real data. Events *after* `endTime` are refused, because they
 * would move the session's own endpoint, which is the client's job to state
 * through `closeSession`.
 *
 * @param {any} user
 * @param {string} sessionId
 * @param {Array<{type: string, at: Date, kind?: string|null}>} events
 */
export async function appendEvents(user, sessionId, events) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);

  if (!OPEN.includes(session.status) && session.endTime) {
    const endMs = session.endTime.getTime();
    const late = events.filter((event) => new Date(event.at).getTime() > endMs);
    if (late.length === events.length) {
      throw ApiError.conflict(
        'SESSION_CLOSED',
        'That session has already ended, so these events cannot be applied.',
        { sessionId: String(session._id), endTime: session.endTime.toISOString() },
      );
    }
    events = events.filter((event) => new Date(event.at).getTime() <= endMs);
  }

  const added = session.appendEvents(events);
  if (added > 0) {
    const heartbeats = events.filter((event) => event.type === EVENT.HEARTBEAT);
    if (heartbeats.length > 0) {
      const latest = heartbeats.reduce((a, b) => (a.at > b.at ? a : b));
      session.lastHeartbeatAt = new Date(latest.at);
    }
    await session.save();
    await refreshRollups(user._id, session, rollupContextFor(settings));
  }

  return { session, added, ignored: events.length - added };
}

/**
 * Record a single lifecycle transition. Thin wrapper over `appendEvents` so the
 * named endpoints (pause/resume/break) share one code path and one set of rules.
 *
 * @param {any} user
 * @param {string} sessionId
 * @param {string} eventType
 * @param {{at?: Date, kind?: string}} [details]
 */
export async function recordTransition(user, sessionId, eventType, details = {}) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);

  if (!OPEN.includes(session.status)) {
    throw ApiError.conflict('SESSION_CLOSED', 'That session has already ended.', {
      sessionId: String(session._id),
      status: session.status,
    });
  }

  const at = details.at ?? new Date();
  session.appendEvents([{ type: eventType, at, kind: details.kind ?? null }]);

  // `pause` and `resume` are the two transitions that also change the stored
  // status, so the open-session index and the client's UI agree with the log.
  if (eventType === EVENT.PAUSE) session.status = SESSION_STATUS.PAUSED;
  if (eventType === EVENT.RESUME || eventType === EVENT.START) session.status = SESSION_STATUS.RUNNING;

  await session.save();
  await refreshRollups(user._id, session, rollupContextFor(settings));
  return session;
}

/** @param {any} user @param {string} sessionId @param {Date} [at] */
export async function heartbeat(user, sessionId, at) {
  const session = await loadOwned(user._id, sessionId);
  if (!OPEN.includes(session.status)) return { session, added: 0, ignored: 1 };

  const beatAt = at ?? new Date();
  // Collapse beats that arrive faster than the cadence: a client that reconnects
  // after an offline stretch can legitimately flush a burst of them, and storing
  // every one would bloat the document for no analytical gain.
  if (session.lastHeartbeatAt && beatAt.getTime() - session.lastHeartbeatAt.getTime() < HEARTBEAT_INTERVAL_MS - 5_000) {
    return { session, added: 0, ignored: 1 };
  }

  session.appendEvents([{ type: EVENT.HEARTBEAT, at: beatAt }]);
  session.lastHeartbeatAt = beatAt;
  await session.save();
  return { session, added: 1, ignored: 0 };
}

/**
 * @param {any} user
 * @param {string} sessionId
 * @param {{kind: string, at?: Date}} input
 */
export async function recordDistraction(user, sessionId, input) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);
  if (!OPEN.includes(session.status)) {
    throw ApiError.conflict('SESSION_CLOSED', 'That session has already ended.');
  }
  session.appendEvents([{ type: EVENT.DISTRACTION, at: input.at ?? new Date(), kind: input.kind }]);
  await session.save();
  await refreshRollups(user._id, session, rollupContextFor(settings));
  return session;
}

/**
 * Add time to the current session's plan. Extending is a change of intention, so
 * it never rewrites time already recorded — it only moves the target.
 *
 * @param {any} user
 * @param {string} sessionId
 * @param {number} minutes
 */
export async function extend(user, sessionId, minutes) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);
  if (!OPEN.includes(session.status)) throw ApiError.conflict('SESSION_CLOSED', 'That session has already ended.');

  const capped = Math.min(minutes, settings.maxExtendMinutes);
  session.plannedDuration = (session.plannedDuration ?? 0) + capped * 60;
  await session.save();
  return { session, addedMinutes: capped };
}

/**
 * End a session.
 *
 * @param {any} user
 * @param {string} sessionId
 * @param {{status?: string, events?: Array<{type:string, at:Date, kind?:string|null}>, endedAt?: Date, interruptedReason?: string|null, reflection?: string|null}} payload
 */
export async function closeSession(user, sessionId, payload = {}) {
  const settings = await settingsService.getOrCreate(user._id);
  const rollupContext = rollupContextFor(settings);
  const session = await loadOwned(user._id, sessionId);

  // Ending an already-ended session is a no-op, not an error: "end session" is
  // exactly the button a user double-taps, and the offline queue may replay it.
  if (!OPEN.includes(session.status)) {
    return { session, closed: false, alreadyClosed: true, newlyUnlocked: [] };
  }

  if (payload.events?.length) {
    const endMs = payload.endedAt ? new Date(payload.endedAt).getTime() : Date.now();
    session.appendEvents(payload.events.filter((event) => new Date(event.at).getTime() <= endMs));
  }
  if (payload.events?.some((event) => event.type === EVENT.HEARTBEAT)) {
    const beats = payload.events.filter((event) => event.type === EVENT.HEARTBEAT);
    session.lastHeartbeatAt = new Date(beats.reduce((a, b) => (a.at > b.at ? a : b)).at);
  }

  const lastEventAt = session.events.length > 0 ? new Date(session.events[session.events.length - 1].at) : new Date(session.startTime);
  const endedAt = payload.endedAt ?? lastEventAt;

  session.appendEvents([{ type: EVENT.END, at: endedAt }]);
  session.endTime = endedAt;

  const planned = Number(session.plannedDuration ?? 0);
  const focused = Number(session.focusedSeconds ?? 0);
  const inferred =
    payload.status ??
    (planned > 0 && focused >= planned * 0.9 ? SESSION_STATUS.COMPLETED : SESSION_STATUS.CANCELLED);
  session.status = inferred;

  if (payload.interruptedReason) session.interruptedReason = payload.interruptedReason;
  if (payload.reflection !== undefined) session.reflection = payload.reflection;

  // Re-derive before judging the idle guard, since the final event batch may have
  // changed the picture.
  /** @type {any} */ (session).derive();

  // You cannot have "completed" a session you were absent for. If the liveness
  // guard swallowed more time than was actually worked, the outcome is
  // interrupted — and the reason is recorded so the UI can say why.
  if (session.status === SESSION_STATUS.COMPLETED && session.idleSeconds > session.focusedSeconds) {
    session.status = SESSION_STATUS.INTERRUPTED;
    session.interruptedReason = session.interruptedReason ?? 'idle-guard';
  }

  await session.save();
  await refreshRollups(user._id, session, rollupContext);

  return { session, closed: true, alreadyClosed: false, newlyUnlocked: [] };
}

/**
 * @param {any} user
 * @param {string} sessionId
 * @param {{subjectId?: string|null, taskId?: string|null, reflection?: string|null}} patch
 */
export async function updateSession(user, sessionId, patch) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);

  if (patch.subjectId !== undefined) {
    session.subject = /** @type {any} */ (await resolveOwnedSubjectId(user._id, patch.subjectId));
  }
  if (patch.taskId !== undefined) {
    const task = patch.taskId ? await taskService.get(user._id, patch.taskId) : null;
    session.task = task?._id ?? null;
    session.taskTitleSnapshot = task?.title ?? null;
  }
  if (patch.reflection !== undefined) session.reflection = patch.reflection;

  await session.save();
  await refreshRollups(user._id, session, rollupContextFor(settings));
  return session;
}

/**
 * @param {any} user
 * @param {string} sessionId
 */
export async function removeSession(user, sessionId) {
  const settings = await settingsService.getOrCreate(user._id);
  const session = await loadOwned(user._id, sessionId);
  const dayKeys = affectedDayKeys(session, session.timeZone || settings.timeZone);
  const taskId = session.task;

  await session.deleteOne();
  await recomputeDays(user._id, dayKeys, rollupContextFor(settings));
  if (taskId) await taskService.recomputeRollup(user._id, String(taskId));

  return { deleted: true, id: String(sessionId) };
}

/**
 * @param {any} user
 * @param {{limit?: number, offset?: number, subjectId?: string, taskId?: string, status?: string, from?: string, to?: string}} query
 */
export async function listSessions(user, query = {}) {
  /** @type {Record<string, any>} */
  const filter = { user: user._id };
  if (query.subjectId) filter.subject = query.subjectId;
  if (query.taskId) filter.task = query.taskId;
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.startTime = {};
    if (query.from) filter.startTime.$gte = new Date(query.from);
    if (query.to) filter.startTime.$lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    FocusSession.find(filter)
      .sort({ startTime: -1 })
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 50),
    FocusSession.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => toPublicSession(item, { includeEvents: false })),
    total,
  };
}

/**
 * Current session plus the honest reconciliation the client needs on load.
 *
 * @param {any} user
 */
export async function currentSession(user) {
  const settings = await settingsService.getOrCreate(user._id);
  const closed = await reconcileStaleSession(user._id, rollupContextFor(settings));
  const open = await findOpenSession(user._id);
  const subjects = open ? await nameAndColorMap(user._id) : new Map();

  return {
    /** Full public view, including the raw event log, for reconciliation. */
    openSession: open ? toPublicSession(open, { includeEvents: true }) : null,
    /**
     * The same session in the shape `@focusforge/core` consumes. The client can
     * pass this straight into the shared aggregation functions, so its optimistic
     * view is computed by identical code rather than by a parallel implementation.
     */
    openRecord: open ? toSessionRecord(open, subjects) : null,
    /** Populated when a previous session was reaped on this load. */
    reconciled: closed ? toPublicSession(closed) : null,
    serverTime: new Date().toISOString(),
    idleGapMs: IDLE_GAP_MS,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  };
}

/**
 * Derive the live, authoritative view of a session without writing anything.
 * The client polls this rarely; it uses the shared core locally for the ticking
 * readout and reconciles with this on meaningful transitions.
 *
 * @param {any} user
 * @param {string} sessionId
 */
export async function previewSession(user, sessionId) {
  const session = await loadOwned(user._id, sessionId);
  const subjects = await nameAndColorMap(user._id);
  return { record: toSessionRecord(session, subjects), raw: toPublicSession(session, { includeEvents: true }) };
}
