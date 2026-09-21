/**
 * Display formatting.
 *
 * Duration and date maths is re-exported from `@focusforge/core` rather than
 * reimplemented — a duration rendered in the cockpit and the same duration
 * rendered in the analytics table must come from one function, or they will
 * eventually disagree by a minute and someone will file a bug.
 */

import {
  clamp,
  dayKey,
  formatDayKey,
  formatDelta,
  formatDuration,
  formatInZone,
  hourOfDay,
  percent,
  relativeTime,
  splitDuration,
} from '@focusforge/core';

// Re-exported so the UI has exactly one import site for duration and date maths.
export {
  clamp,
  dayKey,
  formatDayKey,
  formatDelta,
  formatDuration,
  formatInZone,
  hourOfDay,
  percent,
  relativeTime,
  splitDuration,
};

/** `2h 35m` for durations, `—` when there is nothing recorded. */
export function duration(seconds: number | null | undefined, style: 'short' | 'clock' | 'precise' = 'short'): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds === 0 && style === 'short') return '0m';
  return formatDuration(seconds, { style });
}

/** `20:45` in the user's timezone. */
export function clockTime(iso: string | number | Date | null | undefined, timeZone: string): string {
  if (!iso) return '—';
  const ms = iso instanceof Date ? iso.getTime() : typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return '—';
  }
}

/** `9 Mar` — compact, and stable because it is built from the day key. */
export function shortDate(dayKeyValue: string): string {
  const [year, month, day] = dayKeyValue.split('-').map(Number);
  if (!year || !month || !day) return dayKeyValue;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** `Monday, 9 March` for headings. */
export function longDate(dayKeyValue: string): string {
  const [year, month, day] = dayKeyValue.split('-').map(Number);
  if (!year || !month || !day) return dayKeyValue;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** `Mon` */
export function weekdayShort(dayKeyValue: string): string {
  const [year, month, day] = dayKeyValue.split('-').map(Number);
  if (!year) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** `9` — the day number alone, for calendar cells. */
export function dayOfMonth(dayKeyValue: string): number {
  return Number(dayKeyValue.slice(8, 10));
}

/**
 * `8 PM` or `8–10 PM` for a range.
 * Used by the peak-window insight and the day dial labels.
 */
export function hourLabel(hour24: number): string {
  const hour = ((hour24 % 24) + 24) % 24;
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** `Mar 2026` from a `YYYY-MM` month key. */
export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** `#5eead4` → `94 234 212`, for CSS custom properties. */
export function hexToRgbChannels(hex: string): string {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return '94 234 212';
  return `${r} ${g} ${b}`;
}

/** Perceived luminance, for deciding whether text on a swatch should be dark. */
export function isLightColor(hex: string): boolean {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.5;
}

/** `September 2026`-style relative label for a review header. */
export function todayLabel(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  } catch {
    return new Date().toDateString();
  }
}
