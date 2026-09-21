/**
 * Goal service.
 *
 * Goals are stored as intentions (`period` + `targetSeconds` + optional subject)
 * and evaluated on read against the daily rollups. Evaluating rather than
 * storing progress means a goal's status is always consistent with the sessions
 * that produced it — there is no counter to forget to update, and a corrected
 * session immediately corrects the goal.
 *
 * All progress, pacing and projection maths is delegated to
 * `@focusforge/core`'s `goalProgress` / `goalPacingMessage`. That is deliberate:
 * the cockpit's goal bar and the weekly review must never be able to disagree
 * about whether the user is ahead of pace.
 */

import { buildPeriod, elapsedDays, evaluateGoals, goalStatus } from '@focusforge/core';

import { Goal } from '../models/Goal.js';

import { ensureRollups } from './statsService.js';
import { assertFound, todayKey } from './support.js';

/** The three horizons, in the order the API and UI present them. */
const PERIOD_NAMES = /** @type {const} */ (['daily', 'weekly', 'monthly']);

/**
 * @param {any} userId
 * @param {{includeArchived?: boolean}} [options]
 */
export async function list(userId, options = {}) {
  const query = options.includeArchived ? { user: userId } : { user: userId, active: true };
  return Goal.find(query).sort({ period: 1, createdAt: 1 });
}

/**
 * Create or replace the goal for a scope.
 *
 * Upsert rather than insert, because "one goal per period per subject" is a
 * product rule the schema enforces with a unique index. Without the upsert, a
 * user setting a weekly goal twice — or from two devices at once — would get a
 * duplicate-key error instead of the goal they just typed.
 *
 * @param {any} userId
 * @param {Record<string, any>} input
 */
export async function create(userId, input) {
  const subject = input.subjectId ?? null;
  return Goal.findOneAndUpdate(
    { user: userId, period: input.period, subject },
    {
      $set: {
        targetSeconds: input.targetSeconds,
        label: input.label ?? '',
        active: input.active ?? true,
        archivedAt: null,
      },
      $setOnInsert: { user: userId, period: input.period, subject },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * @param {any} userId
 * @param {string} goalId
 * @param {Record<string, any>} patch
 */
export async function update(userId, goalId, patch) {
  const goal = assertFound(await Goal.findOne({ _id: goalId, user: userId }), 'Goal');
  const { subjectId, ...rest } = patch;
  if (subjectId !== undefined) goal.subject = subjectId;
  Object.assign(goal, rest);
  await goal.save();
  return goal;
}

/**
 * @param {any} userId
 * @param {string} goalId
 */
export async function remove(userId, goalId) {
  const goal = assertFound(await Goal.findOne({ _id: goalId, user: userId }), 'Goal');
  await goal.deleteOne();
  return { deleted: true };
}

/**
 * Resolve the three calendar periods a goal can refer to, in the user's zone.
 * @param {{timeZone: string, weekStart: number}} settings
 * @param {Date} [reference]
 */
export function resolvePeriods(settings, reference = new Date()) {
  const shared = { reference, timeZone: settings.timeZone, weekStart: settings.weekStart };
  return {
    daily: buildPeriod('day', shared),
    weekly: buildPeriod('week', shared),
    monthly: buildPeriod('month', shared),
  };
}

/**
 * Evaluate every active goal against real recorded time.
 *
 * Per-period totals are computed once from the cached rollups and then handed to
 * the shared evaluator *per horizon*. That matters: a subject-scoped weekly goal
 * must be judged against that subject's seconds this week, not against the same
 * subject's seconds this month.
 *
 * @param {any} userId
 * @param {any} settings
 * @param {{reference?: Date, now?: Date}} [options]
 * @returns {Promise<{goals: any[], status: any, periods: any, totals: any, nowKey: string}>}
 */
export async function evaluate(userId, settings, options = {}) {
  const reference = options.reference ?? new Date();
  const periods = resolvePeriods(settings, reference);
  const nowKey = todayKey(settings.timeZone, options.now ?? new Date());
  const goals = await list(userId);

  if (goals.length === 0) {
    return { goals: [], status: goalStatus([]), periods, totals: {}, nowKey };
  }

  // The monthly window always contains the weekly window, which always contains
  // today, so a single read serves all three horizons.
  const byKey = await ensureRollups(userId, {
    fromKey: periods.monthly.fromKey,
    toKey: periods.monthly.toKey,
    timeZone: settings.timeZone,
    successThresholdSeconds: settings.successThresholdSeconds,
  });

  /** @type {Record<string, {focusedSeconds: number, subjectSeconds: Map<string, number>, elapsed: number, total: number}>} */
  const totals = {};

  for (const name of PERIOD_NAMES) {
    const period = periods[name];
    let focusedSeconds = 0;
    /** @type {Map<string, number>} */
    const subjectSeconds = new Map();

    for (const key of period.dayKeys) {
      const row = byKey.get(key);
      if (!row) continue;
      focusedSeconds += row.focusedSeconds ?? 0;
      const perSubject = row.subjectSeconds instanceof Map ? row.subjectSeconds : new Map(Object.entries(row.subjectSeconds ?? {}));
      for (const [subjectId, seconds] of perSubject) {
        const id = String(subjectId);
        subjectSeconds.set(id, (subjectSeconds.get(id) ?? 0) + seconds);
      }
    }

    const total = period.dayKeys.length;
    totals[name] = {
      focusedSeconds,
      subjectSeconds,
      total,
      elapsed: elapsedDays(period, nowKey),
    };
  }

  /** @type {any[]} */
  const evaluated = [];

  for (const name of PERIOD_NAMES) {
    const scopedGoals = goals.filter((goal) => goal.period === name);
    if (scopedGoals.length === 0) continue;

    const bucket = totals[name];
    const results = evaluateGoals(
      scopedGoals.map((goal) => ({
        id: String(goal._id),
        period: goal.period,
        targetSeconds: goal.targetSeconds,
        subjectId: goal.subject ? String(goal.subject) : null,
        label: goal.label,
      })),
      {
        nowKey,
        timeZone: settings.timeZone,
        periods,
        focusedBySubject: bucket.subjectSeconds,
        totalFocusedSeconds: bucket.focusedSeconds,
        periodCompleted: { [name]: bucket.elapsed >= bucket.total },
      },
    );

    // `evaluateGoals` maps one-to-one over its input, so index alignment is safe.
    results.forEach((result, index) => {
      if (!result) return;
      evaluated.push({
        ...result,
        subjectId: result.subjectId ?? null,
        createdAt: scopedGoals[index].createdAt,
      });
    });
  }

  return {
    goals: evaluated,
    status: goalStatus(evaluated),
    periods,
    totals,
    nowKey,
  };
}

/**
 * Ensure the user has at least a daily goal so the cockpit always has a target
 * to draw. Called once during onboarding; a no-op afterwards.
 *
 * @param {any} userId
 * @param {{dailyGoalSeconds: number, timeZone: string, weekStart?: number}} settings
 */
export async function ensureDefaults(userId, settings) {
  const existing = await Goal.countDocuments({ user: userId, period: 'daily', subject: null });
  if (existing > 0) return null;
  return create(userId, { period: 'daily', targetSeconds: settings.dailyGoalSeconds, label: 'Daily focus' });
}
