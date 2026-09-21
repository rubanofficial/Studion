import { describe, expect, it } from 'vitest';

import { FOCUS_SCORE_WEIGHTS } from './constants.js';
import { aggregateFocusScore, computeFocusScore, explainFocusScore, focusScoreFactors } from './focusScore.js';

/** @param {Partial<any>} overrides */
const stats = (overrides = {}) => ({
  focusedSeconds: 45 * 60,
  plannedSeconds: 45 * 60,
  wallSeconds: 45 * 60,
  pauseCount: 0,
  distractionsPerHour: 0,
  status: 'completed',
  ...overrides,
});

describe('weights', () => {
  it('sum to exactly 1 so the score is a true 0..100 scale', () => {
    const sum = Object.values(FOCUS_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe('focusScoreFactors', () => {
  it('gives a clean session straight ones', () => {
    expect(focusScoreFactors(stats())).toEqual({
      completion: 1,
      timeInFocus: 1,
      interruptionControl: 1,
      distractionControl: 1,
      outcome: 1,
    });
  });

  it('never lets completion exceed 1 even when the session overran', () => {
    expect(focusScoreFactors(stats({ focusedSeconds: 90 * 60 })).completion).toBe(1);
  });

  it('measures time in focus against wall time, not planned time', () => {
    const factors = focusScoreFactors(stats({ focusedSeconds: 30 * 60, wallSeconds: 60 * 60 }));
    expect(factors.timeInFocus).toBe(0.5);
  });

  it('decays interruption control smoothly rather than linearly', () => {
    const zero = focusScoreFactors(stats({ pauseCount: 0 })).interruptionControl;
    const three = focusScoreFactors(stats({ pauseCount: 3 })).interruptionControl;
    const six = focusScoreFactors(stats({ pauseCount: 6 })).interruptionControl;
    expect(zero).toBe(1);
    expect(three).toBeCloseTo(Math.exp(-1), 6);
    expect(six).toBeCloseTo(Math.exp(-2), 6);
    // A single interruption costs little; a pattern costs a lot.
    expect(focusScoreFactors(stats({ pauseCount: 1 })).interruptionControl).toBeGreaterThan(0.7);
    expect(six).toBeLessThan(0.15);
  });

  it('scores distraction density per hour so long sessions are judged fairly', () => {
    // Same 4 distractions: 1 hour -> 4/h, 8 hours -> 0.5/h.
    const short = focusScoreFactors(stats({ distractionsPerHour: 4 })).distractionControl;
    const long = focusScoreFactors(stats({ distractionsPerHour: 0.5 })).distractionControl;
    expect(short).toBeLessThan(long);
    expect(long).toBeGreaterThan(0.7);
  });

  it('maps outcome by how the session ended', () => {
    expect(focusScoreFactors(stats({ status: 'completed' })).outcome).toBe(1);
    expect(focusScoreFactors(stats({ status: 'interrupted' })).outcome).toBe(0.5);
    expect(focusScoreFactors(stats({ status: 'cancelled' })).outcome).toBe(0);
    expect(focusScoreFactors(stats({ status: 'running' })).outcome).toBe(0);
  });
});

describe('computeFocusScore', () => {
  it('awards a perfect session 100', () => {
    expect(computeFocusScore(stats())).toBe(100);
  });

  it('scores a deliberate half-length session at 75', () => {
    // completion .5 (15) + timeInFocus 1 (25) + interruption 1 (18) + distraction 1 (17) + outcome 0
    expect(computeFocusScore(stats({ focusedSeconds: 30 * 60, wallSeconds: 30 * 60, plannedSeconds: 60 * 60, status: 'cancelled' }))).toBe(75);
  });

  it('refuses to score a session that barely happened', () => {
    expect(computeFocusScore(stats({ focusedSeconds: 20 }))).toBeNull();
    expect(computeFocusScore(stats({ focusedSeconds: 59 }))).toBeNull();
    expect(computeFocusScore(stats({ focusedSeconds: 60 }))).not.toBeNull();
  });

  it('returns 0 when there is no focus time but the session is long enough to be judged by wall clock', () => {
    expect(computeFocusScore({ focusedSeconds: 0, plannedSeconds: 1800, wallSeconds: 1800, pauseCount: 0, distractionsPerHour: 0, status: 'cancelled' })).toBeNull();
  });

  it('is deterministic — same input, same score, always', () => {
    const a = computeFocusScore(stats({ pauseCount: 2, distractionsPerHour: 1.5, focusedSeconds: 2400, status: 'interrupted' }));
    const b = computeFocusScore(stats({ pauseCount: 2, distractionsPerHour: 1.5, focusedSeconds: 2400, status: 'interrupted' }));
    expect(a).toBe(b);
  });

  it('is monotonically worse as interruptions accumulate', () => {
    const scores = [0, 1, 2, 4, 8].map((pauseCount) => computeFocusScore(stats({ pauseCount })) ?? 0);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it('stays inside 0..100 for adversarial input', () => {
    const hostile = [
      { focusedSeconds: 1e9, plannedSeconds: 1, wallSeconds: 1, pauseCount: -5, distractionsPerHour: Number.NaN },
      { focusedSeconds: Number.POSITIVE_INFINITY, plannedSeconds: 0, wallSeconds: 0, pauseCount: 0, distractionsPerHour: 0 },
    ];
    for (const input of hostile) {
      const score = computeFocusScore(input);
      if (score !== null) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        expect(Number.isInteger(score)).toBe(true);
      }
    }
  });
});

describe('explainFocusScore', () => {
  it('produces a breakdown whose points reconcile with the score', () => {
    const input = stats({ focusedSeconds: 30 * 60, wallSeconds: 40 * 60, plannedSeconds: 60 * 60, pauseCount: 2, distractionsPerHour: 3, status: 'interrupted' });
    const explained = explainFocusScore(input);
    const total = explained.factors.reduce((a, f) => a + f.points, 0);
    expect(Math.abs(total - (explained.score ?? 0))).toBeLessThanOrEqual(1);
    expect(explained.factors).toHaveLength(5);
    for (const factor of explained.factors) {
      expect(factor.points).toBeLessThanOrEqual(factor.maxPoints + 0.05);
    }
  });

  it('names the weakest factor so the UI can explain the drop', () => {
    // Focused hard for 10 minutes of a planned hour, then stopped: completion is
    // the one factor that collapsed, and the UI must be able to say so.
    const explained = explainFocusScore(stats({ focusedSeconds: 10 * 60, wallSeconds: 10 * 60, plannedSeconds: 60 * 60 }));
    expect(explained.weakest).toBe('completion');
    expect(explained.summary.length).toBeGreaterThan(10);
  });

  it('never claims a weakest factor on a perfect session', () => {
    const explained = explainFocusScore(stats());
    expect(explained.score).toBe(100);
    expect(explained.weakest).toBeNull();
    expect(explained.strongest).not.toBeNull();
  });

  it('says so when there is nothing to score', () => {
    expect(explainFocusScore(stats({ focusedSeconds: 5 })).summary).toMatch(/Not enough focused time/);
  });
});

describe('aggregateFocusScore', () => {
  it('weights by focused time so a stray short session cannot skew a period', () => {
    const sessions = [
      { focusScore: 90, focusedSeconds: 3600 },
      { focusScore: 10, focusedSeconds: 3 },
    ];
    expect(aggregateFocusScore(sessions)).toBe(90);
  });

  it('ignores unscored sessions entirely', () => {
    expect(aggregateFocusScore([{ focusScore: null, focusedSeconds: 3600 }, { focusScore: 50, focusedSeconds: 600 }])).toBe(50);
  });

  it('returns null rather than a misleading zero when nothing is scored', () => {
    expect(aggregateFocusScore([{ focusScore: null, focusedSeconds: 100 }])).toBeNull();
    expect(aggregateFocusScore([])).toBeNull();
  });
});
