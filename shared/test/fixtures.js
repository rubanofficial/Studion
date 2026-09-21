/**
 * Test fixtures.
 *
 * Kept out of `src/` so it never leaks into the published surface, but shared
 * between test files so every suite builds session records through the *real*
 * derivation path (`deriveSessionStats`) rather than hand-written numbers. A
 * fixture that lies would make the analytics tests worthless.
 */

import { EVENT, SESSION_STATUS } from '../src/constants.js';
import { deriveSessionStats } from '../src/timeline.js';
import { zonedToUtc } from '../src/timezone.js';

export const TZ = 'America/New_York';
export const IST = 'Asia/Kolkata';

/**
 * Build a UTC instant from a local wall-clock time in a timezone.
 * @param {string} dayKey `YYYY-MM-DD`
 * @param {string} time `HH:MM`
 * @param {string} [timeZone]
 * @returns {number} epoch ms
 */
export function localInstant(dayKey, time, timeZone = TZ) {
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return zonedToUtc({ year, month, day, hour, minute }, timeZone).getTime();
}

/**
 * Build a linear event log for a session: focus, optional pause, optional break.
 * @param {{
 *   dayKey: string,
 *   start: string,
 *   minutes: number,
 *   pauses?: Array<[number, number]>,
 *   breaks?: Array<[number, number]>,
 *   distractions?: Array<[number, string]>,
 *   timeZone?: string,
 * }} spec
 * @returns {Array<{type:string, at:number, kind?:string}>}
 */
export function buildEvents(spec) {
  const { dayKey, start, minutes, pauses = [], breaks = [], distractions = [], timeZone = TZ } = spec;
  const base = localInstant(dayKey, start, timeZone);
  const m = (/** @type {number} */ offset) => base + Math.round(offset * 60_000);
  /** @type {Array<{type:string, at:number, kind?:string}>} */
  const events = [{ type: EVENT.START, at: m(0) }];

  const transitions = [
    ...pauses.map(([from, to]) => ({ at: from, type: EVENT.PAUSE, end: to })),
    ...breaks.map(([from, to]) => ({ at: from, type: EVENT.BREAK_START, end: to })),
  ].sort((a, b) => a.at - b.at);

  for (const transition of transitions) {
    events.push({ type: transition.type, at: m(transition.at) });
    events.push({
      type: transition.type === EVENT.PAUSE ? EVENT.RESUME : EVENT.BREAK_END,
      at: m(transition.end),
    });
    if (transition.type === EVENT.BREAK_START) {
      events.push({ type: EVENT.RESUME, at: m(transition.end) });
    }
  }

  for (const [offset, kind] of distractions) {
    events.push({ type: EVENT.DISTRACTION, at: m(offset), kind });
  }

  events.push({ type: EVENT.END, at: m(minutes) });
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Produce a SessionRecord in the exact shape the analytics functions consume.
 * @param {{
 *   id: string,
 *   subjectId?: string|null,
 *   subjectName?: string|null,
 *   subjectColor?: string|null,
 *   taskId?: string|null,
 *   taskTitle?: string|null,
 *   dayKey?: string,
 *   start?: string,
 *   minutes: number,
 *   plannedMinutes?: number,
 *   pauses?: Array<[number, number]>,
 *   breaks?: Array<[number, number]>,
 *   distractions?: Array<[number, string]>,
 *   status?: string,
 *   timeZone?: string,
 *   device?: string,
 * }} spec
 * @param {{focusScore?: number|null}} [extra]
 * @returns {any}
 */
export function sessionRecord(spec, extra = {}) {
  const {
    id,
    subjectId = null,
    subjectName = null,
    subjectColor = null,
    taskId = null,
    taskTitle = null,
    dayKey = '2026-03-02',
    start = '09:00',
    minutes,
    plannedMinutes = minutes,
    pauses = [],
    breaks = [],
    distractions = [],
    status = SESSION_STATUS.COMPLETED,
    timeZone = TZ,
    device = 'web-desktop',
  } = spec;

  const events = buildEvents({ dayKey, start, minutes, pauses, breaks, distractions, timeZone });
  const stats = deriveSessionStats({ events, status, plannedDuration: plannedMinutes * 60 });

  /** @type {Record<string, number>} */
  const distractionKinds = {};
  for (const [, kind] of distractions) distractionKinds[kind] = (distractionKinds[kind] ?? 0) + 1;

  return {
    id,
    clientId: id,
    subjectId,
    subjectName,
    subjectColor,
    taskId,
    taskTitle,
    startTimeMs: stats.startTimeMs,
    endTimeMs: stats.endTimeMs,
    focusedSeconds: stats.focusedSeconds,
    breakSeconds: stats.breakSeconds,
    pausedSeconds: stats.pausedSeconds,
    idleSeconds: stats.idleSeconds,
    plannedSeconds: stats.plannedSeconds,
    wallSeconds: stats.wallSeconds,
    focusScore: extra.focusScore ?? null,
    status,
    pauseCount: stats.pauseCount,
    distractionCount: stats.distractionCount,
    distractionKinds,
    segments: stats.segments,
    device,
  };
}

/** Minimal logger that keeps the seed script and tests quiet. */
export const noop = () => {};
