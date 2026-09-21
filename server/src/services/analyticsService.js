/**
 * Analytics service.
 *
 * Three rules shape this file:
 *
 *   1. **One derivation path.** Every figure is produced by the same
 *      `@focusforge/core` functions the browser uses. There is no Mongo
 *      aggregation that re-implements day bucketing, because a second
 *      implementation of local-day logic would eventually disagree with the
 *      first — and the two screens showing different numbers for the same week is
 *      the fastest way to lose a user's trust.
 *
 *   2. **The bars must add up to the headline.** Period totals are reconciled
 *      against the daily series rather than summed from whole sessions. A session
 *      that crosses midnight is genuinely split across two days, so summing whole
 *      sessions into a week would make the bars fail to reach the total. Deriving
 *      the total from the bars guarantees the two always agree.
 *
 *   3. **Not enough data is an answer.** Thin windows produce an explicit
 *      "not enough data yet" insight instead of a confident claim built on two
 *      sessions.
 */

import {
  buildPeriod,
  comparePeriods,
  generateInsights,
  headlineInsight,
  summarisePeriod,
  trailingDayKeys,
} from '@focusforge/core';

import { DailyStats } from '../models/DailyStats.js';
import { FocusSession } from '../models/FocusSession.js';
import { ApiError } from '../utils/ApiError.js';

import * as goalService from './goalService.js';
import { SESSION_ANALYTICS_PROJECTION, toSessionRecord } from './sessionMapper.js';
import { ensureRollups, streakState } from './statsService.js';
import { nameAndColorMap } from './subjectService.js';
import { todayKey } from './support.js';

/**
 * The target a window of N days is measured against.
 *
 * A period has no goal of its own — a user sets a *daily* goal — so a week's
 * target is seven daily goals. Deriving it here rather than storing a second
 * number means changing the daily goal cannot leave the weekly bar stale.
 *
 * @param {{dailyGoalSeconds: number}} settings
 * @param {number} dayCount
 * @returns {number}
 */
function periodGoalSeconds(settings, dayCount) {
  return Math.max(0, settings.dailyGoalSeconds) * dayCount;
}

/** A session cannot plausibly overlap a window from more than a day earlier. */
const MAX_SESSION_MS = 24 * 3600_000;
/** Guards against a hand-typed URL asking for a decade of analysis. */
const MAX_RANGE_DAYS = 800;

/**
 * Load every closed session whose window overlaps `[from, to]`.
 *
 * @param {any} userId
 * @param {Date} from
 * @param {Date} to
 * @param {{subjectId?: string|null}} [options]
 */
async function loadRecords(userId, from, to, options = {}) {
  /** @type {Record<string, any>} */
  const filter = {
    user: userId,
    status: { $nin: ['running', 'paused'] },
    // Overlap, not containment: a session that starts the previous evening and
    // runs past midnight belongs to both windows. The lookback is bounded by the
    // index range, so this stays a single index scan.
    startTime: { $gte: new Date(from.getTime() - MAX_SESSION_MS), $lte: to },
  };
  if (options.subjectId) filter.subject = options.subjectId;

  const [documents, subjects] = await Promise.all([
    FocusSession.find(filter).select(SESSION_ANALYTICS_PROJECTION).sort({ startTime: 1 }).lean(),
    nameAndColorMap(userId),
  ]);

  return documents
    .map((document) => toSessionRecord(document, subjects))
    .filter((record) => {
      if (record.endTimeMs === null) return false;
      return record.endTimeMs >= from.getTime() && record.startTimeMs <= to.getTime();
    });
}

/**
 * Sessions whose *start* falls inside the window. Used for counting, where
 * attributing a straddling session to both weeks would inflate the totals.
 * @param {any[]} records
 * @param {Date} from
 * @param {Date} to
 */
function startedWithin(records, from, to) {
  return records.filter((record) => record.startTimeMs !== null && record.startTimeMs >= from.getTime() && record.startTimeMs <= to.getTime());
}

