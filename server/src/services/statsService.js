/**
 * Daily rollups and the cockpit's aggregate snapshot.
 *
 * `DailyStats` is a cache, never a source of truth, and it is written by
 * *recomputing a whole day* from sessions rather than by incrementing counters.
 * That choice is what makes the cache safe: because a running timer, a late
 * offline sync, an edit and a deletion all funnel through the same rebuild, the
 * rollup cannot drift out of step with the sessions it describes.
 */

import {
  SEGMENT,
  computeStreak,
  computeWeeklyStreak,
  dayKey,
  dayKeyRange,
  endOfDay,
  startOfDay,
  trailingDayKeys,
} from '@focusforge/core';

import { DailyStats } from '../models/DailyStats.js';
import { FocusSession } from '../models/FocusSession.js';
import { logger } from '../utils/logger.js';

import { SESSION_ANALYTICS_PROJECTION, toSessionRecord } from './sessionMapper.js';
import { nameAndColorMap } from './subjectService.js';
import { todayKey } from './support.js';

/** A session cannot plausibly overlap a day from more than a day earlier. */
const MAX_SESSION_MS = 24 * 3600_000;

/** Longest window a streak is ever computed over. */
const STREAK_WINDOW_DAYS = 400;

/**
 * Every closed session whose segments touch a given local day.
 *
 * The database narrows the candidates through the `{user, startTime}` index; the
 * exact overlap test then happens on the day keys the segments actually span, so
 * a session crossing midnight is returned for both of the days it covers.
 *
 * @param {any} userId
 * @param {string} key
 * @param {string} timeZone
 */
async function sessionsTouchingDay(userId, key, timeZone) {
  const from = new Date(startOfDay(key, timeZone).getTime() - MAX_SESSION_MS);
  const to = endOfDay(key, timeZone);

  const candidates = /** @type {any[]} */ (await FocusSession.find({
    user: userId,
    status: { $nin: ['running', 'paused'] },
    startTime: { $gte: from, $lte: to },
  })
    .select(SESSION_ANALYTICS_PROJECTION)
    .lean());

  return candidates.filter((session) =>
    (session.segments ?? []).some((segment) => {
      if (!segment.to) return false;
      const start = new Date(segment.from);
      const end = new Date(segment.to);
      const dayStart = startOfDay(key, timeZone);
      const dayEnd = endOfDay(key, timeZone);
      return start <= dayEnd && end >= dayStart;
    }),
  );
}

/**
 * Rebuild one day's rollup from the sessions that touched it. Idempotent: running
 * it twice produces the same document.
 *
 * @param {any} userId
 * @param {string} key
 * @param {{timeZone: string, successThresholdSeconds: number}} context
 */
