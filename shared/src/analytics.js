/**
 * Aggregation.
 *
 * Everything here is a pure function over a list of already-derived session
 * records, so server analytics and client-side optimistic analytics produce
 * byte-identical numbers. Aggregation is always *by local day key*, never by
 * index arithmetic on the UTC timeline.
 */

import { SEGMENT, SESSION_STATUS } from './constants.js';
import { aggregateFocusScore } from './focusScore.js';
import { clamp, ratio, round } from './time.js';
import { dayKey, dayKeyRange, hourOfDay, parseDayKey, shiftDayKey, startOfDay, weekdayOfKey, zonedParts, zonedToUtc } from './timezone.js';

/**
 * Cut a segment at local midnight boundaries.
 *
 * Without this a 23:30–00:30 session would be attributed entirely to the day it
 * started, quietly inflating that day and leaving a hole in the next one. The
 * boundary is computed from the tz database, so a session spanning a DST change
 * is still sliced at the true local midnight.
 *
 * @param {{from:number, to:number}} segment
 * @param {string} timeZone
 * @returns {Array<{dayKey:string, seconds:number}>}
 */
export function splitSegmentAcrossDays(segment, timeZone) {
  /** @type {Array<{dayKey:string, seconds:number}>} */
  const out = [];
  let cursor = segment.from;
  for (let guard = 0; cursor < segment.to && guard < 400; guard += 1) {
    const key = dayKey(cursor, timeZone);
    const boundary = startOfDay(shiftDayKey(key, 1), timeZone).getTime();
    const end = Math.min(boundary, segment.to);
    out.push({ dayKey: key, seconds: Math.max(0, Math.round((end - cursor) / 1000)) });
    if (end <= cursor) break;
    cursor = end;
  }
  return out;
}

/**
 * @typedef {{
 *   id: string,
 *   clientId?: string,
 *   subjectId?: string|null,
 *   subjectName?: string|null,
 *   subjectColor?: string|null,
 *   taskId?: string|null,
 *   taskTitle?: string|null,
 *   startTimeMs: number|null,
 *   endTimeMs: number|null,
 *   focusedSeconds: number,
 *   breakSeconds: number,
 *   pausedSeconds: number,
 *   idleSeconds: number,
 *   plannedSeconds: number,
 *   wallSeconds: number,
 *   focusScore: number|null,
 *   status: string,
 *   pauseCount: number,
 *   distractionCount: number,
 *   distractionKinds?: Record<string, number>,
 *   segments?: Array<{kind:string, from:number, to:number|null}>,
 *   device?: string|null,
 * }} SessionRecord
 */

/**
 * Filter to sessions that represent *finished work*. Live sessions are excluded
 * from historical analytics so that a running timer cannot make "today" appear
 * to jump around; the cockpit reads the live session separately.
 * @param {SessionRecord[]} sessions
 * @param {{includeOpen?: boolean}} [options]
 * @returns {SessionRecord[]}
 */
export function closedSessions(sessions, options = {}) {
  if (options.includeOpen) return sessions;
  return sessions.filter((s) => !isOpenStatus(s.status));
}

/** @param {string|undefined} status */
export function isOpenStatus(status) {
  return status === SESSION_STATUS.RUNNING || status === SESSION_STATUS.PAUSED;
}

/**
 * Sessions with essentially no focus time are dropped before aggregation.
 * They are noise, not data — a mis-tapped start should not become "1 session".
 * @param {SessionRecord[]} sessions
 * @param {number} [minSeconds]
 * @returns {SessionRecord[]}
 */
export function meaningfulSessions(sessions, minSeconds = 60) {
  return sessions.filter((s) => (s.focusedSeconds || 0) >= minSeconds);
}

/**
 * Bucket sessions by the local day their focus time belongs to.
 *
 * A session that crosses midnight is attributed to the day it *started* for
 * counting purposes, but its focused seconds are split across the days its
 * segments actually touched. Both behaviours are needed: "sessions completed on
 * Tuesday" and "minutes focused on Tuesday" are different questions.
 *
 * @param {SessionRecord[]} sessions
 * @param {string} timeZone
 * @returns {Map<string, {dayKey: string, focusedSeconds: number, breakSeconds: number, sessions: SessionRecord[], sessionCount: number, completedCount: number, distractionCount: number}>}
 */
