import { describe, expect, it } from 'vitest';

import { evaluateGoals, focusedBySubject, goalPacingMessage, goalProgress, goalStatus, periodToKind } from './goals.js';

const WEEK = { fromKey: '2026-03-02', toKey: '2026-03-08' };
const HOUR = 3600;

describe('periodToKind', () => {
  it('maps goal periods onto calendar periods', () => {
    expect(periodToKind('daily')).toBe('day');
    expect(periodToKind('weekly')).toBe('week');
    expect(periodToKind('monthly')).toBe('month');
  });
});

describe('goalProgress', () => {
  it('reports progress, remaining time and a projection', () => {
    const result = goalProgress(
      { period: 'weekly', targetSeconds: 10 * HOUR },
      { period: WEEK, focusedSeconds: 7.4 * HOUR, nowKey: '2026-03-05' },
    );
    expect(result.progress).toBeCloseTo(0.74, 4);
    expect(result.remainingSeconds).toBe(Math.round(2.6 * HOUR));
    expect(result.isMet).toBe(false);
    expect(result.daysTotal).toBe(7);
    expect(result.daysElapsed).toBe(4);
    expect(result.projectedSeconds).toBe(Math.round((7.4 / 4) * 7 * HOUR));
  });

  it('marks a goal met once the target is reached', () => {
    const result = goalProgress(
      { period: 'weekly', targetSeconds: 10 * HOUR },
      { period: WEEK, focusedSeconds: 11 * HOUR, nowKey: '2026-03-08' },
    );
    expect(result.isMet).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.remainingSeconds).toBe(0);
  });

  it('measures pacing against the elapsed share of the period', () => {
    // 4 of 7 days elapsed means ~57% is "on pace".
    const onPace = goalProgress({ period: 'weekly', targetSeconds: 7 * HOUR }, { period: WEEK, focusedSeconds: 4 * HOUR, nowKey: '2026-03-05' });
    const behind = goalProgress({ period: 'weekly', targetSeconds: 7 * HOUR }, { period: WEEK, focusedSeconds: 1 * HOUR, nowKey: '2026-03-05' });
    expect(onPace.paceRatio).toBeCloseTo(1, 2);
    expect(onPace.isAhead).toBe(true);
    expect(behind.paceRatio).toBeLessThan(0.5);
    expect(behind.isAhead).toBe(false);
  });

  it('treats a completed period as fully elapsed, so the projection is exact', () => {
    const result = goalProgress({ period: 'weekly', targetSeconds: 10 * HOUR }, { period: WEEK, focusedSeconds: 5 * HOUR, nowKey: '2026-04-01', periodCompleted: true });
    expect(result.daysElapsed).toBe(7);
    expect(result.projectedSeconds).toBe(5 * HOUR);
    expect(result.paceRatio).toBeCloseTo(0.5, 4);
  });

  it('does not divide by zero for a target-less goal', () => {
    const result = goalProgress({ period: 'daily', targetSeconds: 0 }, { period: { fromKey: '2026-03-02', toKey: '2026-03-02' }, focusedSeconds: 60, nowKey: '2026-03-02' });
    expect(result.progress).toBe(0);
    expect(result.paceRatio).toBeNull();
    expect(result.isMet).toBe(false);
  });

  it('handles a single-day period without a projection spike', () => {
    const result = goalProgress({ period: 'daily', targetSeconds: 4 * HOUR }, { period: { fromKey: '2026-03-02', toKey: '2026-03-02' }, focusedSeconds: 1 * HOUR, nowKey: '2026-03-02' });
    expect(result.daysTotal).toBe(1);
    expect(result.daysElapsed).toBe(1);
    expect(result.projectedSeconds).toBe(1 * HOUR);
  });
});

