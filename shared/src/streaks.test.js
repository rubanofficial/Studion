import { describe, expect, it } from 'vitest';

import { computeStreak, computeWeeklyStreak, streakMomentum, streakProgress } from './streaks.js';

/**
 * @param {Array<[string, number]>} entries `[dayKey, focusedMinutes]`
 */
const series = (entries) => entries.map(([dayKey, minutes]) => ({ dayKey, focusedSeconds: minutes * 60 }));

const NOON = 30 * 60; // the default "successful day" threshold

describe('computeStreak', () => {
  it('counts consecutive successful days', () => {
    const streak = computeStreak(
      series([
        ['2026-03-01', 60],
        ['2026-03-02', 60],
        ['2026-03-03', 60],
      ]),
      { todayKey: '2026-03-03', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.isTodayMet).toBe(true);
  });

  it('does not break the streak just because today has not happened yet', () => {
    // This is the single most important behaviour here: at 9am the user must
    // still see the streak they earned last night, not a zero.
    const streak = computeStreak(
      series([
        ['2026-03-01', 60],
        ['2026-03-02', 60],
        ['2026-03-03', 5],
      ]),
      { todayKey: '2026-03-03', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(2);
    expect(streak.isTodayMet).toBe(false);
  });

  it('drops the streak once a full day has been missed', () => {
    const streak = computeStreak(
      series([
        ['2026-03-01', 60],
        ['2026-03-02', 60],
        // nothing on Mar 3
      ]),
      { todayKey: '2026-03-04', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(2);
    expect(streak.lastSuccessfulKey).toBe('2026-03-02');
    expect(streak.daysSinceLastSuccess).toBe(2);
  });

  it('reports the longest run separately from the current one', () => {
    const streak = computeStreak(
      series([
        ['2026-03-01', 60],
        ['2026-03-02', 60],
        ['2026-03-03', 60],
        ['2026-03-04', 60],
        // gap
        ['2026-03-07', 60],
        ['2026-03-08', 60],
      ]),
      { todayKey: '2026-03-08', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(4);
    expect(streak.longestRange).toEqual({ from: '2026-03-01', to: '2026-03-04' });
    expect(streak.currentRange).toEqual({ from: '2026-03-07', to: '2026-03-08' });
  });

  it('ignores days below the threshold', () => {
    const streak = computeStreak(
      series([
        ['2026-03-01', 60],
        ['2026-03-02', 10], // below 30
        ['2026-03-03', 60],
      ]),
      { todayKey: '2026-03-03', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(1);
    expect(streak.successfulDays).toBe(2);
  });

  it('respects a user-chosen definition of a good day', () => {
    const days = series([
      ['2026-03-01', 20],
      ['2026-03-02', 20],
    ]);
    expect(computeStreak(days, { todayKey: '2026-03-02', successThresholdSeconds: 15 * 60 }).current).toBe(2);
    expect(computeStreak(days, { todayKey: '2026-03-02', successThresholdSeconds: 25 * 60 }).current).toBe(0);
  });

  it('is zero-safe for a brand new user', () => {
    const streak = computeStreak([], { todayKey: '2026-03-02' });
    expect(streak.current).toBe(0);
    expect(streak.longest).toBe(0);
    expect(streak.lastSuccessfulKey).toBeNull();
    expect(streak.daysSinceLastSuccess).toBeNull();
    expect(streak.currentRange).toBeNull();
  });

  it('handles a streak crossing a DST boundary and a month end', () => {
    const streak = computeStreak(
      series([
        ['2026-02-27', 60],
        ['2026-02-28', 60],
        ['2026-03-01', 60],
        ['2026-03-02', 60],
      ]),
      { todayKey: '2026-03-02', successThresholdSeconds: NOON },
    );
    expect(streak.current).toBe(4);
  });

  it('never claims more evaluated days than were supplied', () => {
    const streak = computeStreak(series([['2026-03-02', 60]]), { todayKey: '2026-03-02' });
    expect(streak.evaluatedDays).toBe(1);
  });
});

describe('computeWeeklyStreak', () => {
  /** Five-day week of 60 minute sessions. */
  const week = (startDay) => {
    const days = [];
    const base = Date.parse(`${startDay}T00:00:00Z`);
    for (let i = 0; i < 5; i += 1) {
      days.push([new Date(base + i * 86_400_000).toISOString().slice(0, 10), 60]);
    }
    return days;
  };

  it('counts consecutive weeks that meet the weekly day target', () => {
    const result = computeWeeklyStreak(
      series([...week('2026-03-02'), ...week('2026-03-09'), ...week('2026-03-16')]),
      { todayKey: '2026-03-19', weekStart: 1, successThresholdSeconds: NOON, minDaysPerWeek: 4 },
    );
    expect(result.longest).toBe(3);
    expect(result.current).toBe(3);
    expect(result.weeks).toHaveLength(3);
  });

  it('breaks on a week that misses the target', () => {
    const result = computeWeeklyStreak(
      series([...week('2026-03-02'), ['2026-03-09', 60], ...week('2026-03-16')]),
      { todayKey: '2026-03-19', weekStart: 1, successThresholdSeconds: NOON, minDaysPerWeek: 4 },
    );
    expect(result.longest).toBe(1);
    expect(result.current).toBe(1);
  });

  it('is empty for a new user', () => {
    const result = computeWeeklyStreak([], { todayKey: '2026-03-19' });
    expect(result.current).toBe(0);
    expect(result.weeks).toEqual([]);
  });
});

describe('streakProgress', () => {
  it('phrases the remaining time as progress, not failure', () => {
    const result = streakProgress({ current: 6, isTodayMet: false, thresholdSeconds: NOON }, 10 * 60);
    expect(result.neededSeconds).toBe(20 * 60);
    expect(result.message).toBe('20 minutes to keep the streak going.');
    expect(result.message).not.toMatch(/fail|lazy|waste/i);
  });

  it('confirms when the day is already secured', () => {
    expect(streakProgress({ current: 6, isTodayMet: true, thresholdSeconds: NOON }, 40 * 60).message).toBe('Day 6 is in the bank.');
  });

  it('stays neutral before any time has been logged', () => {
    expect(streakProgress({ current: 6, isTodayMet: false, thresholdSeconds: NOON }, 0).message).toBe('Today is still open.');
  });
});

describe('streakMomentum', () => {
  it('expresses the current run against the record', () => {
    expect(streakMomentum({ current: 5, longest: 10 })).toBe(0.5);
    expect(streakMomentum({ current: 10, longest: 10 })).toBe(1);
    expect(streakMomentum({ current: 0, longest: 0 })).toBe(0);
    expect(streakMomentum(null)).toBe(0);
  });
});
