/**
 * Calendar periods.
 *
 * A "period" is always expressed as a half-open range of *local day keys*
 * (`from` inclusive, `to` inclusive) plus the concrete UTC instants that bound
 * it. Callers aggregate by day key, so a period never has to do arithmetic on
 * the UTC timeline and can therefore never drift across a DST change.
 */

import { dayKey, dayKeyRange, shiftDayKey, startOfDay, endOfDay, weekdayOfKey, parseDayKey } from './timezone.js';

/**
 * @typedef {{
 *   kind: 'day'|'week'|'month'|'year',
 *   fromKey: string,
 *   toKey: string,
 *   from: string,
 *   to: string,
 *   dayKeys: string[],
 *   label: string,
 *   previous: {fromKey: string, toKey: string},
 *   next: {fromKey: string, toKey: string},
 * }} Period
 */

/**
 * Normalise a `weekStart` preference (0 = Sunday .. 6 = Saturday, or `'monday'`).
 * @param {number|string|undefined} value
 * @returns {number}
 */
export function normaliseWeekStart(value) {
  if (typeof value === 'string') {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const index = names.indexOf(value.toLowerCase());
    return index === -1 ? 1 : index;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6) return value;
  return 1; // Monday — the default for a study tool used by students.
}

/**
 * @param {string} key
 * @param {number} weekStart 0..6
 * @returns {string} the key of the week's first day
 */
export function startOfWeekKey(key, weekStart) {
  const weekday = weekdayOfKey(key);
  const back = (weekday - weekStart + 7) % 7;
  return shiftDayKey(key, -back);
}

/**
 * @param {string} key
 * @returns {{fromKey: string, toKey: string}} the enclosing calendar month
 */
