/**
 * The focus event-log folder.
 *
 * This is the single most important piece of correctness in FocusForge. Every
 * duration the product displays — live and historical — is derived here from an
 * ordered log of instants. Nothing is ever computed by decrementing a counter.
 *
 * Why an event log:
 *   - a refresh, a crash, a dead battery or an offline stretch cannot lose time,
 *     because the client only ever *appends* facts it observed;
 *   - the server re-folds the same log and gets the same answer, so the client
 *     cannot inflate its own stats;
 *   - a paused session, a break, and an interruption are all just log entries,
 *     so "actual productive time" and "planned time" stay separately measurable.
 *
 * The same function runs in the browser (for the live readout) and on the
 * server (as the authority), which is why it lives in this shared package.
 */

import {
  EVENT,
  IDLE_GAP_MS,
  MIN_HEARTBEATS_FOR_IDLE,
  MIN_SCORABLE_FOCUS_SECONDS,
  SEGMENT,
  SESSION_STATUS,
} from './constants.js';
import { secondsBetween, toMs } from './time.js';

/**
 * Canonical ordering for events that share an instant.
 *
 * Two events landing on the same millisecond is normal — a zero-length break, a
 * `breakEnd` immediately followed by the `resume` it triggers, or a client that
 * batches an entire offline log at one timestamp resolution. Sorting by instant
 * alone would then leave the outcome dependent on array order, which can differ
 * between the browser and the server after a JSON round-trip. A total order that
 * follows the state machine makes the fold deterministic everywhere.
 */
const EVENT_ORDER = Object.freeze({
  [EVENT.START]: 0,
  // breakEnd must beat resume, so a break ending and focus resuming in the same
  // millisecond closes the break before reopening focus rather than the reverse.
  [EVENT.BREAK_END]: 1,
  // pause must beat resume, so a zero-length pause is a no-op (close then
  // reopen) instead of terminating the focus block permanently.
  [EVENT.PAUSE]: 2,
  [EVENT.RESUME]: 3,
  [EVENT.BREAK_START]: 4,
  [EVENT.DISTRACTION]: 5,
  [EVENT.HEARTBEAT]: 6,
  [EVENT.END]: 7,
});

/**
 * @param {string} type
 * @returns {number}
 */
function eventRank(type) {
  return EVENT_ORDER[/** @type {keyof typeof EVENT_ORDER} */ (type)] ?? 9;
}

/**
 * @typedef {{type: string, at: number, kind?: string|null, note?: string}} NormalisedEvent
 * @typedef {{kind: string, from: number, to: number|null}} Segment
 */

/**
 * Sort + de-duplicate a raw event log.
 *
 * Events are ordered by instant; ties keep insertion order, which matters when
 * a `breakEnd` and the `resume` it triggers land in the same millisecond. Exact
 * duplicates (same type + instant) are collapsed so a retried HTTP request or a
 * double-clicked button cannot double-count a pause.
 *
 * @param {Array<{type:string, at:any, kind?:string|null, note?:string}>} events
 * @returns {NormalisedEvent[]}
 */