/**
 * Reconcile the headline totals with the daily series so the bars always add up
 * to the number printed above them.
 *
 * @param {any} summary
 */
function reconcileTotals(summary) {
  const focusedSeconds = summary.dailySeries.reduce((total, day) => total + day.focusedSeconds, 0);
  const breakSeconds = summary.dailySeries.reduce((total, day) => total + day.breakSeconds, 0);
  return {
    ...summary,
    /** Sum of in-window segments, which is what the bars show. */
    focusedSeconds,
    breakSeconds,
    /** Retained for transparency: the sum of whole sessions in the window. */
    rawSessionSeconds: summary.focusedSeconds,
  };
}

/**
 * Build a full summary for a period, plus the comparison, goals and insights the
 * analytics screens need.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{period?: 'day'|'week'|'month'|'year', reference?: Date, weekStart?: number, compare?: boolean, subjectId?: string|null, timeZone?: string}} query
 */
export async function periodSummary(user, settings, query = {}) {
  const kind = query.period ?? 'week';
  const timeZone = query.timeZone ?? settings.timeZone;
  const weekStart = query.weekStart ?? settings.weekStart;
  const reference = query.reference ?? new Date();

  const current = buildPeriod(kind, { reference, timeZone, weekStart });
  if (current.dayKeys.length > MAX_RANGE_DAYS) {
    throw ApiError.badRequest(`That range covers more than ${MAX_RANGE_DAYS} days.`);
  }

  const from = new Date(current.from);
  const to = new Date(current.to);
  const previous = buildPeriod(kind, {
    reference: new Date(Date.parse(`${current.previous.fromKey}T12:00:00Z`)),
    timeZone,
    weekStart,
  });

  const [records, previousRecords, goals, streak] = await Promise.all([
    loadRecords(user._id, from, to, { subjectId: query.subjectId }),
    query.compare === false ? Promise.resolve([]) : loadRecords(user._id, new Date(previous.from), new Date(previous.to), { subjectId: query.subjectId }),
    goalService.evaluate(user._id, settings, { reference }),
    streakState(user._id, { timeZone, successThresholdSeconds: settings.successThresholdSeconds, weekStart }),
  ]);

  const inWindow = startedWithin(records, from, to);
  const previousInWindow = startedWithin(previousRecords, new Date(previous.from), new Date(previous.to));

  const summary = reconcileTotals(
    summarisePeriod({
      sessions: inWindow,
      dayKeys: current.dayKeys,
      timeZone,
      successThresholdSeconds: settings.successThresholdSeconds,
      periodGoalSeconds: periodGoalSeconds(settings, current.dayKeys.length),
      elapsedDays: elapsedDaysInWindow(current, timeZone),
    }),
  );

  const previousSummary =
    query.compare === false
      ? null
      : reconcileTotals(
          summarisePeriod({
            sessions: previousInWindow,
            dayKeys: previous.dayKeys,
            timeZone,
            successThresholdSeconds: settings.successThresholdSeconds,
          }),
        );

  const insights = generateInsights({
    current: summary,
    previous: previousSummary,
    streak: streak.daily,
    goals: goals.goals,
    nowKey: todayKey(timeZone),
    dailyGoalSeconds: settings.dailyGoalSeconds,
  });

  return {
    period: current,
    previousPeriod: previous,
    timeZone,
    summary,
    previous: previousSummary,
    comparison: comparePeriods(summary, previousSummary),
    goals: goals.goals,
    goalStatus: goals.status,
    streak,
    insights,
    headline: headlineInsight(insights),
    sessions: inWindow.map(toPublicAnalyticsSession),
    /** Raw segments for the focus timeline. */
    timeline: buildTimeline(records, from, to),
  };
}

