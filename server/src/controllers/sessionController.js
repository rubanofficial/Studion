/**
 * Session controller.
 *
 * Every timer action is a small endpoint that appends facts and returns the
 * server's recomputed view of the session. The client never receives "here is
 * your remaining time" — it receives instants and derived durations, so a
 * reconnecting device can reconcile from truth rather than from a drifted local
 * counter.
 *
 * Two endpoints worth calling out:
 *
 *   - `GET /api/sessions/current` is what the app calls on load. It reports the
 *     open session, any session that was reaped as abandoned, the server clock,
 *     and the heartbeat cadence — everything the client needs to resume or take
 *     over a running timer on a different device.
 *   - `POST /api/sessions/:id/events` is the single batched write used by the
 *     offline queue. Named pause/resume/break endpoints also exist for clarity
 *     and for the case where a transition must be immediate and its own request.
 */

import { DISTRACTION_LABELS } from '@focusforge/core';

import * as achievementService from '../services/achievementService.js';
import * as sessionService from '../services/sessionService.js';
import { toPublicSession } from '../services/sessionMapper.js';
import * as settingsService from '../services/settingsService.js';
import { sendData, sendNoContent } from '../utils/http.js';

/** @param {any} session */
function serialize(session) {
  return toPublicSession(session, { includeEvents: true });
}

/**
 * The client sends its own `now` on every write. Comparing it with the server's
 * clock lets the UI warn that a device's clock is wrong, which matters because
 * every duration in the product is derived from client-recorded instants.
 * @type {import('express').RequestHandler}
 */
export async function start(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.startSession(user, req.validated.body, {
    userAgent: req.get?.('user-agent') ?? null,
  });

  sendData(
    res,
    {
      session: serialize(result.session),
      created: result.created,
      /** True when an existing session on another device was taken over. */
      adopted: result.adopted,
      /** True when this exact request had already been applied. */
      idempotent: result.idempotent,
      serverTime: new Date().toISOString(),
    },
    { status: result.created ? 201 : 200 },
  );
}

/** @type {import('express').RequestHandler} */
export async function current(req, res) {
  // @ts-expect-error set by requireAuth
  const result = await sessionService.currentSession(req.user);
  sendData(res, result);
}

/** @type {import('express').RequestHandler} */
export async function preview(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.previewSession(user, req.validated.params.id);
  sendData(res, { session: toPublicSession(result.raw, { includeEvents: true }), record: result.record });
}

/** @type {import('express').RequestHandler} */
export async function appendEvents(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.appendEvents(user, id, req.validated.body.events);
  sendData(res, { session: serialize(result.session), added: result.added, ignored: result.ignored });
}

/**
 * Pause, resume, break start and break end share one handler because they are the
 * same operation with a different event type.
 * @param {string} eventType
 * @returns {import('express').RequestHandler}
 */
function transition(eventType) {
  return async (req, res) => {
    // @ts-expect-error set by requireAuth
    const user = req.user;
    // @ts-expect-error set by the validate middleware
    const { id } = req.validated.params;
    const at = /** @type {any} */ (req).validated?.body?.at;
    const session = await sessionService.recordTransition(user, id, eventType, { at });
    sendData(res, { session: serialize(session) });
  };
}

export const pause = transition('pause');
export const resume = transition('resume');
export const breakStart = transition('breakStart');
export const breakEnd = transition('breakEnd');

/** @type {import('express').RequestHandler} */
export async function heartbeat(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.heartbeat(user, id, req.validated.body?.at);
  sendData(res, { added: result.added, ignored: result.ignored, serverTime: new Date().toISOString() });
}

/** @type {import('express').RequestHandler} */
export async function distraction(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const session = await sessionService.recordDistraction(user, id, req.validated.body);
  sendData(res, { session: serialize(session) });
}

/** @type {import('express').RequestHandler} */
export async function extend(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.extend(user, id, req.validated.body.minutes);
  sendData(res, { session: serialize(result.session), addedMinutes: result.addedMinutes });
}

/** @type {import('express').RequestHandler} */
export async function complete(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const result = await sessionService.closeSession(user, id, req.validated.body);

  // Unlocks are evaluated after the session is committed, so a failure here can
  // never lose the user's measured time.
  let achievements = { freshlyUnlocked: /** @type {string[]} */ ([]) };
  try {
    const settings = await settingsService.getOrCreate(user._id);
    achievements = await achievementService.evaluateAndSync(user._id, settings);
  } catch {
    // Deliberately swallowed: achievements are decorative, the session is not.
  }

  sendData(res, {
    session: serialize(result.session),
    closed: result.closed,
    alreadyClosed: result.alreadyClosed,
    newlyUnlocked: achievements.freshlyUnlocked,
  });
}

/** @type {import('express').RequestHandler} */
export async function update(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const session = await sessionService.updateSession(user, id, req.validated.body);
  sendData(res, { session: serialize(session) });
}

/** @type {import('express').RequestHandler} */
export async function remove(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  await sessionService.removeSession(user, req.validated.params.id);
  sendNoContent(res);
}

/** @type {import('express').RequestHandler} */
export async function list(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { items, total } = await sessionService.listSessions(user, req.validated.query);
  sendData(res, { sessions: items }, { meta: { total } });
}

/** The distraction taxonomy, so the UI and API share one vocabulary. */
export const getDistractionOptions = (_req, res) =>
  sendData(res, { options: Object.entries(DISTRACTION_LABELS).map(([kind, label]) => ({ kind, ...label })) });
