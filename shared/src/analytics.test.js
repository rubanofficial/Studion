import { describe, expect, it } from 'vitest';

import { sessionRecord, TZ } from '../test/fixtures.js';
import {
  buildDailySeries,
  comparePeriods,
  distractionBreakdown,
  groupByDay,
  hourlyDensity,
  meaningfulSessions,
  splitSegmentAcrossDays,
  subjectBreakdown,
  summarisePeriod,
  trailingDayKeys,
} from './analytics.js';
import { dayKeyRange, startOfDay } from './timezone.js';

/** Two subjects, a break, a pause, and distractions — a realistic week. */
function week() {
  return [
    sessionRecord({ id: 'a', subjectId: 'dsa', subjectName: 'DSA', subjectColor: '#38bdf8', dayKey: '2026-03-02', start: '09:00', minutes: 50, plannedMinutes: 50, breaks: [[25, 30]], distractions: [[10, 'youtube'], [40, 'phone']] }, { focusScore: 88 }),
    sessionRecord({ id: 'b', subjectId: 'java', subjectName: 'Java', subjectColor: '#f59e0b', dayKey: '2026-03-02', start: '20:00', minutes: 45, plannedMinutes: 45 }, { focusScore: 92 }),
    sessionRecord({ id: 'c', subjectId: 'dsa', subjectName: 'DSA', subjectColor: '#38bdf8', dayKey: '2026-03-03', start: '18:30', minutes: 90, plannedMinutes: 90, pauses: [[45, 50]] }, { focusScore: 79 }),
    sessionRecord({ id: 'd', subjectId: 'java', subjectName: 'Java', subjectColor: '#f59e0b', dayKey: '2026-03-05', start: '21:00', minutes: 25, plannedMinutes: 25, distractions: [[5, 'instagram'], [12, 'whatsapp'], [20, 'browsing']] }, { focusScore: 61 }),
  ];
}

describe('groupByDay', () => {
  it('buckets focus time by the local day it was worked', () => {
    const grouped = groupByDay(week(), TZ);
    // 'a' is 50 minutes minus its 5 minute break; 'b' is a clean 45.
    expect(grouped.get('2026-03-02').focusedSeconds).toBe(45 * 60 + 45 * 60);
    expect(grouped.get('2026-03-03').focusedSeconds).toBe(85 * 60); // 90 minus the 5 minute pause
    expect(grouped.has('2026-03-04')).toBe(false);
  });

  it('splits a session that crosses local midnight across both days', () => {
    const record = sessionRecord({ id: 'late', dayKey: '2026-03-02', start: '23:30', minutes: 60, plannedMinutes: 60 });
    const grouped = groupByDay([record], TZ);
    expect(grouped.get('2026-03-02').focusedSeconds).toBe(30 * 60);
    expect(grouped.get('2026-03-03').focusedSeconds).toBe(30 * 60);
    // The session itself is still counted on the day it started.
    expect(grouped.get('2026-03-02').sessionCount).toBe(1);
    expect(grouped.get('2026-03-03').sessionCount).toBe(0);
  });

  it('does not double count: slices always sum to the session total', () => {
    const record = sessionRecord({ id: 'late', dayKey: '2026-03-02', start: '22:15', minutes: 180, plannedMinutes: 180 });
    const grouped = groupByDay([record], TZ);
    const total = [...grouped.values()].reduce((a, b) => a + b.focusedSeconds, 0);
    expect(total).toBe(record.focusedSeconds);
  });
});

describe('splitSegmentAcrossDays', () => {
  it('cuts exactly at local midnight', () => {
    const from = startOfDay('2026-03-02', TZ).getTime() + 23 * 3600_000;
    const slices = splitSegmentAcrossDays({ from, to: from + 2 * 3600_000 }, TZ);
    expect(slices.map((s) => s.dayKey)).toEqual(['2026-03-02', '2026-03-03']);
    expect(slices[0].seconds).toBe(3600);
    expect(slices[1].seconds).toBe(3600);
  });

  it('returns a single slice when the range stays inside one day', () => {
    const from = startOfDay('2026-03-02', TZ).getTime() + 9 * 3600_000;
    expect(splitSegmentAcrossDays({ from, to: from + 30 * 60_000 }, TZ)).toEqual([{ dayKey: '2026-03-02', seconds: 1800 }]);
  });
});