/** @param {any} period @param {string} timeZone */
function elapsedDaysInWindow(period, timeZone) {
  const today = todayKey(timeZone);
  if (today < period.fromKey) return 0;
  if (today >= period.toKey) return period.dayKeys.length;
  let count = 0;
  for (const key of period.dayKeys) {
    count += 1;
    if (key === today) break;
  }
  return count;
}

/** A light session shape for the history list and timeline. */
function toPublicAnalyticsSession(record) {
  return {
    id: record.id,
    subjectId: record.subjectId,
    subjectName: record.subjectName,
    subjectColor: record.subjectColor,
    taskId: record.taskId,
    taskTitle: record.taskTitle,
    status: record.status,
    kind: record.kind,
    startTime: record.startTimeMs === null ? null : new Date(record.startTimeMs).toISOString(),
    endTime: record.endTimeMs === null ? null : new Date(record.endTimeMs).toISOString(),
    focusedSeconds: record.focusedSeconds,
    breakSeconds: record.breakSeconds,
    pausedSeconds: record.pausedSeconds,
    idleSeconds: record.idleSeconds,
    plannedSeconds: record.plannedSeconds,
    focusScore: record.focusScore,
    focusScoreBreakdown: record.focusScoreBreakdown,
    pauseCount: record.pauseCount,
    distractionCount: record.distractionCount,
    distractionKinds: record.distractionKinds,
    device: record.device,
    interruptedReason: record.interruptedReason,
    reflection: record.reflection,
  };
}

/**
 * The day as a sequence of labelled blocks: work, break, pause.
 *
 * Clipped to the requested window so a session spanning midnight contributes a
 * block that ends at midnight, rather than a bar that appears to overflow the day.
 *
 * @param {any[]} records
 * @param {Date} from
 * @param {Date} to
 */
function buildTimeline(records, from, to) {
  /** @type {any[]} */
  const blocks = [];
  for (const record of records) {
    for (const segment of record.segments) {
      if (!segment.to) continue;
      const start = Math.max(segment.from, from.getTime());
      const end = Math.min(segment.to, to.getTime());
      if (end <= start) continue;
      blocks.push({
        sessionId: record.id,
        kind: segment.kind,
        from: new Date(start).toISOString(),
        to: new Date(end).toISOString(),
        seconds: Math.round((end - start) / 1000),
        subjectId: record.subjectId,
        subjectName: record.subjectName,
        subjectColor: record.subjectColor,
        taskTitle: record.taskTitle,
      });
    }
  }
  return blocks.sort((a, b) => (a.from < b.from ? -1 : 1));
}

/**
 * Heatmap data: one row per local day, ready to render as a GitHub-style grid.
 *
 * Read from the cached rollups rather than folded from sessions, because a year
 * view is the one place where folding on every render would be genuinely
 * wasteful. The cache is recomputed from sessions, so it is still the same
 * numbers.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{days?: number, timeZone?: string, subjectId?: string|null}} query
 */