export function groupByDay(sessions, timeZone) {
  /** @type {Map<string, any>} */
  const map = new Map();
  const ensure = (/** @type {string} */ key) => {
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        dayKey: key,
        focusedSeconds: 0,
        breakSeconds: 0,
        sessions: [],
        sessionCount: 0,
        completedCount: 0,
        distractionCount: 0,
      };
      map.set(key, bucket);
    }
    return bucket;
  };

  for (const session of sessions) {
    const startMs = session.startTimeMs ?? 0;
    const home = ensure(dayKey(startMs, timeZone));
    home.sessions.push(session);
    home.sessionCount += 1;
    home.distractionCount += session.distractionCount || 0;
    if (session.status === SESSION_STATUS.COMPLETED) home.completedCount += 1;

    const segments = session.segments && session.segments.length > 0 ? session.segments : null;
    if (!segments) {
      home.focusedSeconds += session.focusedSeconds || 0;
      home.breakSeconds += session.breakSeconds || 0;
      continue;
    }
    for (const segment of segments) {
      if (segment.to === null) continue;
      if (segment.kind === SEGMENT.PAUSED || segment.kind === SEGMENT.IDLE) continue;
      for (const slice of splitSegmentAcrossDays({ from: segment.from, to: segment.to }, timeZone)) {
        const bucket = ensure(slice.dayKey);
        if (segment.kind === SEGMENT.FOCUS) bucket.focusedSeconds += slice.seconds;
        else if (segment.kind === SEGMENT.BREAK) bucket.breakSeconds += slice.seconds;
      }
    }
  }
  return map;
}

/**
 * A dense daily series covering every day in the window — including zero days.
 * Dense output is what makes the focus landscape and heatmap honest: missing
 * days must render as gaps, not be silently skipped.
 *
 * @param {SessionRecord[]} sessions
 * @param {string[]} dayKeys
 * @param {string} timeZone
 * @returns {Array<{dayKey:string,focusedSeconds:number,breakSeconds:number,sessionCount:number,completedCount:number,distractionCount:number,goalMet:boolean}>}
 */
export function buildDailySeries(sessions, dayKeys, timeZone, options = {}) {
  const grouped = groupByDay(sessions, timeZone);
  const threshold = options.successThresholdSeconds ?? 0;
  return dayKeys.map((key) => {
    const bucket = grouped.get(key);
    const focusedSeconds = bucket?.focusedSeconds ?? 0;
    return {
      dayKey: key,
      focusedSeconds,
      breakSeconds: bucket?.breakSeconds ?? 0,
      sessionCount: bucket?.sessionCount ?? 0,
      completedCount: bucket?.completedCount ?? 0,
      distractionCount: bucket?.distractionCount ?? 0,
      goalMet: threshold > 0 ? focusedSeconds >= threshold : focusedSeconds > 0,
    };
  });
}

/**
 * The next instant at which the local wall clock crosses an hour boundary.
 * Derived through the tz database, so a DST jump produces a 23- or 25-hour day
 * without smearing minutes into the wrong hour bucket.
 *
 * @param {number} instantMs
 * @param {string} timeZone
 * @returns {number} epoch ms
 */
function nextLocalHourBoundary(instantMs, timeZone) {
  const parts = zonedParts(instantMs, timeZone);
  if (!parts) return instantMs + 3600_000;
  // Date.UTC normalises overflow (hour 24 -> next day 00:00) for us.
  const overflow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour + 1, 0, 0, 0));
  const boundary = zonedToUtc(
    {
      year: overflow.getUTCFullYear(),
      month: overflow.getUTCMonth() + 1,
      day: overflow.getUTCDate(),
      hour: overflow.getUTCHours(),
    },
    timeZone,
  ).getTime();
  // A safe fallback if the tz database yields a non-advancing boundary.
  return boundary > instantMs ? boundary : instantMs + 3600_000;
}

/**
 * Focus seconds per local hour of day, 0..23.
 *
 * Focus segments are sliced at real local hour boundaries rather than attributed
 * wholly to their starting hour, so a 21:30–23:00 block correctly reports 30
 * minutes in hour 21 and 60 in hour 22. This is the data behind the Day Dial and
 * the "you focus best between 8pm and 10pm" insight.
 *
 * @param {SessionRecord[]} sessions
 * @param {string} timeZone
 * @returns {Array<{hour:number, seconds:number, sessionStarts:number}>}
 */