export function normaliseEvents(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  const seen = new Set();
  events.forEach((event, index) => {
    const at = toMs(event?.at);
    if (at === null || typeof event?.type !== 'string') return;
    const key = `${event.type}@${at}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type: event.type, at, kind: event.kind, note: event.note, _i: index });
  });
  out.sort((a, b) => a.at - b.at || eventRank(a.type) - eventRank(b.type) || a._i - b._i);
  return out.map(({ _i, ...rest }) => rest);
}

/**
 * Fold the log into contiguous timeline segments.
 *
 * State machine:
 *   start ─▶ focus ─(pause)─▶ paused ─(resume)─▶ focus
 *                └─(breakStart)─▶ break ─(breakEnd)─▶ paused
 *   `breakEnd` deliberately returns to `paused` rather than `focus`: whether a
 *   break auto-resumes is a *user preference*, so the client expresses it by
 *   emitting an explicit `resume`. The folder never guesses intent.
 *
 * @param {NormalisedEvent[]} events
 * @param {number} now epoch ms used to close any still-open segment
 * @param {number} [idleGapMs]
 * @returns {{segments: Segment[], state: string}}
 */
export function foldTimeline(events, now, idleGapMs = IDLE_GAP_MS) {
  // Callers legitimately hold ISO strings (straight from JSON) or Dates.
  now = toMs(now) ?? Date.now();
  /** @type {Segment[]} */
  const raw = [];
  let open = /** @type {Segment|null} */ (null);
  let state = 'idle';

  const close = (/** @type {number} */ at) => {
    if (open) {
      if (at > open.from) raw.push({ kind: open.kind, from: open.from, to: at });
      open = null;
    }
  };

  for (const event of events) {
    switch (event.type) {
      case EVENT.START:
        // Idempotent while already focusing: a duplicated start must extend the
        // current block, not chop it into two and understate the longest run.
        if (state !== 'focus') {
          close(event.at);
          open = { kind: SEGMENT.FOCUS, from: event.at, to: null };
          state = 'focus';
        }
        break;
      case EVENT.RESUME:
        if (state !== 'focus') {
          close(event.at);
          open = { kind: SEGMENT.FOCUS, from: event.at, to: null };
          state = 'focus';
        }
        break;
      case EVENT.PAUSE:
        if (state === 'focus') {
          close(event.at);
          state = 'paused';
        }
        break;
      case EVENT.BREAK_START:
        if (state === 'focus' || state === 'paused') {
          close(event.at);
          open = { kind: SEGMENT.BREAK, from: event.at, to: null };
          state = 'break';
        }
        break;
      case EVENT.BREAK_END:
        if (state === 'break') {
          close(event.at);
          state = 'paused';
        }
        break;
      case EVENT.END:
        close(event.at);
        state = 'ended';
        break;
      default:
        // heartbeat / distraction are observations, not transitions.
        break;
    }
  }

  if (open) close(Math.max(now, open.from));
  return { segments: splitIdle(raw, events, idleGapMs), state };
}

/**
 * Reclassify silent stretches inside a focus window as `idle`.
 *
 * Without this, closing the laptop lid mid-session and reopening it four hours
 * later would be recorded as four hours of deep work. We detect silence by
 * looking for gaps between *liveness evidence* (`heartbeat` events, or any other
 * event, all of which prove the tab was alive) that exceed the tolerance.
 *
 * @param {Segment[]} segments
 * @param {NormalisedEvent[]} events
 * @param {number} idleGapMs
 * @returns {Segment[]}
 */
function splitIdle(segments, events, idleGapMs) {
  if (!Number.isFinite(idleGapMs) || idleGapMs <= 0) return segments;
  const marks = events.filter((e) => e.type !== EVENT.DISTRACTION).map((e) => e.at);
  const heartbeats = events.filter((e) => e.type === EVENT.HEARTBEAT).map((e) => e.at);
  /** @type {Segment[]} */
  const out = [];

  for (const segment of segments) {
    if (segment.kind !== SEGMENT.FOCUS || segment.to === null) {
      out.push(segment);
      continue;
    }
    // Safe-by-default: only infer absence from silence when the client has
    // demonstrated that it does report presence.
    const evidence = heartbeats.filter((at) => at >= segment.from && at <= segment.to).length;
    if (evidence < MIN_HEARTBEATS_FOR_IDLE) {
      out.push(segment);
      continue;
    }
    const inside = marks.filter((at) => at > segment.from && at < segment.to);
    const checkpoints = [segment.from, ...inside, segment.to];
    let cursor = segment.from;
    for (let i = 1; i < checkpoints.length; i += 1) {
      const gap = checkpoints[i] - checkpoints[i - 1];
      if (gap > idleGapMs) {
        if (checkpoints[i - 1] > cursor) {
          out.push({ kind: SEGMENT.FOCUS, from: cursor, to: checkpoints[i - 1] });
        }
        out.push({ kind: SEGMENT.IDLE, from: checkpoints[i - 1], to: checkpoints[i] });
        cursor = checkpoints[i];
      }
    }
    if (segment.to > cursor) out.push({ kind: SEGMENT.FOCUS, from: cursor, to: segment.to });
  }
  return out;
}

/**
 * Derive every measurable quantity for a session from its event log.
 *
 * Returns `null`-safe totals: a session with no events yields zeros rather than
 * NaN, so the UI never has to guard aggregate maths.
 *
 * @param {{
 *   events?: Array<{type:string,at:any,kind?:string|null}>,
 *   startTime?: any,
 *   endTime?: any,
 *   status?: string,
 *   plannedDuration?: number,
 * }} session
 * @param {{now?: number, idleGapMs?: number}} [options]
 * @returns {{
 *   segments: Segment[],
 *   state: string,
 *   status: string,
 *   startTimeMs: number|null,
 *   endTimeMs: number|null,
 *   focusedSeconds: number,
 *   breakSeconds: number,
 *   pausedSeconds: number,
 *   idleSeconds: number,
 *   wallSeconds: number,
 *   plannedSeconds: number,
 *   progress: number,
 *   remainingSeconds: number,
 *   pauseCount: number,
 *   breakCount: number,
 *   distractionCount: number,
 *   distractionsPerHour: number,
 *   timeInFocusRatio: number,
 *   heartbeatCount: number,
 *   lastHeartbeatMs: number|null,
 *   longestFocusStreakSeconds: number,
 *   isOpen: boolean,
 * }}
 */
export function deriveSessionStats(session, options = {}) {
  const now = toMs(options.now ?? Date.now()) ?? Date.now();
  const events = normaliseEvents(session?.events ?? []);
  const { segments, state } = foldTimeline(events, now, options.idleGapMs);

  const first = events.length > 0 ? events[0].at : null;
  const explicitStart = toMs(session?.startTime);
  const startTimeMs = explicitStart ?? first;
  const explicitEnd = toMs(session?.endTime);
  const endTimeMs = explicitEnd ?? (state === 'ended' ? segments.at(-1)?.to ?? now : null);
  const effectiveEnd = endTimeMs ?? now;

  let focusedSeconds = 0;
  let breakSeconds = 0;
  let idleSeconds = 0;
  let longestFocusStreakSeconds = 0;
  for (const segment of segments) {
    const span = secondsBetween(segment.from, segment.to ?? effectiveEnd);
    if (segment.kind === SEGMENT.FOCUS) {
      focusedSeconds += span;
      longestFocusStreakSeconds = Math.max(longestFocusStreakSeconds, span);
    } else if (segment.kind === SEGMENT.BREAK) breakSeconds += span;
    else if (segment.kind === SEGMENT.IDLE) idleSeconds += span;
  }

  const wallSeconds = startTimeMs === null ? 0 : secondsBetween(startTimeMs, effectiveEnd);
  const plannedSeconds = Math.max(0, Math.round(Number(session?.plannedDuration) || 0));
  const countedSeconds = focusedSeconds + breakSeconds + idleSeconds;
  const pausedSeconds = Math.max(0, wallSeconds - countedSeconds);

  const pauseCount = events.filter((e) => e.type === EVENT.PAUSE).length;
  const breakCount = events.filter((e) => e.type === EVENT.BREAK_START).length;
  const distractions = events.filter((e) => e.type === EVENT.DISTRACTION);
  const heartbeats = events.filter((e) => e.type === EVENT.HEARTBEAT);

  const isOpen = state === 'focus' || state === 'paused' || state === 'break';
  const status = /** @type {string} */ (session?.status) || (isOpen ? SESSION_STATUS.RUNNING : state);

  return {
    segments,
    state,
    status,
    startTimeMs,
    endTimeMs,
    focusedSeconds,
    breakSeconds,
    pausedSeconds,
    idleSeconds,
    wallSeconds,
    plannedSeconds,
    progress: plannedSeconds > 0 ? Math.min(1, focusedSeconds / plannedSeconds) : 0,
    remainingSeconds: Math.max(0, plannedSeconds - focusedSeconds),
    pauseCount,
    breakCount,
    distractionCount: distractions.length,
    distractionsPerHour: focusedSeconds > 0 ? (distractions.length / focusedSeconds) * 3600 : 0,
    timeInFocusRatio: wallSeconds > 0 ? focusedSeconds / wallSeconds : focusedSeconds > 0 ? 1 : 0,
    heartbeatCount: heartbeats.length,
    lastHeartbeatMs: heartbeats.length > 0 ? heartbeats.at(-1).at : null,
    longestFocusStreakSeconds,
    isOpen,
  };
}

/**
 * Minimum information needed to decide whether a session is worth scoring.
 * @param {{focusedSeconds: number, plannedSeconds: number}} stats
 * @returns {boolean}
 */
export function isScorable(stats) {
  return Boolean(stats) && stats.focusedSeconds >= MIN_SCORABLE_FOCUS_SECONDS && stats.plannedSeconds > 0;
}

/**
 * Group segments into the local calendar days they touch. Used by heatmaps and
 * the focus landscape, where a session spanning midnight must contribute to
 * both days rather than being dumped entirely on its start date.
 *
 * @param {Segment[]} segments
 * @param {string} timeZone
 * @param {(instant: number, timeZone: string) => string} dayKeyFn injected to avoid a circular import
 * @returns {Array<{dayKey: string, focusSeconds: number, breakSeconds: number}>}
 */
export function segmentsByDay(segments, timeZone, dayKeyFn) {
  /** @type {Map<string, {dayKey: string, focusSeconds: number, breakSeconds: number}>} */
  const map = new Map();
  for (const segment of segments) {
    if (segment.to === null || segment.kind === SEGMENT.PAUSED) continue;
    const key = dayKeyFn(segment.from, timeZone);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { dayKey: key, focusSeconds: 0, breakSeconds: 0 };
      map.set(key, bucket);
    }
    const seconds = secondsBetween(segment.from, segment.to);
    if (segment.kind === SEGMENT.FOCUS) bucket.focusSeconds += seconds;
    else if (segment.kind === SEGMENT.BREAK) bucket.breakSeconds += seconds;
  }
  return [...map.values()];
}