export async function heatmap(user, settings, query = {}) {
  const timeZone = query.timeZone ?? settings.timeZone;
  const days = Math.min(query.days ?? 365, 730);
  const toKey = todayKey(timeZone);
  const keys = trailingDayKeys(toKey, days);

  const byKey = await ensureRollups(user._id, {
    fromKey: keys[0],
    toKey,
    timeZone,
    successThresholdSeconds: settings.successThresholdSeconds,
  });

  const maxSeconds = Math.max(
    1,
    ...[...byKey.values()].map((row) =>
      query.subjectId ? Number((row.subjectSeconds instanceof Map ? row.subjectSeconds.get(query.subjectId) : row.subjectSeconds?.[query.subjectId]) ?? 0) : row.focusedSeconds,
    ),
  );

  const cells = keys.map((key) => {
    const row = byKey.get(key);
    const subjectSeconds = row?.subjectSeconds instanceof Map ? row.subjectSeconds : new Map(Object.entries(row?.subjectSeconds ?? {}));
    const focusedSeconds = query.subjectId ? Number(subjectSeconds.get(query.subjectId) ?? 0) : row?.focusedSeconds ?? 0;
    return {
      dayKey: key,
      focusedSeconds,
      breakSeconds: row?.breakSeconds ?? 0,
      sessionCount: row?.sessionCount ?? 0,
      completedCount: row?.completedCount ?? 0,
      distractionCount: row?.distractionCount ?? 0,
      averageFocusScore: row?.averageFocusScore ?? null,
      goalMet: focusedSeconds >= settings.successThresholdSeconds,
      /** 0..1 relative to the busiest day in the window — the visual intensity. */
      intensity: maxSeconds > 0 ? Math.round((focusedSeconds / maxSeconds) * 1000) / 1000 : 0,
    };
  });

  const totalSeconds = cells.reduce((total, cell) => total + cell.focusedSeconds, 0);
  const activeDays = cells.filter((cell) => cell.focusedSeconds > 0).length;

  return {
    timeZone,
    fromKey: keys[0],
    toKey,
    days,
    subjectId: query.subjectId ?? null,
    maxSeconds,
    totalSeconds,
    activeDays,
    /** Busiest day in the window, for the summary line above the grid. */
    peakDay: cells.reduce((best, cell) => (cell.focusedSeconds > (best?.focusedSeconds ?? 0) ? cell : best), null),
    cells,
  };
}

/**
 * A month laid out as weeks, for the calendar view.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{month?: string, timeZone?: string, subjectId?: string|null}} query
 */
export async function calendar(user, settings, query = {}) {
  const timeZone = query.timeZone ?? settings.timeZone;
  const anchor = query.month ? `${query.month}-01` : todayKey(timeZone);
  const period = buildPeriod('month', { reference: new Date(`${anchor}T12:00:00Z`), timeZone, weekStart: settings.weekStart });

  const byKey = await ensureRollups(user._id, {
    fromKey: period.fromKey,
    toKey: period.toKey,
    timeZone,
    successThresholdSeconds: settings.successThresholdSeconds,
  });

  const days = period.dayKeys.map((key) => {
    const row = byKey.get(key);
    const subjectSeconds = row?.subjectSeconds instanceof Map ? row.subjectSeconds : new Map(Object.entries(row?.subjectSeconds ?? {}));
    const focusedSeconds = query.subjectId ? Number(subjectSeconds.get(query.subjectId) ?? 0) : row?.focusedSeconds ?? 0;
    return {
      dayKey: key,
      focusedSeconds,
      sessionCount: row?.sessionCount ?? 0,
      distractionCount: row?.distractionCount ?? 0,
      averageFocusScore: row?.averageFocusScore ?? null,
      goalMet: focusedSeconds >= settings.successThresholdSeconds,
      subjects: [...subjectSeconds.entries()].map(([subjectId, seconds]) => ({ subjectId: String(subjectId), seconds })),
    };
  });

  // Pad to whole weeks so the grid never starts mid-row.
  const firstWeekday = new Date(`${days[0].dayKey}T00:00:00Z`).getUTCDay();
  const lead = (firstWeekday - settings.weekStart + 7) % 7;

  return {
    timeZone,
    month: period.fromKey.slice(0, 7),
    label: period.label,
    fromKey: period.fromKey,
    toKey: period.toKey,
    weekStart: settings.weekStart,
    lead,
    days,
    totalSeconds: days.reduce((total, day) => total + day.focusedSeconds, 0),
    previousMonth: period.previous.fromKey.slice(0, 7),
    nextMonth: period.next.fromKey.slice(0, 7),
  };
}

/**
 * Everything recorded on one local day: totals, sessions, subjects, timeline and
 * the distraction breakdown.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{day?: string, timeZone?: string}} query
 */