export function hourlyDensity(sessions, timeZone) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0, sessionStarts: 0 }));
  for (const session of sessions) {
    if (session.startTimeMs) hours[hourOfDay(session.startTimeMs, timeZone)].sessionStarts += 1;
    for (const segment of session.segments ?? []) {
      if (segment.kind !== SEGMENT.FOCUS || segment.to === null) continue;
      let cursor = segment.from;
      // 24 boundaries is the theoretical max; the guard caps pathological input.
      for (let guard = 0; cursor < segment.to && guard < 200; guard += 1) {
        const end = Math.min(nextLocalHourBoundary(cursor, timeZone), segment.to);
        const hour = hourOfDay(cursor, timeZone);
        hours[hour].seconds += Math.max(0, Math.round((end - cursor) / 1000));
        if (end <= cursor) break;
        cursor = end;
      }
    }
  }
  return hours;
}

/**
 * Per-subject breakdown of focused time within a period.
 * @param {SessionRecord[]} sessions
 * @returns {Array<{subjectId:string, name:string, color:string|null, focusedSeconds:number, sessionCount:number, share:number, avgSessionSeconds:number, averageScore:number|null}>}
 */
export function subjectBreakdown(sessions) {
  /** @type {Map<string, any>} */
  const map = new Map();
  let total = 0;
  for (const session of sessions) {
    const id = session.subjectId ?? 'unassigned';
    let entry = map.get(id);
    if (!entry) {
      entry = {
        subjectId: id,
        name: session.subjectName ?? 'Unassigned',
        color: session.subjectColor ?? null,
        focusedSeconds: 0,
        sessionCount: 0,
        scores: [],
        scoreSeconds: [],
      };
      map.set(id, entry);
    }
    entry.focusedSeconds += session.focusedSeconds || 0;
    entry.sessionCount += 1;
    total += session.focusedSeconds || 0;
    if (session.focusScore !== null && session.focusScore !== undefined) {
      entry.scores.push(session.focusScore);
      entry.scoreSeconds.push(Math.max(1, session.focusedSeconds || 0));
    }
  }
  return [...map.values()]
    .map((entry) => {
      const weight = entry.scoreSeconds.reduce((a, b) => a + b, 0);
      const weighted = weight > 0 ? entry.scores.reduce((a, s, i) => a + s * entry.scoreSeconds[i], 0) / weight : null;
      return {
        subjectId: entry.subjectId,
        name: entry.name,
        color: entry.color,
        focusedSeconds: entry.focusedSeconds,
        sessionCount: entry.sessionCount,
        share: round(ratio(entry.focusedSeconds, total) * 100, 1),
        avgSessionSeconds: entry.sessionCount > 0 ? Math.round(entry.focusedSeconds / entry.sessionCount) : 0,
        averageScore: weighted === null ? null : Math.round(weighted),
      };
    })
    .sort((a, b) => b.focusedSeconds - a.focusedSeconds);
}

/**
 * Distraction histogram with a friendly label per kind.
 * @param {SessionRecord[]} sessions
 * @returns {{total:number, perHour:number, byKind:Array<{kind:string, count:number, share:number}>, topKind:string|null}}
 */
