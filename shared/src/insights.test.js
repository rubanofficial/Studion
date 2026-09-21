import { describe, expect, it } from 'vitest';

import { sessionRecord, TZ } from '../test/fixtures.js';
import { summarisePeriod } from './analytics.js';
import { generateInsights, headlineInsight, peakFocusWindow } from './insights.js';
import { dayKeyRange } from './timezone.js';

/** 8 evening sessions across 4 days — enough sample for every rule to fire. */
function richSessions() {
  const out = [];
  const days = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05'];
  days.forEach((day, index) => {
    out.push(
      sessionRecord({ id: `${day}-a`, subjectId: 'dsa', subjectName: 'DSA', dayKey: day, start: '20:00', minutes: 45, plannedMinutes: 45 }, { focusScore: 88 }),
      sessionRecord({ id: `${day}-b`, subjectId: 'java', subjectName: 'Java', dayKey: day, start: '21:00', minutes: 30, plannedMinutes: 30, distractions: [[10, 'youtube']] }, { focusScore: 74 + index }),
    );
  });
  return out;
}

const KEYS = dayKeyRange('2026-03-02', '2026-03-08');

describe('peakFocusWindow', () => {
  it('finds the densest contiguous block', () => {
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 }));
    hourly[20].seconds = 3000;
    hourly[21].seconds = 2000;
    hourly[9].seconds = 1000;
    const peak = peakFocusWindow(hourly, 3);
    expect(peak.startHour).toBe(20);
    expect(peak.seconds).toBe(5000);
  });

  it('handles a window that wraps past midnight', () => {
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 }));
    hourly[23].seconds = 4000;
    hourly[0].seconds = 4000;
    hourly[1].seconds = 4000;
    expect(peakFocusWindow(hourly, 3).startHour).toBe(23);
  });

  it('returns null rather than guessing on empty data', () => {
    expect(peakFocusWindow(Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: 0 })))).toBeNull();
    expect(peakFocusWindow([])).toBeNull();
  });
});

describe('generateInsights — not enough data', () => {
  it('says so plainly for a brand new user', () => {
    const current = summarisePeriod({ sessions: [], dayKeys: KEYS, timeZone: TZ });
    const insights = generateInsights({ current, nowKey: '2026-03-04' });
    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe('insufficient-data');
    expect(insights[0].detail).toMatch(/session/i);
  });

  it('withholds habit claims below the sample threshold', () => {
    const sessions = [
      sessionRecord({ id: '1', dayKey: '2026-03-02', start: '09:00', minutes: 30, plannedMinutes: 30 }),
      sessionRecord({ id: '2', dayKey: '2026-03-02', start: '14:00', minutes: 30, plannedMinutes: 30 }),
    ];
    const current = summarisePeriod({ sessions, dayKeys: KEYS, timeZone: TZ });
    const insights = generateInsights({ current, nowKey: '2026-03-04' });

    expect(insights.some((i) => i.id === 'insufficient-data')).toBe(true);
    // Two sessions is not a pattern.
    expect(insights.some((i) => i.id === 'peak-window')).toBe(false);
    expect(insights.some((i) => i.id === 'best-weekday')).toBe(false);
  });
});

describe('generateInsights — with real data', () => {
  const current = summarisePeriod({ sessions: richSessions(), dayKeys: KEYS, timeZone: TZ, successThresholdSeconds: 1800, periodGoalSeconds: 10 * 3600 });

  it('produces a rhythm insight from the actual peak window', () => {
    const insight = generateInsights({ current, nowKey: '2026-03-05' }).find((i) => i.id === 'peak-window');
    expect(insight).toBeDefined();
    expect(insight.title).toMatch(/8 PM/);
    expect(insight.evidence.startHour).toBe(20);
    expect(insight.detail).toMatch(/%/);
  });

  it('reports the dominant subject with the real share', () => {
    const insight = generateInsights({ current, nowKey: '2026-03-05' }).find((i) => i.id === 'subject-concentration');
    expect(insight).toBeDefined();
    expect(['DSA', 'Java']).toContain(insight.evidence.topSubject);
    expect(insight.evidence.share).toBeGreaterThan(25);
  });

  it('attaches machine-checkable evidence to every insight it emits', () => {
    const insights = generateInsights({ current, nowKey: '2026-03-05' });
    expect(insights.length).toBeGreaterThan(3);
    for (const insight of insights) {
      expect(insight.id).toBeTruthy();
      expect(insight.title.length).toBeGreaterThan(3);
      expect(insight.detail.length).toBeGreaterThan(3);
      expect(Object.keys(insight.evidence).length).toBeGreaterThan(0);
      // No NaN in the sentence, ever.
      expect(insight.title).not.toMatch(/NaN|undefined|Infinity/);
      expect(insight.detail).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it('never uses shaming language', () => {
    const insights = generateInsights({ current, nowKey: '2026-03-05' });
    for (const insight of insights) {
      expect(`${insight.title} ${insight.detail}`).not.toMatch(/lazy|you failed|wasted|disappoint|should be ashamed|only managed/i);
    }
  });

  it('is deterministic for the same input', () => {
    const a = generateInsights({ current, nowKey: '2026-03-05' }).map((i) => i.id);
    const b = generateInsights({ current, nowKey: '2026-03-05' }).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('describes a week-over-week change only when both weeks have substance', () => {
    const previous = summarisePeriod({ sessions: [], dayKeys: dayKeyRange('2026-02-23', '2026-03-01'), timeZone: TZ });
    const withoutBaseline = generateInsights({ current, previous, nowKey: '2026-03-05' });
    // Previous week is empty, so no comparative claim may be made.
    expect(withoutBaseline.some((i) => i.id === 'focus-time-change')).toBe(false);

    const smallPrevious = summarisePeriod({ sessions: richSessions().slice(0, 2), dayKeys: dayKeyRange('2026-02-23', '2026-03-01'), timeZone: TZ });
    const withBaseline = generateInsights({ current, previous: smallPrevious, nowKey: '2026-03-05' });
    const change = withBaseline.find((i) => i.id === 'focus-time-change');
    expect(change).toBeDefined();
    expect(change.evidence.deltaSeconds).toBe(current.focusedSeconds - smallPrevious.focusedSeconds);
  });

  it('surfaces goal pacing with the real remaining time', () => {
    const insights = generateInsights({
      current,
      goals: [{ period: 'weekly', targetSeconds: 10 * 3600, focusedSeconds: current.focusedSeconds, remainingSeconds: 3600, isMet: false, isAhead: false, daysTotal: 7, paceRatio: 0.6 }],
      nowKey: '2026-03-05',
    });
    const goal = insights.find((i) => i.id === 'goal-pacing');
    expect(goal.title).toBe('1h away from your weekly goal');
    expect(goal.evidence.remaining).toBe(3600);
  });
});

describe('headlineInsight', () => {
  it('prefers the most substantial non-informational insight', () => {
    const insights = [
      { id: 'insufficient-data', tone: 'info', priority: 100 },
      { id: 'focus-time-change', tone: 'positive', priority: 40 },
    ];
    expect(headlineInsight(insights).id).toBe('focus-time-change');
  });

  it('falls back to anything available', () => {
    expect(headlineInsight([{ id: 'insufficient-data', tone: 'info' }]).id).toBe('insufficient-data');
    expect(headlineInsight([])).toBeNull();
  });
});
