/**
 * Timestamp + duration primitives.
 *
 * Rule for the whole codebase: instants are stored as UTC epoch milliseconds
 * (serialised as ISO-8601 with `Z`). Local calendar meaning is only ever derived
 * from an explicit IANA timezone, never from the server's own clock. See
 * `timezone.js`.
 */

/**
 * Normalise anything timestamp-ish into epoch milliseconds.
 * @param {Date|string|number|null|undefined} value
 * @returns {number|null} epoch ms, or null when the value is absent/invalid
 */
export function toMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * @param {Date|string|number|null|undefined} value
 * @returns {string|null} ISO-8601 UTC string, or null
 */
export function toIso(value) {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Clamp a number into an inclusive range. Guards against NaN/infinity by
 * treating a non-finite value as `min`.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Seconds between two instants, never negative.
 * @param {number|null} fromMs
 * @param {number|null} toMs
 * @returns {number} whole seconds
 */
export function secondsBetween(fromMs, toMs) {
  if (fromMs === null || toMs === null) return 0;
  return Math.max(0, Math.round((toMs - fromMs) / 1000));
}

/**
 * Round to a fixed number of decimals without float noise.
 * @param {number} value
 * @param {number} [decimals]
 * @returns {number}
 */
export function round(value, decimals = 0) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Safe division that yields 0 instead of NaN/Infinity.
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
export function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Format seconds as a compact human duration: `2h 35m`, `45m`, `38s`.
 * @param {number} seconds
 * @param {{style?: 'short'|'clock'|'precise', padHours?: boolean}} [options]
 * @returns {string}
 */
export function formatDuration(seconds, options = {}) {
  const { style = 'short', padHours = false } = options;
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));

  if (style === 'clock') {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const head = padHours || h > 0 ? `${String(h).padStart(2, '0')}:` : '';
    return `${head}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  if (style === 'precise') {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

/**
 * Format a delta for "this week vs last week" style comparisons.
 * Always carries an explicit sign so the direction is unambiguous.
 * @param {number} seconds
 * @param {{style?: 'short'|'clock'}} [options]
 * @returns {string} e.g. `+2h 14m`, `-18m`, `0m`
 */
export function formatDelta(seconds, options = {}) {
  const total = Math.round(Number.isFinite(seconds) ? seconds : 0);
  if (total === 0) return '0m';
  const sign = total > 0 ? '+' : '-';
  return `${sign}${formatDuration(Math.abs(total), options)}`;
}

/**
 * Split seconds into display parts. Useful for the big instrument readout,
 * where each unit gets its own typographic treatment.
 * @param {number} seconds
 * @returns {{hours: number, minutes: number, seconds: number, total: number}}
 */
export function splitDuration(seconds) {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  return {
    total,
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/**
 * Percentage clamped to 0..100, rounded to `decimals`.
 * @param {number} part
 * @param {number} whole
 * @param {number} [decimals]
 * @returns {number}
 */
export function percent(part, whole, decimals = 0) {
  return round(clamp(ratio(part, whole) * 100, 0, 100), decimals);
}

/**
 * Human-friendly relative label for a past instant.
 * Deterministic (takes `now` explicitly) so it is unit-testable.
 * @param {Date|string|number} value
 * @param {Date|string|number} now
 * @returns {string}
 */
export function relativeTime(value, now = Date.now()) {
  const ms = toMs(value);
  const nowMs = toMs(now);
  if (ms === null || nowMs === null) return '';
  const diff = Math.round((ms - nowMs) / 1000);
  const abs = Math.abs(diff);
  const future = diff > 0;

  if (abs < 45) return future ? 'in a moment' : 'just now';
  if (abs < 3600) {
    const m = Math.round(abs / 60);
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < 86400) {
    const h = Math.round(abs / 3600);
    return future ? `in ${h}h` : `${h}h ago`;
  }
  const d = Math.round(abs / 86400);
  if (d < 30) return future ? `in ${d}d` : `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return future ? `in ${mo}mo` : `${mo}mo ago`;
  const y = Math.round(mo / 12);
  return future ? `in ${y}y` : `${y}y ago`;
}