export function distractionBreakdown(sessions) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  let focused = 0;
  for (const session of sessions) {
    focused += session.focusedSeconds || 0;
    for (const [kind, count] of Object.entries(session.distractionKinds ?? {})) {
      counts.set(kind, (counts.get(kind) ?? 0) + count);
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const byKind = [...counts.entries()]
    .map(([kind, count]) => ({ kind, count, share: round(ratio(count, total) * 100, 1) }))
    .sort((a, b) => b.count - a.count);
  return {
    total,
    perHour: focused > 0 ? round((total / focused) * 3600, 2) : 0,
    byKind,
    topKind: byKind[0]?.kind ?? null,
  };
}

/**
 * Consistency + Focus Index for a period.
 *
 *   consistency  = days you met your daily threshold / days elapsed so far
 *   goalPace     = focused seconds / the pro-rata share of the period goal
 *   Focus Index  = 100 × (0.5·consistency + 0.3·goalPace + 0.2·scoreQuality)
 *
 * Kept separate from the per-session Focus Score on purpose: consistency is a
 * property of a *period*, and folding it into individual sessions would let one
 * missed day retroactively rewrite the score of sessions already completed.
 *
 * @param {{
 *   dailySeries: Array<{focusedSeconds:number, goalMet:boolean}>,
 *   elapsedDays: number,
 *   focusedSeconds: number,
 *   periodGoalSeconds: number|null,
 *   sessions: SessionRecord[],
 * }} input
 * @returns {{consistency:number, goalPace:number|null, scoreQuality:number|null, focusIndex:number|null, daysMet:number, daysElapsed:number}}
 */
export function computeFocusIndex(input) {
  const { dailySeries, elapsedDays, focusedSeconds, periodGoalSeconds, sessions } = input;
  const daysElapsed = Math.max(0, elapsedDays);
  const daysMet = dailySeries.filter((d) => d.goalMet).length;
  const consistency = daysElapsed > 0 ? clamp(ratio(daysMet, daysElapsed), 0, 1) : 0;

  const elapsedFraction = periodGoalSeconds && dailySeries.length > 0 ? clamp(ratio(daysElapsed, dailySeries.length), 0, 1) : 1;
  const expected = periodGoalSeconds ? periodGoalSeconds * elapsedFraction : null;
  const goalPace = expected && expected > 0 ? clamp(ratio(focusedSeconds, expected), 0, 1) : null;

  const aggregate = aggregateFocusScore(sessions);
  const scoreQuality = aggregate === null ? null : clamp(aggregate / 100, 0, 1);

  const parts = [
    { weight: 0.5, value: consistency },
    ...(goalPace === null ? [] : [{ weight: 0.3, value: goalPace }]),
    ...(scoreQuality === null ? [] : [{ weight: 0.2, value: scoreQuality }]),
  ];
  const weightSum = parts.reduce((a, p) => a + p.weight, 0);
  const focusIndex = weightSum > 0 ? Math.round((parts.reduce((a, p) => a + p.weight * p.value, 0) / weightSum) * 100) : null;

  return {
    consistency: round(consistency, 4),
    goalPace: goalPace === null ? null : round(goalPace, 4),
    scoreQuality: scoreQuality === null ? null : round(scoreQuality, 4),
    focusIndex,
    daysMet,
    daysElapsed,
  };
}

/**
 * The full summary object the analytics screens render.
 *
 * @param {{
 *   sessions: SessionRecord[],
 *   dayKeys: string[],
 *   timeZone: string,
 *   successThresholdSeconds?: number,
 *   periodGoalSeconds?: number|null,
 *   elapsedDays?: number,
 * }} input
 * @returns {object}
 */
export function summarisePeriod(input) {
  const { sessions, dayKeys, timeZone, successThresholdSeconds = 0, periodGoalSeconds = null, elapsedDays = dayKeys.length } = input;
  const dailySeries = buildDailySeries(sessions, dayKeys, timeZone, { successThresholdSeconds });

  let focusedSeconds = 0;
  let breakSeconds = 0;
  let pausedSeconds = 0;
  let idleSeconds = 0;
  let completedCount = 0;
  let cancelledCount = 0;
  let interruptedCount = 0;
  let longestSessionSeconds = 0;

  for (const session of sessions) {
    focusedSeconds += session.focusedSeconds || 0;
    breakSeconds += session.breakSeconds || 0;
    pausedSeconds += session.pausedSeconds || 0;
    idleSeconds += session.idleSeconds || 0;
    if (session.status === SESSION_STATUS.COMPLETED) completedCount += 1;
    else if (session.status === SESSION_STATUS.CANCELLED) cancelledCount += 1;
    else if (session.status === SESSION_STATUS.INTERRUPTED) interruptedCount += 1;
    longestSessionSeconds = Math.max(longestSessionSeconds, session.focusedSeconds || 0);
  }

  const sessionCount = sessions.length;
  const scoreByDay = new Map();
  for (const day of dailySeries) scoreByDay.set(day.dayKey, day);
  const activeDays = dailySeries.filter((d) => d.focusedSeconds > 0).length;

  const byDayOfWeek = Array.from({ length: 7 }, (_, index) => ({ weekday: index, focusedSeconds: 0, sessionCount: 0 }));
  for (const day of dailySeries) {
    const weekday = weekdayOfKey(day.dayKey);
    byDayOfWeek[weekday].focusedSeconds += day.focusedSeconds;
    byDayOfWeek[weekday].sessionCount += day.sessionCount;
  }

  const bestDay = [...dailySeries].sort((a, b) => b.focusedSeconds - a.focusedSeconds)[0] ?? null;

  return {
    timeZone,
    fromKey: dayKeys[0] ?? null,
    toKey: dayKeys.at(-1) ?? null,
    dayCount: dayKeys.length,
    focusedSeconds,
    breakSeconds,
    pausedSeconds,
    idleSeconds,
    sessionCount,
    completedCount,
    cancelledCount,
    interruptedCount,
    completionRate: sessionCount > 0 ? round(ratio(completedCount, sessionCount), 4) : null,
    averageSessionSeconds: sessionCount > 0 ? Math.round(focusedSeconds / sessionCount) : 0,
    longestSessionSeconds,
    averageDailySeconds: activeDays > 0 ? Math.round(focusedSeconds / Math.max(1, elapsedDays)) : 0,
    activeDays,
    averageFocusScore: aggregateFocusScore(sessions),
    distractions: distractionBreakdown(sessions),
    subjects: subjectBreakdown(sessions),
    dailySeries,
    hourly: hourlyDensity(sessions, timeZone),
    byDayOfWeek,
    bestDay,
    breakToFocusRatio: focusedSeconds > 0 ? round(ratio(breakSeconds, focusedSeconds), 4) : null,
    focusIndex: computeFocusIndex({
      dailySeries,
      elapsedDays,
      focusedSeconds,
      periodGoalSeconds,
      sessions,
    }),
    scoreByDay,
  };
}

/**
 * Compare two period summaries into the "This week / Last week / Change" table.
 * Percentages are `null` when the previous period had no data, because
 * "increased by ∞%" is not an insight.
 *
 * @param {object} current
 * @param {object|null} previous
 * @returns {Array<{key:string,label:string,current:number,previous:number|null,delta:number|null,deltaRatio:number|null,format:'duration'|'count'|'percent'|'score'}>}
 */
export function comparePeriods(current, previous) {
  /**
   * @param {string} key
   * @param {string} label
   * @param {number} now
   * @param {number|null} before
   * @param {'duration'|'count'|'percent'|'score'} format
   */
  const row = (key, label, now, before, format) => ({
    key,
    label,
    current: now,
    previous: before,
    delta: before === null || before === undefined ? null : now - before,
    deltaRatio:
      before === null || before === undefined || before === 0 ? null : round(ratio(now - before, before), 4),
    format,
  });

  const p = previous ?? null;
  return [
    row('focusedSeconds', 'Focus time', current.focusedSeconds, p?.focusedSeconds ?? null, 'duration'),
    row('sessionCount', 'Sessions', current.sessionCount, p?.sessionCount ?? null, 'count'),
    row('averageSessionSeconds', 'Average session', current.averageSessionSeconds, p?.averageSessionSeconds ?? null, 'duration'),
    row('averageDailySeconds', 'Average day', current.averageDailySeconds, p?.averageDailySeconds ?? null, 'duration'),
    row('longestSessionSeconds', 'Longest session', current.longestSessionSeconds, p?.longestSessionSeconds ?? null, 'duration'),
    row('activeDays', 'Active days', current.activeDays, p?.activeDays ?? null, 'count'),
    row('distractions', 'Distractions', current.distractions.total, p?.distractions?.total ?? null, 'count'),
    row('breakSeconds', 'Break time', current.breakSeconds, p?.breakSeconds ?? null, 'duration'),
    row('averageFocusScore', 'Focus score', current.averageFocusScore ?? 0, p?.averageFocusScore ?? null, 'score'),
  ];
}

/**
 * Expand a day key range backwards from `toKey`, used for heatmaps.
 * @param {string} toKey
 * @param {number} days
 * @returns {string[]}
 */
export function trailingDayKeys(toKey, days) {
  const { year, month, day } = parseDayKey(toKey);
  const end = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const fromKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
  return dayKeyRange(fromKey, toKey);
}
