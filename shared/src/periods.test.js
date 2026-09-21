import { describe, expect, it } from 'vitest';

import { localInstant, TZ } from '../test/fixtures.js';
import {
  buildPeriod,
  elapsedDays,
  monthBounds,
  nextPeriod,
  normaliseWeekStart,
  periodDayCount,
  periodLabel,
  previousPeriod,
  startOfWeekKey,
  yearBounds,
} from './periods.js';
import { dayKey } from './timezone.js';

const at = (dayKeyStr, time = '12:00', tz = TZ) => localInstant(dayKeyStr, time, tz);

describe('normaliseWeekStart', () => {
  it('accepts numbers and names, defaulting to Monday', () => {
    expect(normaliseWeekStart(0)).toBe(0);
    expect(normaliseWeekStart(6)).toBe(6);
    expect(normaliseWeekStart('sunday')).toBe(0);
    expect(normaliseWeekStart('SUNDAY')).toBe(0);
    expect(normaliseWeekStart(undefined)).toBe(1);
    expect(normaliseWeekStart(9)).toBe(1);
    expect(normaliseWeekStart('nonsense')).toBe(1);
  });
});

describe('startOfWeekKey', () => {
  it('finds the Monday of a week by default', () => {
    expect(startOfWeekKey('2026-03-04', 1)).toBe('2026-03-02');
    expect(startOfWeekKey('2026-03-02', 1)).toBe('2026-03-02');
    expect(startOfWeekKey('2026-03-08', 1)).toBe('2026-03-02');
  });

  it('honours a Sunday week start', () => {
    expect(startOfWeekKey('2026-03-04', 0)).toBe('2026-03-01');
    expect(startOfWeekKey('2026-03-07', 0)).toBe('2026-03-01');
    expect(startOfWeekKey('2026-03-08', 0)).toBe('2026-03-08');
  });

  it('crosses month and year boundaries correctly', () => {
    expect(startOfWeekKey('2026-01-01', 1)).toBe('2025-12-29');
    expect(startOfWeekKey('2026-03-01', 0)).toBe('2026-03-01');
  });
});

describe('buildPeriod', () => {
  it('builds a Monday-start week with seven day keys', () => {
    const period = buildPeriod('week', { reference: at('2026-03-04'), timeZone: TZ, weekStart: 1 });
    expect(period.fromKey).toBe('2026-03-02');
    expect(period.toKey).toBe('2026-03-08');
    expect(period.dayKeys).toHaveLength(7);
    expect(period.label).toBe('Mar 2 – 8, 2026');
    expect(period.from).toBe('2026-03-02T05:00:00.000Z'); // local midnight EST
    expect(dayKey(period.to, TZ)).toBe('2026-03-08');
  });

  it('builds a Sunday-start week when asked', () => {
    const period = buildPeriod('week', { reference: at('2026-03-04'), timeZone: TZ, weekStart: 0 });
    expect(period.fromKey).toBe('2026-03-01');
    expect(period.toKey).toBe('2026-03-07');
  });

  it('builds a single-day period', () => {
    const period = buildPeriod('day', { reference: at('2026-03-04', '23:30'), timeZone: TZ });
    expect(period.fromKey).toBe('2026-03-04');
    expect(period.toKey).toBe('2026-03-04');
    expect(period.dayKeys).toEqual(['2026-03-04']);
    expect(period.label).toBe('Wed, Mar 4');
  });

  it('handles month lengths including a leap February', () => {
    expect(periodDayCount(buildPeriod('month', { reference: at('2026-02-10'), timeZone: TZ }))).toBe(28);
    expect(periodDayCount(buildPeriod('month', { reference: at('2028-02-10'), timeZone: TZ }))).toBe(29);
    expect(periodDayCount(buildPeriod('month', { reference: at('2026-03-10'), timeZone: TZ }))).toBe(31);
    expect(periodDayCount(buildPeriod('month', { reference: at('2026-04-10'), timeZone: TZ }))).toBe(30);
  });

  it('handles leap years', () => {
    expect(periodDayCount(buildPeriod('year', { reference: at('2028-06-01'), timeZone: TZ }))).toBe(366);
    expect(periodDayCount(buildPeriod('year', { reference: at('2026-06-01'), timeZone: TZ }))).toBe(365);
  });

  it('resolves the reference instant in the user timezone, not UTC', () => {
    // 2026-03-03T02:30Z is still Mar 2 in New York.
    const period = buildPeriod('day', { reference: Date.parse('2026-03-03T02:30:00Z'), timeZone: TZ });
    expect(period.fromKey).toBe('2026-03-02');
  });

  it('keeps the local day key stable even when the day is 23 hours long', () => {
    const period = buildPeriod('day', { reference: at('2026-03-08', '12:00'), timeZone: TZ });
    expect(period.dayKeys).toEqual(['2026-03-08']);
    expect(new Date(period.to).getTime() + 1 - new Date(period.from).getTime()).toBe(23 * 3600_000);
  });
});