describe('buildDailySeries', () => {
  it('emits every day in the window, including empty ones', () => {
    const keys = dayKeyRange('2026-03-02', '2026-03-08');
    const series = buildDailySeries(week(), keys, TZ, { successThresholdSeconds: 30 * 60 });
    expect(series).toHaveLength(7);
    expect(series.map((d) => d.dayKey)).toEqual(keys);
    expect(series[0].focusedSeconds).toBe(90 * 60);
    expect(series[1].focusedSeconds).toBe(85 * 60);
    expect(series[2].focusedSeconds).toBe(0);
    expect(series[2].goalMet).toBe(false);
    expect(series[0].goalMet).toBe(true);
    expect(series[3].goalMet).toBe(false); // 25 minutes, below the 30 minute threshold
  });
});

describe('hourlyDensity', () => {
  it('slices focus time at real hour boundaries', () => {
    const record = sessionRecord({ id: 'evening', dayKey: '2026-03-02', start: '20:00', minutes: 90, plannedMinutes: 90 });
    const hourly = hourlyDensity([record], TZ);
    expect(hourly).toHaveLength(24);
    expect(hourly[20].seconds).toBe(3600);
    expect(hourly[21].seconds).toBe(1800);
    expect(hourly[19].seconds).toBe(0);
    expect(hourly[20].sessionStarts).toBe(1);
  });

  it('conserves total focus time across the 24 buckets', () => {
    const records = week();
    const hourly = hourlyDensity(records, TZ);
    const total = hourly.reduce((a, h) => a + h.seconds, 0);
    const expected = records.reduce((a, r) => a + r.focusedSeconds, 0);
    expect(total).toBe(expected);
  });

  it('places a break in the bucket it occupied without counting it as focus', () => {
    const record = sessionRecord({ id: 'br', dayKey: '2026-03-02', start: '10:00', minutes: 60, plannedMinutes: 60, breaks: [[25, 35]] });
    const hourly = hourlyDensity([record], TZ);
    const total = hourly.reduce((a, h) => a + h.seconds, 0);
    expect(total).toBe(50 * 60);
  });
});

describe('subjectBreakdown', () => {
  it('computes shares that sum to 100', () => {
    const breakdown = subjectBreakdown(week());
    const shares = breakdown.reduce((a, s) => a + s.share, 0);
    expect(Math.round(shares)).toBe(100);
    expect(breakdown[0].subjectId).toBe('dsa'); // 85+45 min vs java's 45+25
    // Time-weighted from 88 (45 min after the break) and 79 (85 min after the pause).
    expect(breakdown[0].averageScore).toBe(82);
  });

  it('groups unassigned sessions under a stable bucket', () => {
    const record = sessionRecord({ id: 'x', dayKey: '2026-03-02', minutes: 30, plannedMinutes: 30 });
    const breakdown = subjectBreakdown([record]);
    expect(breakdown[0].subjectId).toBe('unassigned');
    expect(breakdown[0].name).toBe('Unassigned');
  });
});

describe('distractionBreakdown', () => {
  it('counts by kind and expresses a rate per focused hour', () => {
    const stats = distractionBreakdown(week());
    expect(stats.total).toBe(5);
    expect(stats.topKind).toBe('youtube');
    const totalFocused = week().reduce((a, r) => a + r.focusedSeconds, 0);
    expect(stats.perHour).toBeCloseTo((5 / totalFocused) * 3600, 2);
  });

  it('reports zero rather than NaN with no focus time', () => {
    expect(distractionBreakdown([]).perHour).toBe(0);
  });
});