export async function recomputeDay(userId, key, context) {
  const { timeZone, successThresholdSeconds } = context;
  const sessions = await sessionsTouchingDay(userId, key, timeZone);

  if (sessions.length === 0) {
    // Remove rather than store a zero row: an absent day and a zero day are the
    // same thing to every consumer, and not storing it keeps the collection small.
    await DailyStats.deleteOne({ user: userId, dayKey: key });
    return null;
  }

  const records = sessions.map((session) => toSessionRecord(session));

  let focusedSeconds = 0;
  let breakSeconds = 0;
  let distractionCount = 0;
  let completedCount = 0;
  /** @type {Map<string, number>} */
  const subjectSeconds = new Map();
  let weightedScore = 0;
  let scoreWeight = 0;
  let firstStartAt = null;
  let lastEndAt = null;

  const dayStart = startOfDay(key, timeZone).getTime();
  const dayEnd = endOfDay(key, timeZone).getTime();

  for (const record of records) {
    distractionCount += record.distractionCount;
    if (record.focusScore !== null) {
      const weight = Math.max(1, record.focusedSeconds);
      weightedScore += record.focusScore * weight;
      scoreWeight += weight;
    }
    if (record.status === 'completed') completedCount += 1;
    if (record.startTimeMs !== null && (firstStartAt === null || record.startTimeMs < firstStartAt)) {
      firstStartAt = record.startTimeMs;
    }
    if (record.endTimeMs !== null && (lastEndAt === null || record.endTimeMs > lastEndAt)) {
      lastEndAt = record.endTimeMs;
    }

    // Only the part of each segment that falls inside this day counts.
    for (const segment of record.segments) {
      if (!segment.to || segment.kind === SEGMENT.PAUSED || segment.kind === SEGMENT.IDLE) continue;
      const from = Math.max(segment.from, dayStart);
      const to = Math.min(segment.to, dayEnd);
      if (to <= from) continue;
      const seconds = Math.round((to - from) / 1000);
      if (segment.kind === SEGMENT.FOCUS) {
        focusedSeconds += seconds;
        if (record.subjectId) {
          subjectSeconds.set(record.subjectId, (subjectSeconds.get(record.subjectId) ?? 0) + seconds);
        }
      } else if (segment.kind === SEGMENT.BREAK) {
        breakSeconds += seconds;
      }
    }
  }

  const doc = {
    user: userId,
    dayKey: key,
    timeZone,
    focusedSeconds,
    breakSeconds,
    sessionCount: records.length,
    completedCount,
    distractionCount,
    subjectSeconds,
    averageFocusScore: scoreWeight > 0 ? Math.round(weightedScore / scoreWeight) : null,
    firstStartAt: firstStartAt === null ? null : new Date(firstStartAt),
    lastEndAt: lastEndAt === null ? null : new Date(lastEndAt),
    goalMet: focusedSeconds >= Math.max(1, successThresholdSeconds),
  };

  return DailyStats.findOneAndUpdate(
    { user: userId, dayKey: key },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Rebuild several days. Used after any write that can change history — a session
 * closing, an event being appended late, or a session being deleted.
 *
 * @param {any} userId
 * @param {Iterable<string>} dayKeys
 * @param {{timeZone: string, successThresholdSeconds: number}} context
 */
export async function recomputeDays(userId, dayKeys, context) {
  const unique = [...new Set(dayKeys)].filter(Boolean);
  if (unique.length === 0) return 0;
  // Sequential rather than parallel: these are upserts on the same collection and
  // a personal account rarely touches more than a day or two at a time.
  for (const key of unique) {
    await recomputeDay(userId, key, context);
  }
  return unique.length;
}

/**
 * The day keys a session can possibly affect, in the user's timezone.
 *
 * @param {any} session a saved `FocusSession`
 * @param {string} timeZone
 * @returns {string[]}
 */
export function affectedDayKeys(session, timeZone) {
  const keys = new Set();
  for (const segment of session.segments ?? []) {
    if (!segment.from) continue;
    keys.add(dayKey(segment.from, timeZone));
    if (segment.to) keys.add(dayKey(segment.to, timeZone));
  }
  if (keys.size === 0 && session.startTime) keys.add(dayKey(session.startTime, timeZone));
  return [...keys];
}

/**
 * Read the cached rollups for a range, rebuilding them when the cache cannot be
 * trusted.
 *
 * Two cases force a rebuild, and both are correctness issues rather than
 * performance ones:
 *
 *   - **The cache is cold but sessions exist.** A user whose history predates this
 *     collection, or whose data was imported, would otherwise be told their
 *     streak is zero. Showing nothing is bad; showing *wrong* is worse.
 *   - **The user changed timezone.** Cached rows carry the zone they were computed
 *     in. Reusing them would quietly re-bucket history into a day layout that no
 *     longer applies, so rows from another zone are discarded and rebuilt.
 *
 * @param {any} userId
 * @param {{fromKey: string, toKey: string, timeZone: string, successThresholdSeconds: number}} options
 * @returns {Promise<Map<string, any>>}
 */
export async function ensureRollups(userId, options) {
  const { fromKey, toKey, timeZone, successThresholdSeconds } = options;

  const staleTimezoneCount = await DailyStats.countDocuments({
    user: userId,
    dayKey: { $gte: fromKey, $lte: toKey },
    timeZone: { $ne: timeZone },
  });

  if (staleTimezoneCount > 0) {
    logger.info('Timezone changed — rebuilding daily rollups', { userId: String(userId), rows: staleTimezoneCount });
    await DailyStats.deleteMany({ user: userId, dayKey: { $gte: fromKey, $lte: toKey }, timeZone: { $ne: timeZone } });
  }

  let rows = /** @type {any[]} */ (await DailyStats.find({ user: userId, dayKey: { $gte: fromKey, $lte: toKey }, timeZone }).lean());

  if (rows.length === 0) {
    const hasSessions =
      (await FocusSession.exists({
        user: userId,
        status: { $nin: ['running', 'paused'] },
        startTime: { $gte: startOfDay(fromKey, timeZone), $lte: endOfDay(toKey, timeZone) },
      })) !== null;

    if (hasSessions) {
      const series = await backfill(userId, { fromKey, toKey, timeZone, successThresholdSeconds });
      rows = series;
    }
  }

  return new Map(rows.map((row) => [row.dayKey, row]));
}

/**
 * Load the trailing daily series, dense across every day in the window.
 *
 * @param {any} userId
 * @param {{timeZone: string, successThresholdSeconds: number, days?: number, nowKey?: string}} context
 * @returns {Promise<Array<{dayKey: string, focusedSeconds: number, breakSeconds: number, sessionCount: number, completedCount: number, distractionCount: number, goalMet: boolean}>>}
 */
export async function trailingSeries(userId, context) {
  const { timeZone, successThresholdSeconds, days = STREAK_WINDOW_DAYS, nowKey } = context;
  const toKey = nowKey ?? todayKey(timeZone);
  const keys = trailingDayKeys(toKey, days);

  const byKey = await ensureRollups(userId, {
    fromKey: keys[0],
    toKey,
    timeZone,
    successThresholdSeconds,
  });

  return buildDailySeriesFromRollups(keys, byKey, successThresholdSeconds);
}

/**
 * Rebuild every day in a range directly from sessions. Used once when the cache
 * is cold, and by the seed script.
 *
 * @param {any} userId
 * @param {{fromKey: string, toKey: string, timeZone: string, successThresholdSeconds: number}} options
 */
export async function backfill(userId, options) {
  const { fromKey, toKey, timeZone, successThresholdSeconds } = options;
  const keys = dayKeyRange(fromKey, toKey);

  const byKey = new Map();
  // One pass over the range's sessions instead of one query per day.
  const sessions = /** @type {any[]} */ (await FocusSession.find({
    user: userId,
    status: { $nin: ['running', 'paused'] },
    startTime: { $gte: new Date(startOfDay(fromKey, timeZone).getTime() - MAX_SESSION_MS), $lte: endOfDay(toKey, timeZone) },
  })
    .select(SESSION_ANALYTICS_PROJECTION)
    .lean());

  for (const key of keys) {
    const dayStart = startOfDay(key, timeZone).getTime();
    const dayEnd = endOfDay(key, timeZone).getTime();

    let focusedSeconds = 0;
    let breakSeconds = 0;
    let distractionCount = 0;
    let completedCount = 0;
    let sessionCount = 0;
    let weightedScore = 0;
    let scoreWeight = 0;

    for (const session of sessions) {
      let touches = false;
      for (const segment of session.segments ?? []) {
        if (!segment.to) continue;
        const from = new Date(segment.from).getTime();
        const to = new Date(segment.to).getTime();
        if (from > dayEnd || to < dayStart) continue;
        touches = true;
        if (segment.kind === SEGMENT.PAUSED || segment.kind === SEGMENT.IDLE) continue;
        const overlap = Math.max(0, Math.round((Math.min(to, dayEnd) - Math.max(from, dayStart)) / 1000));
        if (segment.kind === SEGMENT.FOCUS) focusedSeconds += overlap;
        else if (segment.kind === SEGMENT.BREAK) breakSeconds += overlap;
      }
      if (!touches) continue;
      sessionCount += 1;
      distractionCount += session.distractionCount ?? 0;
      if (session.status === 'completed') completedCount += 1;
      if (session.focusScore !== null && session.focusScore !== undefined) {
        const weight = Math.max(1, session.focusedSeconds ?? 0);
        weightedScore += session.focusScore * weight;
        scoreWeight += weight;
      }
    }

    if (sessionCount === 0) continue;
    const row = {
      dayKey: key,
      focusedSeconds,
      breakSeconds,
      sessionCount,
      completedCount,
      distractionCount,
      averageFocusScore: scoreWeight > 0 ? Math.round(weightedScore / scoreWeight) : null,
      goalMet: focusedSeconds >= Math.max(1, successThresholdSeconds),
    };
    byKey.set(key, row);
  }

  if (byKey.size > 0) {
    await DailyStats.bulkWrite(
      [...byKey.values()].map((row) => ({
        updateOne: {
          filter: { user: userId, dayKey: row.dayKey },
          update: { $set: { ...row, user: userId, timeZone } },
          upsert: true,
        },
      })),
    );
  }

  return buildDailySeriesFromRollups(keys, byKey, successThresholdSeconds);
}

/**
 * @param {string[]} keys
 * @param {Map<string, any>} byKey
 * @param {number} successThresholdSeconds
 */
function buildDailySeriesFromRollups(keys, byKey, successThresholdSeconds) {
  return keys.map((key) => {
    const row = byKey.get(key);
    const focused = row?.focusedSeconds ?? 0;
    return {
      dayKey: key,
      focusedSeconds: focused,
      breakSeconds: row?.breakSeconds ?? 0,
      sessionCount: row?.sessionCount ?? 0,
      completedCount: row?.completedCount ?? 0,
      distractionCount: row?.distractionCount ?? 0,
      averageFocusScore: row?.averageFocusScore ?? null,
      goalMet: focused >= Math.max(1, successThresholdSeconds),
    };
  });
}

/**
 * Streak state for a user, derived from the cached daily series.
 *
 * @param {any} userId
 * @param {{timeZone: string, successThresholdSeconds: number, weekStart: number, nowKey?: string}} context
 */
export async function streakState(userId, context) {
  const series = await trailingSeries(userId, context);
  const nowKey = context.nowKey ?? todayKey(context.timeZone);

  return {
    daily: computeStreak(series, { todayKey: nowKey, successThresholdSeconds: context.successThresholdSeconds }),
    weekly: computeWeeklyStreak(series, {
      todayKey: nowKey,
      weekStart: context.weekStart,
      successThresholdSeconds: context.successThresholdSeconds,
      minDaysPerWeek: 4,
    }),
  };
}

/**
 * The cockpit snapshot: everything the first screen needs, in one round trip.
 *
 * Deliberately one endpoint rather than six. The cockpit is the app's home; on a
 * cold load, six parallel requests each pay connection and TLS overhead, and the
 * UI has to coordinate six loading states before it can render anything.
 *
 * @param {any} userId
 * @param {any} settings
 * @param {{
 *   subjects: Map<string, {name: string, color: string}>,
 *   nextTask: any,
 *   dueSoon: any[],
 *   openRecord: any|null,
 *   range?: {limit: number, total: number},
 * }} context
 */
export async function overview(userId, settings, context) {
  const timeZone = settings.timeZone;
  const nowKey = todayKey(timeZone);
  const contextForRollups = {
    timeZone,
    successThresholdSeconds: settings.successThresholdSeconds,
  };

  const series = await trailingSeries(userId, { ...contextForRollups, days: 60, nowKey });
  const today = series.find((day) => day.dayKey === nowKey) ?? {
    dayKey: nowKey,
    focusedSeconds: 0,
    breakSeconds: 0,
    sessionCount: 0,
    completedCount: 0,
    distractionCount: 0,
    goalMet: false,
  };

  // The trailing seven local days, ending today.
  const weekSeries = series.slice(-7);
  const weekKeys = weekSeries.map((day) => day.dayKey);

  const streaks = await streakState(userId, { ...contextForRollups, weekStart: settings.weekStart, nowKey });

  const recent = await FocusSession.find({ user: userId, status: { $nin: ['running', 'paused'] } })
    .sort({ startTime: -1 })
    .limit(6)
    .select(SESSION_ANALYTICS_PROJECTION)
    .lean();

  const subjects = await nameAndColorMap(userId);
  // Already mapped by the caller, so the live session is read once and not
  // re-derived per endpoint.
  const openRecord = context.openRecord ?? null;

  // Today's headline number must include the session in progress, otherwise the
  // cockpit looks frozen while the timer is running.
  const liveSeconds = openRecord && openRecord.dayKey === nowKey ? openRecord.focusedSeconds : 0;

  return {
    timeZone,
    nowKey,
    today: {
      ...today,
      /** Closed-session total plus the live session's seconds-so-far. */
      focusedSeconds: today.focusedSeconds + liveSeconds,
      liveSeconds,
      goalSeconds: settings.dailyGoalSeconds,
      goalProgress: settings.dailyGoalSeconds > 0 ? Math.min(1, (today.focusedSeconds + liveSeconds) / settings.dailyGoalSeconds) : 0,
      remainingSeconds: Math.max(0, settings.dailyGoalSeconds - today.focusedSeconds - liveSeconds),
    },
    week: {
      keys: weekKeys,
      focusedSeconds: weekSeries.reduce((total, day) => total + day.focusedSeconds, 0),
      series: weekSeries,
      /** A weekly target is expressed as seven daily goals. */
      goalSeconds: settings.dailyGoalSeconds * 7,
    },
    streak: streaks,
    openSession: openRecord,
    recentSessions: recent.map((session) => toSessionRecord(session, subjects)),
    subjects: [...subjects.entries()].map(([id, subject]) => ({ id, ...subject })),
    nextTask: context.nextTask
      ? {
          id: String(context.nextTask._id),
          title: context.nextTask.title,
          subjectId: String(context.nextTask.subject),
          priority: context.nextTask.priority,
          estimatedDuration: context.nextTask.estimatedDuration,
          dueAt: context.nextTask.dueAt ? context.nextTask.dueAt.toISOString() : null,
          status: context.nextTask.status,
        }
      : null,
    dueSoon: (context.dueSoon ?? []).map((task) => ({
      id: String(task._id),
      title: task.title,
      subjectId: String(task.subject),
      dueAt: task.dueAt ? task.dueAt.toISOString() : null,
      priority: task.priority,
    })),
    activity: context.range ?? null,
    generatedAt: new Date().toISOString(),
  };
}