describe('period navigation', () => {
  it('walks to the previous week', () => {
    const period = buildPeriod('week', { reference: at('2026-03-04'), timeZone: TZ, weekStart: 1 });
    expect(period.previous).toEqual({ fromKey: '2026-02-23', toKey: '2026-03-01' });
    expect(period.next).toEqual({ fromKey: '2026-03-09', toKey: '2026-03-15' });
  });

  it('walks across a year boundary', () => {
    const period = buildPeriod('month', { reference: at('2026-01-15'), timeZone: TZ });
    expect(period.previous).toEqual({ fromKey: '2025-12-01', toKey: '2025-12-31' });
    expect(period.next).toEqual({ fromKey: '2026-02-01', toKey: '2026-02-28' });
  });

  it('is symmetric: next then previous returns to the start', () => {
    const bounds = { fromKey: '2026-03-02', toKey: '2026-03-08' };
    expect(previousPeriod('week', nextPeriod('week', bounds, 1), 1)).toEqual(bounds);
  });

  it('handles a day period', () => {
    expect(previousPeriod('day', { fromKey: '2026-03-01', toKey: '2026-03-01' })).toEqual({ fromKey: '2026-02-28', toKey: '2026-02-28' });
  });
});

describe('elapsedDays', () => {
  const bounds = { fromKey: '2026-03-02', toKey: '2026-03-08' };

  it('counts inclusively up to today', () => {
    expect(elapsedDays(bounds, '2026-03-02')).toBe(1);
    expect(elapsedDays(bounds, '2026-03-04')).toBe(3);
    expect(elapsedDays(bounds, '2026-03-08')).toBe(7);
  });

  it('returns the full length once the period is over', () => {
    expect(elapsedDays(bounds, '2026-04-01')).toBe(7);
  });

  it('returns zero before the period starts', () => {
    expect(elapsedDays(bounds, '2026-02-20')).toBe(0);
  });
});

describe('bounds helpers', () => {
  it('computes month and year bounds', () => {
    expect(monthBounds('2026-02-14')).toEqual({ fromKey: '2026-02-01', toKey: '2026-02-28' });
    expect(yearBounds('2026-07-04')).toEqual({ fromKey: '2026-01-01', toKey: '2026-12-31' });
  });

  it('labels periods without timezone drift', () => {
    expect(periodLabel('month', '2026-03-01', '2026-03-31')).toBe('March 2026');
    expect(periodLabel('year', '2026-01-01', '2026-12-31')).toBe('2026');
    expect(periodLabel('week', '2026-02-23', '2026-03-01')).toBe('Feb 23 – Mar 1, 2026');
    expect(periodLabel('week', '2025-12-29', '2026-01-04')).toBe('Dec 29, 2025 – Jan 4, 2026');
  });
});
