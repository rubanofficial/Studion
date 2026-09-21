import { describe, expect, it } from 'vitest';

import { ACHIEVEMENTS, deriveLifetimeStats, evaluateAchievements, newlyUnlocked } from './achievements.js';
import { sessionRecord } from '../test/fixtures.js';

/** @param {Partial<any>} overrides */
const stats = (overrides = {}) => ({
  totalSessions: 0,
  totalFocusedSeconds: 0,
  totalDistractions: 0,
  currentStreak: 0,
  longestStreak: 0,
  bestWeekSeconds: 0,
  bestMonthSeconds: 0,
  bestSessionSeconds: 0,
  bestSessionScore: 0,
  bestMonthActiveDays: 0,
  topSubjectSeconds: 0,
  cleanSessionCount: 0,
  ...overrides,
});

describe('catalogue', () => {
  it('has unique ids and meaningful copy', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.target).toBeGreaterThan(0);
      expect(achievement.name.length).toBeGreaterThan(2);
      expect(achievement.description).toMatch(/[.!]$/);
    }
  });

  it('uses adult language throughout', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(`${achievement.name} ${achievement.description}`).not.toMatch(/awesome|super|yay|amazing|rockstar|⭐|🎉/i);
    }
  });
});

describe('evaluateAchievements', () => {
  it('locks everything for a new user but reports progress', () => {
    const evaluated = evaluateAchievements(stats());
    expect(evaluated.every((a) => !a.unlocked)).toBe(true);
    expect(evaluated.find((a) => a.id === 'first-focus').progress).toBe(0);
    expect(evaluated.find((a) => a.id === 'first-focus').remainingLabel).toBe('1 to go');
  });

  it('unlocks the first session achievement at one session', () => {
    const evaluated = evaluateAchievements(stats({ totalSessions: 1 }));
    expect(evaluated.find((a) => a.id === 'first-focus').unlocked).toBe(true);
    expect(evaluated.find((a) => a.id === 'sessions-10').unlocked).toBe(false);
    expect(evaluated.find((a) => a.id === 'sessions-10').progress).toBe(0.1);
  });

  it('formats progress in the unit the achievement is measured in', () => {
    const evaluated = evaluateAchievements(stats({ bestWeekSeconds: 5 * 3600 }));
    const week = evaluated.find((a) => a.id === 'week-10h');
    expect(week.progressLabel).toBe('5h');
    expect(week.remainingLabel).toBe('5h to go');

    const days = evaluateAchievements(stats({ longestStreak: 3 })).find((a) => a.id === 'streak-7');
    expect(days.progressLabel).toBe('3 days');
    expect(days.remainingLabel).toBe('4 days to go');
  });

  it('reports Complete rather than a negative remainder once unlocked', () => {
    const evaluated = evaluateAchievements(stats({ totalSessions: 250 }));
    expect(evaluated.find((a) => a.id === 'sessions-100').remainingLabel).toBe('Complete');
    expect(evaluated.find((a) => a.id === 'sessions-100').progress).toBe(1);
  });

  it('caps progress at 1 for overachievement', () => {
    const evaluated = evaluateAchievements(stats({ bestWeekSeconds: 100 * 3600 }));
    expect(evaluated.find((a) => a.id === 'week-20h').progress).toBe(1);
  });

  it('carries through previously recorded unlock times', () => {
    const evaluated = evaluateAchievements(stats({ totalSessions: 1 }), { 'first-focus': '2026-03-02T10:00:00.000Z' });
    expect(evaluated.find((a) => a.id === 'first-focus').unlockedAt).toBe('2026-03-02T10:00:00.000Z');
  });
});

describe('newlyUnlocked', () => {
  it('reports only achievements not yet recorded', () => {
    const evaluated = evaluateAchievements(stats({ totalSessions: 12, bestSessionScore: 92 }));
    expect(newlyUnlocked(evaluated, {})).toEqual(['first-focus', 'sessions-10', 'score-90']);
    expect(newlyUnlocked(evaluated, { 'first-focus': 'x', 'sessions-10': 'y', 'score-90': 'z' })).toEqual([]);
  });
});

describe('deriveLifetimeStats', () => {
  const sessions = [
    sessionRecord({ id: 'a', subjectId: 'dsa', dayKey: '2026-03-02', minutes: 60, plannedMinutes: 60 }, { focusScore: 95 }),
    sessionRecord({ id: 'b', subjectId: 'dsa', dayKey: '2026-03-03', minutes: 45, plannedMinutes: 45, distractions: [[10, 'phone']] }, { focusScore: 70 }),
    sessionRecord({ id: 'c', subjectId: 'java', dayKey: '2026-03-10', minutes: 30, plannedMinutes: 30 }, { focusScore: 80 }),
  ];

  const context = {
    dailySeries: [
      { dayKey: '2026-03-02', focusedSeconds: 3600 },
      { dayKey: '2026-03-03', focusedSeconds: 2700 },
      { dayKey: '2026-03-10', focusedSeconds: 1800 },
    ],
    longestStreak: 2,
    currentStreak: 1,
    weekOf: (dayKey) => (dayKey < '2026-03-09' ? '2026-03-02' : '2026-03-09'),
    monthOf: (dayKey) => dayKey.slice(0, 7),
  };

  it('rolls up lifetime totals from the real session records', () => {
    const result = deriveLifetimeStats(sessions, context);
    expect(result.totalSessions).toBe(3);
    expect(result.totalFocusedSeconds).toBe(135 * 60);
    expect(result.totalDistractions).toBe(1);
    expect(result.bestSessionSeconds).toBe(60 * 60);
    expect(result.bestSessionScore).toBe(95);
    expect(result.topSubjectSeconds).toBe(105 * 60);
    expect(result.cleanSessionCount).toBe(2);
  });

  it('takes the best week and month from the daily series', () => {
    const result = deriveLifetimeStats(sessions, context);
    expect(result.bestWeekSeconds).toBe(3600 + 2700); // Mar 2 week
    expect(result.bestMonthSeconds).toBe(3600 + 2700 + 1800); // all in March
    expect(result.bestMonthActiveDays).toBe(3);
  });

  it('is zero-safe with no history', () => {
    const result = deriveLifetimeStats([], { dailySeries: [], longestStreak: 0, currentStreak: 0, weekOf: () => '', monthOf: () => '' });
    expect(result.totalSessions).toBe(0);
    expect(result.bestWeekSeconds).toBe(0);
    expect(Number.isNaN(result.totalFocusedSeconds)).toBe(false);
    expect(evaluateAchievements(result).every((a) => !a.unlocked)).toBe(true);
  });
});
