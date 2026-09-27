import { describe, expect, it } from 'vitest';
import { generateMotivationalInsights } from './motivationalInsights';
import type { OverviewDto } from './api';

describe('motivationalInsights', () => {
  it('returns welcome insights when overview is null', () => {
    const profile = generateMotivationalInsights({ overview: null });
    expect(profile.tier).toBe('primed');
    expect(profile.insights.length).toBeGreaterThan(0);
    expect(profile.headline.title).toContain('masterpiece');
  });

  it('generates goal achieved insights when goal is met', () => {
    const mockOverview = {
      today: {
        dayKey: '2026-09-27',
        focusedSeconds: 7200,
        breakSeconds: 600,
        sessionCount: 3,
        goalSeconds: 5400,
        goalMet: true,
        remainingSeconds: 0,
      },
      week: {
        focusedSeconds: 18000,
        goalSeconds: 27000,
        series: [
          { dayKey: '2026-09-27', focusedSeconds: 7200, goalMet: true, sessionCount: 3 },
        ],
      },
      streak: {
        daily: { current: 4, longest: 7, thresholdSeconds: 1800, isTodayMet: true },
        weekly: { current: 2, longest: 4, isWeekMet: true },
      },
      recentSessions: [],
      openSession: null,
    } as unknown as OverviewDto;

    const profile = generateMotivationalInsights({ overview: mockOverview });
    expect(profile.tier).toBe('unstoppable');
    expect(profile.score).toBeGreaterThan(50);
    expect(profile.insights.some((i) => i.category === 'goal')).toBe(true);
    expect(profile.insights.some((i) => i.category === 'streak')).toBe(true);
  });

  it('identifies target in crosshairs when within 30 minutes of goal', () => {
    const mockOverview = {
      today: {
        dayKey: '2026-09-27',
        focusedSeconds: 4200,
        breakSeconds: 300,
        sessionCount: 2,
        goalSeconds: 4800,
        goalMet: false,
        remainingSeconds: 600, // 10 mins left
      },
      week: {
        focusedSeconds: 14000,
        goalSeconds: 24000,
        series: [],
      },
      streak: {
        daily: { current: 1, longest: 5, thresholdSeconds: 1800, isTodayMet: true },
        weekly: { current: 1, longest: 3, isWeekMet: false },
      },
      recentSessions: [],
      openSession: null,
    } as unknown as OverviewDto;

    const profile = generateMotivationalInsights({ overview: mockOverview });
    expect(profile.tier).toBe('target-hunter');
    const goalInsight = profile.insights.find((i) => i.id === 'goal-close');
    expect(goalInsight).toBeDefined();
    expect(goalInsight?.message).toContain('Just one short');
  });
});