describe('goalPacingMessage', () => {
  const progress = (overrides = {}) => ({
    targetSeconds: 10 * HOUR,
    focusedSeconds: 7 * HOUR,
    remainingSeconds: 3 * HOUR,
    progress: 0.7,
    paceRatio: 1,
    expectedSeconds: 7 * HOUR,
    isMet: false,
    isAhead: true,
    daysElapsed: 7,
    daysTotal: 7,
    projectedSeconds: 10 * HOUR,
    ...overrides,
  });

  it('says so plainly when the target is met', () => {
    expect(goalPacingMessage(progress({ isMet: true, focusedSeconds: 11 * HOUR }), 'weekly')).toBe('11h — target met for this week.');
  });

  it('distinguishes ahead-of-pace, on-pace and behind', () => {
    expect(goalPacingMessage(progress(), 'weekly')).toContain('ahead of pace');
    expect(goalPacingMessage(progress({ paceRatio: 0.85, isAhead: false }), 'weekly')).toContain('roughly on pace');
    expect(goalPacingMessage(progress({ paceRatio: 0.5, isAhead: false }), 'weekly')).toContain('still time');
    const behind = goalPacingMessage(progress({ paceRatio: 0.1, isAhead: false }), 'weekly');
    expect(behind).toContain('A shorter session still counts');
    expect(behind).not.toBe(goalPacingMessage(progress({ paceRatio: 0.9 }), 'weekly'));
  });

  it('never shames the user', () => {
    for (const pace of [0, 0.1, 0.5, 0.9, 1.5]) {
      const message = goalPacingMessage(progress({ paceRatio: pace }), 'weekly');
      expect(message).not.toMatch(/fail|lazy|waste|disappoint|should have/i);
    }
  });
});

describe('focusedBySubject', () => {
  it('totals focus per subject and buckets the unassigned', () => {
    const map = focusedBySubject([
      { subjectId: 'dsa', focusedSeconds: 100 },
      { subjectId: 'dsa', focusedSeconds: 50 },
      { subjectId: 'java', focusedSeconds: 25 },
      { subjectId: null, focusedSeconds: 10 },
    ]);
    expect(map.get('dsa')).toBe(150);
    expect(map.get('java')).toBe(25);
    expect(map.get('unassigned')).toBe(10);
  });
});

describe('evaluateGoals', () => {
  const context = {
    nowKey: '2026-03-05',
    periods: {
      daily: { fromKey: '2026-03-05', toKey: '2026-03-05' },
      weekly: WEEK,
      monthly: { fromKey: '2026-03-01', toKey: '2026-03-31' },
    },
    focusedBySubject: new Map([
      ['dsa', 6 * HOUR],
      ['java', 2 * HOUR],
    ]),
    totalFocusedSeconds: 8 * HOUR,
  };

  it('evaluates a global goal against total time', () => {
    const [goal] = evaluateGoals([{ id: 'g1', period: 'weekly', targetSeconds: 10 * HOUR, subjectId: null }], context);
    expect(goal.subjectScoped).toBe(false);
    expect(goal.focusedSeconds).toBe(8 * HOUR);
    expect(goal.remainingSeconds).toBe(2 * HOUR);
    expect(goal.periodFromKey).toBe('2026-03-02');
  });

  it('evaluates a subject-scoped goal against that subject only', () => {
    const [goal] = evaluateGoals([{ id: 'g2', period: 'weekly', targetSeconds: 10 * HOUR, subjectId: 'dsa' }], context);
    expect(goal.subjectScoped).toBe(true);
    expect(goal.focusedSeconds).toBe(6 * HOUR);
    expect(goal.isMet).toBe(false);
  });

  it('handles a subject with no time yet without producing NaN', () => {
    const [goal] = evaluateGoals([{ id: 'g3', period: 'weekly', targetSeconds: 10 * HOUR, subjectId: 'postgres' }], context);
    expect(goal.focusedSeconds).toBe(0);
    expect(goal.progress).toBe(0);
    expect(goal.projectedSeconds).toBe(0);
  });

  it('skips a goal whose period cannot be resolved', () => {
    const evaluated = evaluateGoals([{ id: 'bad', period: 'yearly', targetSeconds: 100, subjectId: null }], context);
    expect(evaluated).toEqual([null]);
  });

  it('returns an empty list for a user with no goals', () => {
    expect(evaluateGoals([], context)).toEqual([]);
    expect(evaluateGoals(undefined, context)).toEqual([]);
  });
});

describe('goalStatus', () => {
  it('reports which horizons are currently satisfied', () => {
    const status = goalStatus([
      { period: 'daily', isMet: true },
      { period: 'weekly', isMet: false },
      { period: 'monthly', isMet: true },
    ]);
    expect(status).toEqual({ anyMet: true, newlyDaily: true, dailyMet: true, weeklyMet: false, monthlyMet: true });
  });

  it('is all false for an empty list', () => {
    expect(goalStatus([]).anyMet).toBe(false);
  });
});
