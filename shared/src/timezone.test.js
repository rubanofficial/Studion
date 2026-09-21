import { describe, expect, it } from 'vitest';

import {
  dayKey,
  dayKeyRange,
  endOfDay,
  formatInZone,
  hourOfDay,
  isValidTimeZone,
  offsetMs,
  shiftDayKey,
  startOfDay,
  weekdayOfKey,
  zonedToUtc,
} from './timezone.js';
import { formatDelta, formatDuration, relativeTime, splitDuration, toMs } from './time.js';

describe('timezone validation', () => {
  it('accepts real IANA zones and rejects nonsense', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
  });
});

describe('offsetMs', () => {
  it('handles standard time', () => {
    expect(offsetMs(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * 3600_000);
  });

  it('handles daylight time', () => {
    expect(offsetMs(Date.parse('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * 3600_000);
  });

  it('handles half-hour offsets', () => {
    expect(offsetMs(Date.parse('2026-07-15T12:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
  });
});

describe('zonedToUtc', () => {
  it('round-trips a wall clock through a timezone', () => {
    const instant = zonedToUtc({ year: 2026, month: 3, day: 2, hour: 9, minute: 30 }, 'America/New_York');
    expect(instant.toISOString()).toBe('2026-03-02T14:30:00.000Z');
    expect(formatInZone(instant, 'America/New_York')).toBe('09:30');
  });

  it('resolves the DST spring-forward gap to a real instant', () => {
    // 2026-03-08 02:30 does not exist in New York; it must not throw or land on
    // a fabricated offset.
    const instant = zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, 'America/New_York');
    expect(Number.isFinite(instant.getTime())).toBe(true);
    const shown = formatInZone(instant, 'America/New_York');
    expect(['01:30', '03:30']).toContain(shown);
  });

  it('keeps local wall-clock time stable across a fall-back day', () => {
    for (const hour of [0, 1, 2, 3, 23]) {
      const instant = zonedToUtc({ year: 2026, month: 11, day: 1, hour }, 'America/New_York');
      expect(formatInZone(instant, 'America/New_York')).toBe(`${String(hour).padStart(2, '0')}:00`);
    }
  });
});

describe('local day keys', () => {
  it('buckets by the user timezone, not UTC', () => {
    const instant = Date.parse('2026-03-03T02:30:00Z'); // 21:30 on Mar 2 in New York
    expect(dayKey(instant, 'America/New_York')).toBe('2026-03-02');
    expect(dayKey(instant, 'UTC')).toBe('2026-03-03');
    expect(hourOfDay(instant, 'America/New_York')).toBe(21);
  });

  it('handles the IST half-hour offset at the day boundary', () => {
    const instant = Date.parse('2026-03-02T18:45:00Z'); // 00:15 on Mar 3 in IST
    expect(dayKey(instant, 'Asia/Kolkata')).toBe('2026-03-03');
  });

  it('shifts keys as pure calendar arithmetic', () => {
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29'); // leap year
  });

  it('reports the correct weekday', () => {
    expect(weekdayOfKey('2026-03-02')).toBe(1); // Monday
    expect(weekdayOfKey('2026-03-08')).toBe(0); // Sunday
  });

  it('builds an inclusive key range', () => {
    expect(dayKeyRange('2026-02-26', '2026-03-02')).toEqual([
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(dayKeyRange('2026-03-02', '2026-03-02')).toEqual(['2026-03-02']);
  });
});

describe('day boundaries across DST', () => {
  it('gives a 23 hour day on spring forward', () => {
    const start = startOfDay('2026-03-08', 'America/New_York');
    const end = endOfDay('2026-03-08', 'America/New_York');
    const hours = (end.getTime() + 1 - start.getTime()) / 3600_000;
    expect(hours).toBeCloseTo(23, 5);
  });

  it('gives a 25 hour day on fall back', () => {
    const start = startOfDay('2026-11-01', 'America/New_York');
    const end = endOfDay('2026-11-01', 'America/New_York');
    const hours = (end.getTime() + 1 - start.getTime()) / 3600_000;
    expect(hours).toBeCloseTo(25, 5);
  });

  it('starts the day at local midnight', () => {
    expect(formatInZone(startOfDay('2026-07-04', 'America/New_York'), 'America/New_York')).toBe('00:00');
    expect(formatInZone(endOfDay('2026-07-04', 'America/New_York'), 'America/New_York')).toBe('23:59');
  });
});

describe('duration formatting', () => {
  it('formats short form', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(38 * 60)).toBe('38m');
    expect(formatDuration(60 * 60)).toBe('1h');
    expect(formatDuration(2 * 3600 + 35 * 60)).toBe('2h 35m');
  });

  it('formats clock form with hour padding on demand', () => {
    expect(formatDuration(42 * 60 + 18, { style: 'clock' })).toBe('42:18');
    expect(formatDuration(5 * 60, { style: 'clock' })).toBe('05:00');
    // Hour segment appears automatically once a session is an hour or longer.
    expect(formatDuration(365 * 60, { style: 'clock' })).toBe('06:05:00');
    expect(formatDuration(65 * 60, { style: 'clock' })).toBe('01:05:00');
    expect(formatDuration(65 * 60, { style: 'clock', padHours: true })).toBe('01:05:00');
    expect(formatDuration(45 * 60 + 7, { style: 'clock', padHours: true })).toBe('00:45:07');
  });

  it('never emits a negative duration', () => {
    expect(formatDuration(-500)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });

  it('always signs deltas', () => {
    expect(formatDelta(2 * 3600 + 14 * 60)).toBe('+2h 14m');
    expect(formatDelta(-18 * 60)).toBe('-18m');
    expect(formatDelta(0)).toBe('0m');
  });

  it('splits durations for the instrument readout', () => {
    expect(splitDuration(42 * 60 + 18)).toEqual({ total: 2538, hours: 0, minutes: 42, seconds: 18 });
    expect(splitDuration(3661)).toEqual({ total: 3661, hours: 1, minutes: 1, seconds: 1 });
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-03-02T12:00:00Z');

  it('describes the past and the future symmetrically', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 25 * 60_000, now)).toBe('25m ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3h ago');
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(relativeTime(now + 45 * 60_000, now)).toBe('in 45m');
  });
});

describe('toMs', () => {
  it('normalises the shapes timestamps actually arrive in', () => {
    expect(toMs('2026-03-02T12:00:00.000Z')).toBe(Date.parse('2026-03-02T12:00:00.000Z'));
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(toMs(null)).toBeNull();
    expect(toMs('')).toBeNull();
    expect(toMs('garbage')).toBeNull();
    expect(toMs(Number.NaN)).toBeNull();
  });
});
