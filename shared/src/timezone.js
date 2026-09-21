/**
 * Timezone / calendar bucketing.
 *
 * The whole product answers "how much did I focus on Tuesday?". That question
 * is only meaningful in the *user's* timezone, and it must keep working when the
 * user flies to another country or when a DST boundary lands mid-week.
 *
 * Strategy:
 *   - Instants are absolute (UTC epoch ms). Always unambiguous.
 *   - Calendar meaning is derived on demand from an explicit IANA timezone using
 *     `Intl`, so the platform's timezone database does the DST work for us
 *     instead of us hand-rolling offsets.
 *   - Aggregation groups by *local day key* (`YYYY-MM-DD`) rather than by
 *     arithmetic on the UTC timeline. Bucketing by key is immune to 23-hour and
 *     25-hour days, which is exactly where naive `start + i * 86400000` code
 *     silently corrupts a week of analytics.
 */

import { toMs } from './time.js';

const FALLBACK_TZ = 'UTC';

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatterCache = new Map();

/**
 * @param {string} timeZone
 * @returns {boolean}
 */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} timeZone
 * @returns {string} a timezone guaranteed to be usable by `Intl`
 */
export function resolveTimeZone(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : FALLBACK_TZ;
}

/** @param {string} timeZone */
function partsFormatter(timeZone) {
  const tz = resolveTimeZone(timeZone);
  let formatter = formatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

/**
 * Break an instant into its wall-clock fields *in a given timezone*.
 * @param {Date|string|number} instant
 * @param {string} timeZone
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number,weekday:string,dayKey:string}|null}
 */
export function zonedParts(instant, timeZone) {
  const ms = toMs(instant);
  if (ms === null) return null;
  const parts = partsFormatter(timeZone).formatToParts(new Date(ms));
  /** @type {Record<string,string>} */
  const bag = {};
  for (const part of parts) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  // `hour12: false` can still render midnight as "24" in some ICU versions.
  const hour = Number(bag.hour) % 24;
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday ?? '',
    dayKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

/**
 * The local calendar date (`YYYY-MM-DD`) an instant falls on.
 * @param {Date|string|number} instant
 * @param {string} timeZone
 * @returns {string}
 */
export function dayKey(instant, timeZone) {
  const parts = zonedParts(instant, timeZone);
  return parts ? parts.dayKey : '1970-01-01';
}

/**
 * Local hour of day, 0..23.
 * @param {Date|string|number} instant
 * @param {string} timeZone
 * @returns {number}
 */
export function hourOfDay(instant, timeZone) {
  const parts = zonedParts(instant, timeZone);
  return parts ? parts.hour : 0;
}

/**
 * The offset (ms) that must be added to UTC to obtain local wall-clock time.
 * Positive east of Greenwich. Derived from the tz database, so it is
 * DST-aware for the instant supplied.
 * @param {Date|string|number} instant
 * @param {string} timeZone
 * @returns {number}
 */
export function offsetMs(instant, timeZone) {
  const ms = toMs(instant);
  if (ms === null) return 0;
  const parts = zonedParts(ms, timeZone);
  if (!parts) return 0;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // formatToParts has second resolution; strip sub-second so the offset stays integral.
  const truncated = ms - (((ms % 1000) + 1000) % 1000);
  return asUtc - truncated;
}

/**
 * Convert a wall-clock date/time in a timezone back into a UTC instant.
 *
 * Two-pass fixed point: guess with the offset at the naive instant, then
 * re-derive with the offset at the guess. This resolves DST boundaries
 * correctly for every real-world case; the ambiguous hour inside a "fall back"
 * transition resolves to the first (pre-transition) occurrence.
 *
 * @param {{year:number,month:number,day:number,hour?:number,minute?:number,second?:number}} wall
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedToUtc(wall, timeZone) {
  const { year, month, day, hour = 0, minute = 0, second = 0 } = wall;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstPass = naive - offsetMs(new Date(naive), timeZone);
  const secondPass = naive - offsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

/**
 * Parse a day key into its numeric parts.
 * @param {string} key `YYYY-MM-DD`
 * @returns {{year:number,month:number,day:number}}
 */
export function parseDayKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!match) throw new RangeError(`Invalid day key: ${key}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * First instant of a local day.
 * @param {string} key `YYYY-MM-DD`
 * @param {string} timeZone
 * @returns {Date}
 */
export function startOfDay(key, timeZone) {
  const { year, month, day } = parseDayKey(key);
  return zonedToUtc({ year, month, day }, timeZone);
}

/**
 * Last instant of a local day (inclusive, 23:59:59.999).
 * @param {string} key
 * @param {string} timeZone
 * @returns {Date}
 */
export function endOfDay(key, timeZone) {
  const { year, month, day } = parseDayKey(key);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return new Date(
    zonedToUtc({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, timeZone).getTime() - 1,
  );
}

/**
 * Shift a day key by whole days. Pure calendar arithmetic on the key itself —
 * no timezone maths, so it can never drift across a DST boundary.
 * @param {string} key
 * @param {number} delta
 * @returns {string}
 */
export function shiftDayKey(key, delta) {
  const { year, month, day } = parseDayKey(key);
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Inclusive list of day keys from `from` to `to`.
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function dayKeyRange(from, to) {
  const keys = [];
  let cursor = from;
  // Hard stop keeps a malformed input from spinning forever.
  for (let guard = 0; guard < 4000; guard += 1) {
    keys.push(cursor);
    if (cursor >= to) break;
    cursor = shiftDayKey(cursor, 1);
  }
  return keys;
}

/**
 * Day of week for a key, 0 = Sunday .. 6 = Saturday.
 * @param {string} key
 * @returns {number}
 */
export function weekdayOfKey(key) {
  const { year, month, day } = parseDayKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Human label for a day key without timezone drift.
 * @param {string} key
 * @param {{weekday?: 'narrow'|'short'|'long', month?: 'short'|'long', day?: boolean, year?: boolean}} [options]
 * @param {string} [locale]
 * @returns {string}
 */
export function formatDayKey(key, options = {}, locale = 'en-US') {
  const { weekday = 'short', month = 'short', day = true, year = false } = options;
  const { year: y, month: m, day: d } = parseDayKey(key);
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    ...(weekday ? { weekday } : {}),
    ...(month ? { month } : {}),
    ...(day ? { day: 'numeric' } : {}),
    ...(year ? { year: 'numeric' } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Local-time label for an instant, e.g. `20:45`.
 * @param {Date|string|number} instant
 * @param {string} timeZone
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatInZone(instant, timeZone, options = {}) {
  const ms = toMs(instant);
  if (ms === null) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: resolveTimeZone(timeZone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...options,
  }).format(new Date(ms));
}

/** @returns {string} the runtime's own IANA timezone */
export function systemTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}