export function monthBounds(key) {
  const { year, month } = parseDayKey(key);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    fromKey: `${year}-${String(month).padStart(2, '0')}-01`,
    toKey: `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
  };
}

/**
 * @param {string} key
 * @returns {{fromKey: string, toKey: string}} the enclosing calendar year
 */
export function yearBounds(key) {
  const { year } = parseDayKey(key);
  return { fromKey: `${year}-01-01`, toKey: `${year}-12-31` };
}

/**
 * Human label for a period. Locale-stable and derived from day keys only.
 * @param {'day'|'week'|'month'|'year'} kind
 * @param {string} fromKey
 * @param {string} toKey
 * @returns {string}
 */
export function periodLabel(kind, fromKey, toKey) {
  const parse = (/** @type {string} */ k) => {
    const { year, month, day } = parseDayKey(k);
    return new Date(Date.UTC(year, month - 1, day));
  };
  const a = parse(fromKey);
  const b = parse(toKey);
  const fmt = (/** @type {Date} */ d, /** @type {Intl.DateTimeFormatOptions} */ o) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(d);

  if (kind === 'day') return fmt(a, { weekday: 'short', month: 'short', day: 'numeric' });
  if (kind === 'month') return fmt(a, { month: 'long', year: 'numeric' });
  if (kind === 'year') return fmt(a, { year: 'numeric' });
  // week — collapse the year when both ends share it, e.g. "Sep 15 – 21, 2026"
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const sameMonth = sameYear && a.getUTCMonth() === b.getUTCMonth();
  if (sameMonth) return `${fmt(a, { month: 'short', day: 'numeric' })} – ${fmt(b, { day: 'numeric' })}, ${a.getUTCFullYear()}`;
  if (sameYear) {
    return `${fmt(a, { month: 'short', day: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric' })}, ${a.getUTCFullYear()}`;
  }
  return `${fmt(a, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * Build a period descriptor around a reference instant.
 *
 * @param {'day'|'week'|'month'|'year'} kind
 * @param {{reference?: Date|string|number, timeZone: string, weekStart?: number|string}} options
 * @returns {Period} `from`/`to` are ISO instants of the *local* period boundaries
 */
export function buildPeriod(kind, options) {
  const timeZone = options.timeZone;
  const weekStart = normaliseWeekStart(options.weekStart);
  const referenceKey = dayKey(options.reference ?? new Date(), timeZone);

  /** @type {{fromKey: string, toKey: string}} */
  let bounds;
  if (kind === 'day') {
    bounds = { fromKey: referenceKey, toKey: referenceKey };
  } else if (kind === 'week') {
    const fromKey = startOfWeekKey(referenceKey, weekStart);
    bounds = { fromKey, toKey: shiftDayKey(fromKey, 6) };
  } else if (kind === 'month') {
    bounds = monthBounds(referenceKey);
  } else {
    bounds = yearBounds(referenceKey);
  }

  const previous = previousPeriod(kind, bounds, weekStart);
  const next = nextPeriod(kind, bounds, weekStart);

  return {
    kind,
    fromKey: bounds.fromKey,
    toKey: bounds.toKey,
    from: startOfDay(bounds.fromKey, timeZone).toISOString(),
    to: endOfDay(bounds.toKey, timeZone).toISOString(),
    dayKeys: dayKeyRange(bounds.fromKey, bounds.toKey),
    label: periodLabel(kind, bounds.fromKey, bounds.toKey),
    previous,
    next,
  };
}

/**
 * @param {'day'|'week'|'month'|'year'} kind
 * @param {{fromKey: string, toKey: string}} bounds
 * @param {number} weekStart
 * @returns {{fromKey: string, toKey: string}}
 */
export function previousPeriod(kind, bounds, weekStart = 1) {
  if (kind === 'day') {
    const key = shiftDayKey(bounds.fromKey, -1);
    return { fromKey: key, toKey: key };
  }
  if (kind === 'week') {
    const fromKey = shiftDayKey(bounds.fromKey, -7);
    void weekStart;
    return { fromKey, toKey: shiftDayKey(fromKey, 6) };
  }
  if (kind === 'month') {
    const { year, month } = parseDayKey(bounds.fromKey);
    const prevMonth = new Date(Date.UTC(year, month - 2, 1));
    return monthBounds(
      `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}-01`,
    );
  }
  const { year } = parseDayKey(bounds.fromKey);
  return { fromKey: `${year - 1}-01-01`, toKey: `${year - 1}-12-31` };
}

/**
 * @param {'day'|'week'|'month'|'year'} kind
 * @param {{fromKey: string, toKey: string}} bounds
 * @param {number} weekStart
 * @returns {{fromKey: string, toKey: string}}
 */
export function nextPeriod(kind, bounds, weekStart = 1) {
  if (kind === 'day') {
    const key = shiftDayKey(bounds.fromKey, 1);
    return { fromKey: key, toKey: key };
  }
  if (kind === 'week') {
    const fromKey = shiftDayKey(bounds.fromKey, 7);
    void weekStart;
    return { fromKey, toKey: shiftDayKey(fromKey, 6) };
  }
  if (kind === 'month') {
    const { year, month } = parseDayKey(bounds.fromKey);
    const nextMonth = new Date(Date.UTC(year, month, 1));
    return monthBounds(`${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  const { year } = parseDayKey(bounds.fromKey);
  return { fromKey: `${year + 1}-01-01`, toKey: `${year + 1}-12-31` };
}

/**
 * Number of days in a period, inclusive.
 * @param {{fromKey: string, toKey: string}} bounds
 * @returns {number}
 */
export function periodDayCount(bounds) {
  const a = parseDayKey(bounds.fromKey);
  const b = parseDayKey(bounds.toKey);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) + 1;
}

/**
 * How many days of a period have elapsed at `now`, for honest goal pacing.
 * Returns 0 if the period has not started, and the full length once it is over.
 *
 * @param {{fromKey: string, toKey: string}} bounds
 * @param {string} nowKey today's local day key
 * @returns {number}
 */
export function elapsedDays(bounds, nowKey) {
  if (nowKey < bounds.fromKey) return 0;
  if (nowKey >= bounds.toKey) return periodDayCount(bounds);
  const a = parseDayKey(bounds.fromKey);
  const n = parseDayKey(nowKey);
  return Math.round((Date.UTC(n.year, n.month - 1, n.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000) + 1;
}
