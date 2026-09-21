/**
 * Goals.
 *
 * Goals are expressed in focused seconds over a period, optionally scoped to a
 * single subject ("10 hours of DSA per week"). Progress is always evaluated
 * against *elapsed* time as well as total time, because "you are behind" and
 * "this period has barely started" are very different statements.
 */

import { clamp, ratio, round } from './time.js';
import { elapsedDays } from './periods.js';
import { dayKey } from './timezone.js';

/**
 * @typedef {{
 *   id?: string,
 *   period: 'daily'|'weekly'|'monthly',
 *   targetSeconds: number,
 *   subjectId?: string|null,
 *   label?: string|null,
 * }} Goal
 */

/** @param {'daily'|'weekly'|'monthly'} period */
export function periodToKind(period) {
  if (period === 'daily') return 'day';
  if (period === 'monthly') return 'month';
  return 'week';
}

/**
 * Progress for a single goal over a resolved period.
 *
 * `paceRatio` compares progress against the pro-rata expectation: at the
 * halfway point of the week you should be ~halfway to a weekly goal. It is the
 * honest basis for "you're 35 minutes away from your weekly goal" style copy,
 * and it is deliberately excluded from the 0..1 `progress` value so the bar
 * never looks "ahead" of reality.
 *
 * @param {Goal} goal
 * @param {{
 *   period: {fromKey:string,toKey:string},
 *   focusedSeconds: number,
 *   nowKey: string,
 *   periodCompleted?: boolean,
 * }} context
 * @returns {{
 *   targetSeconds:number, focusedSeconds:number, remainingSeconds:number,
 *   progress:number, paceRatio:number|null, expectedSeconds:number|null,
 *   isMet:boolean, isAhead:boolean, daysElapsed:number, daysTotal:number,
 *   projectedSeconds:number|null,
 * }}
 */
export function goalProgress(goal, context) {
  const { period, focusedSeconds, nowKey, periodCompleted = false } = context;
  const target = Math.max(0, goal?.targetSeconds || 0);
  const daysTotal = Math.max(1, elapsedDaysTotal(period));
  const daysElapsed = periodCompleted ? daysTotal : Math.max(1, elapsedDays(period, nowKey));
  const progress = target > 0 ? clamp(ratio(focusedSeconds, target), 0, 1) : 0;

  const expectedSeconds = target > 0 ? Math.round((target * daysElapsed) / daysTotal) : null;
  const paceRatio = expectedSeconds && expectedSeconds > 0 ? round(ratio(focusedSeconds, expectedSeconds), 4) : null;
  const projectedSeconds = daysElapsed > 0 ? Math.round((focusedSeconds / daysElapsed) * daysTotal) : null;

  return {
    targetSeconds: target,
    focusedSeconds,
    remainingSeconds: Math.max(0, target - focusedSeconds),
    progress: round(progress, 4),
    paceRatio,
    expectedSeconds,
    isMet: target > 0 && focusedSeconds >= target,
    isAhead: paceRatio !== null ? paceRatio >= 1 : false,
    daysElapsed,
    daysTotal,
    projectedSeconds,
  };
}

/**
 * Inclusive day count for a period bound.
 * @param {{fromKey:string,toKey:string}} period
 * @returns {number}
 */
function elapsedDaysTotal(period) {
  const a = Date.parse(`${period.fromKey}T00:00:00Z`);
  const b = Date.parse(`${period.toKey}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Neutral, factual pacing sentence. Never shames; never celebrates a period
 * that has barely begun.
 *
 * @param {ReturnType<typeof goalProgress>} progress
 * @param {'daily'|'weekly'|'monthly'} period
 * @returns {string}
 */
export function goalPacingMessage(progress, period) {
  const unit = period === 'daily' ? 'today' : period === 'monthly' ? 'this month' : 'this week';
  if (progress.targetSeconds === 0) return 'No target set.';
  if (progress.isMet) return `${formatShort(progress.focusedSeconds)} — target met for ${unit}.`;
  const remaining = formatShort(progress.remainingSeconds);
  if (progress.paceRatio === null) return `${remaining} to go ${unit}.`;
  if (progress.paceRatio >= 1) return `${remaining} to go, and you're ahead of pace ${unit}.`;
  if (progress.paceRatio >= 0.75) return `${remaining} to go — roughly on pace ${unit}.`;
  if (progress.paceRatio >= 0.4) return `${remaining} to go. There is still time ${unit}.`;
  // Behind pace is stated as a fact plus a way back in, never as a verdict.
  return `${remaining} to go ${unit}. A shorter session still counts.`;
}

/** @param {number} seconds */
function formatShort(seconds) {
  const total = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/**
 * Resolve which goals apply to "now", and evaluate each.
 *
 * @param {Goal[]} goals
 * @param {{
 *   nowKey: string,
 *   timeZone: string,
 *   periods: Record<string, {fromKey:string,toKey:string,period:any}>,
 *   focusedBySubject: Map<string, number>,
 *   totalFocusedSeconds: number,
 *   periodCompleted?: Record<string, boolean>,
 * }} context
 * @returns {Array<object>}
 */
export function evaluateGoals(goals, context) {
  const { nowKey, periods, focusedBySubject, totalFocusedSeconds, periodCompleted = {} } = context;
  return (goals ?? []).map((goal) => {
    const bucket = periods[goal.period];
    if (!bucket) return null;
    const scoped = goal.subjectId ? focusedBySubject.get(String(goal.subjectId)) ?? 0 : totalFocusedSeconds;
    const progress = goalProgress(goal, {
      period: bucket,
      focusedSeconds: scoped,
      nowKey,
      periodCompleted: Boolean(periodCompleted[goal.period]),
    });
    return {
      ...goal,
      subjectScoped: Boolean(goal.subjectId),
      focusedSeconds: scoped,
      periodFromKey: bucket.fromKey,
      periodToKey: bucket.toKey,
      ...progress,
      message: goalPacingMessage(progress, goal.period),
    };
  });
}

/**
 * Convenience: which of the user's goals are satisfied right now.
 * @param {Array<{isMet:boolean, period:string}>} evaluated
 * @returns {{anyMet:boolean, newlyDaily:boolean, dailyMet:boolean, weeklyMet:boolean, monthlyMet:boolean}}
 */
export function goalStatus(evaluated) {
  const dailyMet = evaluated.some((g) => g.period === 'daily' && g.isMet);
  const weeklyMet = evaluated.some((g) => g.period === 'weekly' && g.isMet);
  const monthlyMet = evaluated.some((g) => g.period === 'monthly' && g.isMet);
  return {
    anyMet: dailyMet || weeklyMet || monthlyMet,
    newlyDaily: dailyMet,
    dailyMet,
    weeklyMet,
    monthlyMet,
  };
}

/**
 * Focused seconds per subject for a period, for subject-scoped goals.
 * @param {Array<{subjectId?: string|null, focusedSeconds:number}>} sessions
 * @returns {Map<string, number>}
 */
export function focusedBySubject(sessions) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const session of sessions) {
    const id = session.subjectId ? String(session.subjectId) : 'unassigned';
    map.set(id, (map.get(id) ?? 0) + (session.focusedSeconds || 0));
  }
  return map;
}

/**
 * Yesterday's key relative to a today key — small helper used by reviews.
 * @param {string} todayKey
 * @returns {string}
 */
export function yesterdayKey(todayKey) {
  return dayKey(new Date(Date.parse(`${todayKey}T00:00:00Z`) - 86_400_000), 'UTC');
}