describe('meaningfulSessions', () => {
  it('drops accidental taps', () => {
    const tiny = sessionRecord({ id: 'tiny', dayKey: '2026-03-02', minutes: 0.2, plannedMinutes: 25 });
    expect(meaningfulSessions([tiny])).toHaveLength(0);
    expect(meaningfulSessions([...week(), tiny])).toHaveLength(4);
  });
});

describe('summarisePeriod', () => {
  it('summarises a week end to end', () => {
    const keys = dayKeyRange('2026-03-02', '2026-03-08');
    const summary = summarisePeriod({ sessions: week(), dayKeys: keys, timeZone: TZ, successThresholdSeconds: 1800, periodGoalSeconds: 10 * 3600 });

    expect(summary.sessionCount).toBe(4);
    expect(summary.completedCount).toBe(4);
    expect(summary.completionRate).toBe(1);
    // Session 'a' gives back 5 minutes to its break, 'c' gives back 5 to its pause.
    expect(summary.focusedSeconds).toBe((45 + 45 + 85 + 25) * 60);
    expect(summary.breakSeconds).toBe(5 * 60);
    expect(summary.pausedSeconds).toBe(5 * 60);
    expect(summary.longestSessionSeconds).toBe(85 * 60);
    expect(summary.activeDays).toBe(3);
    expect(summary.averageDailySeconds).toBe(Math.round(summary.focusedSeconds / 7));
    expect(summary.dailySeries).toHaveLength(7);
    expect(summary.averageFocusScore).toBe(82); // time weighted
    // Mar 2 (90m) and Mar 3 (85m) clear the 30 minute bar; Mar 5's 25m does not.
    expect(summary.focusIndex.daysMet).toBe(2);
    expect(summary.focusIndex.daysElapsed).toBe(7);
    expect(summary.focusIndex.consistency).toBeCloseTo(2 / 7, 4);
    expect(summary.focusIndex.focusIndex).toBeGreaterThan(0);
  });

  it('refuses to invent a completion rate for an empty period', () => {
    const summary = summarisePeriod({ sessions: [], dayKeys: dayKeyRange('2026-03-02', '2026-03-08'), timeZone: TZ });
    expect(summary.completionRate).toBeNull();
    expect(summary.averageFocusScore).toBeNull();
    expect(summary.focusedSeconds).toBe(0);
    expect(summary.distractions.perHour).toBe(0);
    expect(summary.focusIndex.consistency).toBe(0);
  });

  it('tracks the best day deterministically', () => {
    const summary = summarisePeriod({ sessions: week(), dayKeys: dayKeyRange('2026-03-02', '2026-03-08'), timeZone: TZ });
    expect(summary.bestDay.dayKey).toBe('2026-03-02');
  });
});

describe('comparePeriods', () => {
  it('reports signed deltas when both periods have data', () => {
    const keys = dayKeyRange('2026-03-02', '2026-03-08');
    const current = summarisePeriod({ sessions: week(), dayKeys: keys, timeZone: TZ });
    const previous = summarisePeriod({ sessions: [], dayKeys: dayKeyRange('2026-02-23', '2026-03-01'), timeZone: TZ });
    const rows = comparePeriods(current, previous);
    const focusRow = rows.find((r) => r.key === 'focusedSeconds');
    expect(focusRow.current).toBe(current.focusedSeconds);
    expect(focusRow.previous).toBe(0);
    expect(focusRow.delta).toBe(current.focusedSeconds);
  });

  it('leaves the change null rather than claiming infinite growth', () => {
    const current = summarisePeriod({ sessions: week(), dayKeys: dayKeyRange('2026-03-02', '2026-03-08'), timeZone: TZ });
    const rows = comparePeriods(current, null);
    expect(rows.every((r) => r.delta === null)).toBe(true);
  });
});

describe('trailingDayKeys', () => {
  it('expands backwards from a reference day', () => {
    const keys = trailingDayKeys('2026-03-08', 7);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-03-02');
    expect(keys.at(-1)).toBe('2026-03-08');
  });
});