export async function dayDetail(user, settings, query = {}) {
  const timeZone = query.timeZone ?? settings.timeZone;
  const key = query.day ?? todayKey(timeZone);
  const period = buildPeriod('day', { reference: new Date(`${key}T12:00:00Z`), timeZone, weekStart: settings.weekStart });

  const [records, rollupRows, streak] = await Promise.all([
    loadRecords(user._id, new Date(period.from), new Date(period.to)),
    DailyStats.find({ user: user._id, dayKey: key, timeZone }).lean(),
    streakState(user._id, { timeZone, successThresholdSeconds: settings.successThresholdSeconds, weekStart: settings.weekStart }),
  ]);

  const inWindow = startedWithin(records, new Date(period.from), new Date(period.to));
  const summary = reconcileTotals(
    summarisePeriod({
      sessions: inWindow,
      dayKeys: [key],
      timeZone,
      successThresholdSeconds: settings.successThresholdSeconds,
    }),
  );

  const rollup = rollupRows[0];
  const subjectSeconds = rollup?.subjectSeconds instanceof Map ? Object.fromEntries(rollup.subjectSeconds) : rollup?.subjectSeconds ?? {};

  return {
    dayKey: key,
    timeZone,
    label: period.label,
    /** Segment-accurate, so it agrees with the heatmap cell for this day. */
    focusedSeconds: summary.dailySeries[0]?.focusedSeconds ?? 0,
    breakSeconds: summary.dailySeries[0]?.breakSeconds ?? 0,
    sessionCount: inWindow.length,
    completedCount: inWindow.filter((record) => record.status === 'completed').length,
    interruptedCount: inWindow.filter((record) => record.status === 'interrupted').length,
    distractionCount: inWindow.reduce((total, record) => total + record.distractionCount, 0),
    longestSessionSeconds: summary.longestSessionSeconds,
    averageFocusScore: summary.averageFocusScore,
    goalMet: (summary.dailySeries[0]?.focusedSeconds ?? 0) >= settings.successThresholdSeconds,
    subjects: summary.subjects,
    subjectSeconds,
    distractions: summary.distractions,
    hourly: summary.hourly,
    sessions: inWindow.map(toPublicAnalyticsSession),
    timeline: buildTimeline(records, new Date(period.from), new Date(period.to)),
    streak: streak.daily,
    previousDay: period.previous.fromKey,
    nextDay: period.next.fromKey,
  };
}

/**
 * The end-of-day review.
 *
 * Factual and non-judgemental by construction: every line is a measurement, and
 * the prompts are questions rather than verdicts.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{day?: string}} [query]
 */
export async function dailyReview(user, settings, query = {}) {
  const detail = await dayDetail(user, settings, query);
  const goals = await goalService.evaluate(user._id, settings, {
    reference: new Date(`${detail.dayKey}T12:00:00Z`),
  });

  const dailyGoal = goals.goals.find((goal) => goal.period === 'daily' && !goal.subjectId) ?? null;

  return {
    ...detail,
    dailyGoal,
    /** Deterministic observations, ordered by how much they matter. */
    observations: buildDailyObservations(detail, dailyGoal),
    prompts: [
      'What went well today?',
      'What got in the way?',
      'What will you start with tomorrow?',
    ],
  };
}

