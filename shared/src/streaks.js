/**
 * Streaks — and how not to be toxic about them.
 *
 * Design decisions that matter:
 *   1. A streak is defined by the user's own threshold ("what counts as a good
 *      day"), not by ours. Default is 30 focused minutes, which is deliberately
 *      low enough that a bad day is still salvageable.
 *   2. Today does not break a streak until it is over. At 9am your streak is
 *      whatever it was last night, not zero. This is the single most common way
 *      streak implementations make users feel punished.
 *   3. A gap is never described as "failure". We expose `daysSinceLastSuccess`
 *      so the UI can say "your last session was 3 days ago" — a fact, not a
 *      verdict.
 *   4. We never invent history. Only days present in the series are evaluated.
 */

import { ratio, round } from './time.js';
import { shiftDayKey, weekdayOfKey } from './timezone.js';

/**
 * @param {string} dayKey
 * @param {Set<string>} successful
 * @param {string} todayKey
 * @returns {number} consecutive successful days ending at today or yesterday
 */
function countBack(dayKey, successful, todayKey) {
  // Grace window: today only counts against you once it has actually passed.
  let cursor = dayKey;
  if (!successful.has(cursor) && cursor === todayKey) cursor = shiftDayKey(cursor, -1);
  let count = 0;
  while (successful.has(cursor)) {
    count += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return count;
}

/**
 * @param {Array<{dayKey:string, focusedSeconds:number, goalMet?:boolean}>} series
 * @param {{todayKey:string, successThresholdSeconds?:number}} options
 * @returns {{
 *   current:number, longest:number, lastSuccessfulKey:string|null,
 *   daysSinceLastSuccess:number|null, successfulDays:number, evaluatedDays:number,
 *   thresholdSeconds:number, isTodayMet:boolean, longestRange:{from:string,to:string}|null,
 *   currentRange:{from:string,to:string}|null,
 * }}
 */
export function computeStreak(series, options) {
  const { todayKey, successThresholdSeconds = 30 * 60 } = options;
  const successful = new Set(
    series
      .filter((day) => (day.focusedSeconds || 0) >= Math.max(1, successThresholdSeconds))
      .map((day) => day.dayKey),
  );

  const sorted = [...successful].sort();
  let longest = 0;
  let runStart = null;
  let runLength = 0;
  let longestRange = null;
  let previous = null;
  for (const key of sorted) {
    if (previous !== null && shiftDayKey(previous, 1) === key) {
      runLength += 1;
    } else {
      runStart = key;
      runLength = 1;
    }
    if (runLength > longest) {
      longest = runLength;
      longestRange = { from: /** @type {string} */ (runStart), to: key };
    }
    previous = key;
  }

  const lastSuccessfulKey = sorted.at(-1) ?? null;
  const current = countBack(todayKey, successful, todayKey);

  let currentRange = null;
  if (current > 0) {
    const end = successful.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1);
    currentRange = { from: shiftDayKey(end, -(current - 1)), to: end };
  }

  let daysSinceLastSuccess = null;
  if (lastSuccessfulKey) {
    daysSinceLastSuccess = 0;
    let cursor = lastSuccessfulKey;
    let guard = 0;
    while (cursor < todayKey && guard < 3650) {
      cursor = shiftDayKey(cursor, 1);
      daysSinceLastSuccess += 1;
      guard += 1;
    }
  }

  return {
    current,
    longest,
    lastSuccessfulKey,
    daysSinceLastSuccess,
    successfulDays: successful.size,
    evaluatedDays: series.length,
    thresholdSeconds: successThresholdSeconds,
    isTodayMet: successful.has(todayKey),
    longestRange,
    currentRange,
  };
}

/**
 * Week-level streaks, for people whose schedule is not daily.
 * A week counts if it contains at least `minDaysPerWeek` successful days.
 *
 * @param {Array<{dayKey:string, focusedSeconds:number}>} series
 * @param {{
 *   todayKey:string,
 *   weekStart?:number,
 *   successThresholdSeconds?:number,
 *   minDaysPerWeek?:number,
 * }} options
 * @returns {{current:number, longest:number, weeks: Array<{weekStartKey:string, daysMet:number, met:boolean}>}}
 */
export function computeWeeklyStreak(series, options) {
  const { todayKey, weekStart = 1, successThresholdSeconds = 30 * 60, minDaysPerWeek = 4 } = options;

  /** @type {Map<string, number>} */
  const perWeek = new Map();
  for (const day of series) {
    if ((day.focusedSeconds || 0) < Math.max(1, successThresholdSeconds)) continue;
    const weekday = weekdayOfKey(day.dayKey);
    const back = (weekday - weekStart + 7) % 7;
    const key = shiftDayKey(day.dayKey, -back);
    perWeek.set(key, (perWeek.get(key) ?? 0) + 1);
  }

  const weeks = [...perWeek.entries()]
    .map(([weekStartKey, daysMet]) => ({ weekStartKey, daysMet, met: daysMet >= minDaysPerWeek }))
    .sort((a, b) => (a.weekStartKey < b.weekStartKey ? -1 : 1));

  let longest = 0;
  let run = 0;
  for (const week of weeks) {
    run = week.met ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  // Current streak counts back from the current (possibly incomplete) week.
  const weekday = weekdayOfKey(todayKey);
  const currentWeekStart = shiftDayKey(todayKey, -((weekday - weekStart + 7) % 7));
  let current = 0;
  let cursor = currentWeekStart;
  const byWeek = new Map(weeks.map((w) => [w.weekStartKey, w]));
  if (!byWeek.get(cursor)?.met) cursor = shiftDayKey(cursor, -7);
  for (let guard = 0; guard < 520; guard += 1) {
    if (!byWeek.get(cursor)?.met) break;
    current += 1;
    cursor = shiftDayKey(cursor, -7);
  }

  return { current, longest, weeks };
}

/**
 * How close the user is to extending their streak today, phrased neutrally.
 * @param {{current:number, isTodayMet:boolean, thresholdSeconds:number}} streak
 * @param {number} todayFocusedSeconds
 * @returns {{neededSeconds:number, message:string}}
 */
export function streakProgress(streak, todayFocusedSeconds) {
  if (streak.isTodayMet) {
    return {
      neededSeconds: 0,
      message: streak.current > 1 ? `Day ${streak.current} is in the bank.` : 'Today is in the bank.',
    };
  }
  const needed = Math.max(0, streak.thresholdSeconds - todayFocusedSeconds);
  if (todayFocusedSeconds <= 0) {
    return { neededSeconds: needed, message: 'Today is still open.' };
  }
  return {
    neededSeconds: needed,
    message: `${Math.ceil(needed / 60)} minutes to keep the streak going.`,
  };
}

/**
 * Longest and current streak expressed as a ratio, used by the momentum ring.
 * @param {{current:number, longest:number}} streak
 * @returns {number} 0..1
 */
export function streakMomentum(streak) {
  if (!streak || streak.longest <= 0) return 0;
  return round(ratio(streak.current, streak.longest), 4);
}