/** @param {any} detail @param {any} dailyGoal */
function buildDailyObservations(detail, dailyGoal) {
  /** @type {Array<{id: string, tone: string, text: string}>} */
  const observations = [];

  if (detail.sessionCount === 0) {
    return [
      {
        id: 'empty-day',
        tone: 'info',
        text: 'Nothing recorded on this day. If you studied without the timer running, that time is not in here.',
      },
    ];
  }

  if (dailyGoal) {
    observations.push({
      id: 'goal',
      tone: dailyGoal.isMet ? 'positive' : 'neutral',
      text: dailyGoal.message,
    });
  }

  if (detail.longestSessionSeconds > 0) {
    observations.push({
      id: 'longest',
      tone: 'neutral',
      text: `Your longest block was ${formatShort(detail.longestSessionSeconds)}.`,
    });
  }

  const topSubject = detail.subjects[0];
  if (topSubject) {
    observations.push({
      id: 'top-subject',
      tone: 'neutral',
      text: `${topSubject.name} took ${Math.round(topSubject.share)}% of the day.`,
    });
  }

  if (detail.interruptedCount > 0) {
    observations.push({
      id: 'interrupted',
      tone: 'info',
      text: `${detail.interruptedCount} session${detail.interruptedCount === 1 ? '' : 's'} ended without being completed. Idle time is excluded from your totals either way.`,
    });
  }

  if (detail.distractionCount > 0) {
    observations.push({
      id: 'distractions',
      tone: 'info',
      text: `${detail.distractionCount} distraction${detail.distractionCount === 1 ? '' : 's'} logged.`,
    });
  }

  if (detail.breakSeconds > 0) {
    observations.push({
      id: 'breaks',
      tone: 'info',
      text: `${formatShort(detail.breakSeconds)} of breaks against ${formatShort(detail.focusedSeconds)} of focus.`,
    });
  }

  return observations;
}

/**
 * The weekly review: this week against last week, plus factual observations.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{reference?: Date, timeZone?: string}} [query]
 */
export async function weeklyReview(user, settings, query = {}) {
  const summary = await periodSummary(user, settings, { period: 'week', ...query });

  const observations = [];
  for (const row of summary.comparison) {
    if (row.delta === null) continue;
    if (row.format === 'duration' && Math.abs(row.delta) < 300) continue;
    if (row.format === 'percent' && Math.abs(row.delta) < 0.05) continue;
    if (row.format === 'score' && Math.abs(row.delta) < 3) continue;
    if (row.format === 'count' && row.delta === 0) continue;
    observations.push(row);
  }

  // What to carry forward, derived from the same data rather than invented.
  const carryForward = summary.insights.filter((insight) => insight.tone === 'nudge' || insight.id === 'peak-window').slice(0, 3);

  return {
    period: summary.period,
    previousPeriod: summary.previousPeriod,
    timeZone: summary.timeZone,
    comparison: summary.comparison,
    observations,
    carryForward,
    insights: summary.insights,
    streak: summary.streak,
    goals: summary.goals,
    summary: summary.summary,
    previous: summary.previous,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Year-over-year / month-over-month trend series for the analytics footer.
 * @param {any} user
 * @param {any} settings
 * @param {{year: number}} options
 */
export async function monthlyTrend(user, settings, options) {
  const year = options.year;
  const rows = await DailyStats.find({
    user: user._id,
    timeZone: settings.timeZone,
    dayKey: { $gte: `${year}-01-01`, $lte: `${year}-12-31` },
  })
    .select('dayKey focusedSeconds sessionCount')
    .lean();

  const months = Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, '0')}`,
    focusedSeconds: 0,
    sessionCount: 0,
  }));

  for (const row of rows) {
    const monthIndex = Number(row.dayKey.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) continue;
    months[monthIndex].focusedSeconds += row.focusedSeconds ?? 0;
    months[monthIndex].sessionCount += row.sessionCount ?? 0;
  }

  return { year, months };
}

/**
 * Export helper: every session in a range as flat rows, for CSV or JSON.
 * @param {any} user
 * @param {{fromKey: string, toKey: string, timeZone: string}} range
 */
export async function exportSessions(user, range) {
  const [documents, subjects] = await Promise.all([
    FocusSession.find({
      user: user._id,
      startTime: { $gte: new Date(`${range.fromKey}T00:00:00Z`), $lte: new Date(`${range.toKey}T23:59:59.999Z`) },
    })
      .sort({ startTime: 1 })
      .lean(),
    nameAndColorMap(user._id),
  ]);

  return documents.map((document) => ({ document, subject: document.subject ? subjects.get(String(document.subject)) : null }));
}

/** @param {number} seconds */
function formatShort(seconds) {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
