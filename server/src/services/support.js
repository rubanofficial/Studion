/**
 * Small helpers shared by the resource services.
 *
 * These exist mainly to keep two conventions consistent everywhere:
 *
 *   - **Ownership failures return 404, not 403.** Telling a caller "this exists
 *     but is not yours" leaks the existence of other users' data. A not-found
 *     response is both simpler and safer.
 *   - **Timezone resolution has exactly one order of precedence**, so a screen
 *     never buckets differently from an export.
 */

import { dayKey, resolveTimeZone, systemTimeZone } from '@focusforge/core';

import { ApiError } from '../utils/ApiError.js';

/**
 * @template T
 * @param {T|null|undefined} document
 * @param {string} label human-readable noun, e.g. "Session"
 * @returns {T}
 */
export function assertFound(document, label) {
  if (!document) throw ApiError.notFound(`That ${label.toLowerCase()} does not exist, or you no longer have access to it.`);
  return /** @type {T} */ (document);
}

/**
 * Resolve which timezone an analytics request should be interpreted in.
 *
 * Precedence: an explicit query parameter, then the user's saved preference, then
 * the server's own zone as a last resort. The explicit parameter exists so a
 * traveller can look at yesterday's data in the zone they were actually in
 * without changing their saved setting.
 *
 * @param {{requested?: string|null, saved?: string|null}} sources
 * @returns {string}
 */
export function resolveAnalyticsTimeZone(sources = {}) {
  if (sources.requested) return resolveTimeZone(sources.requested);
  if (sources.saved) return resolveTimeZone(sources.saved);
  return systemTimeZone();
}

/**
 * Today's local day key for a user.
 * @param {string} timeZone
 * @param {Date|number} [now]
 * @returns {string}
 */
export function todayKey(timeZone, now = new Date()) {
  return dayKey(now, resolveTimeZone(timeZone));
}

/**
 * Normalise an incoming reference instant. `undefined` means now; anything
 * unparseable is a client bug and is rejected rather than silently becoming now,
 * which would show the user the wrong week without telling them.
 *
 * @param {string|undefined} reference
 * @returns {Date}
 */
export function parseReference(reference) {
  if (!reference) return new Date();
  const ms = Date.parse(reference);
  if (!Number.isFinite(ms)) throw ApiError.badRequest('That date could not be understood.');
  return new Date(ms);
}

/**
 * Clamp a requested day window to something an individual account could plausibly
 * contain, so a hand-typed URL cannot ask the server to fold ten years of data.
 *
 * @param {{from?: string, to?: string}} range
 * @param {{defaultDays: number, maxDays: number, todayKey: string}} bounds
 * @returns {{fromKey: string, toKey: string}}
 */
export function clampDayRange(range, bounds) {
  const { defaultDays, maxDays, todayKey: today } = bounds;
  const toKey = range.to ?? today;
  let fromKey = range.from;

  if (!fromKey) {
    const to = Date.parse(`${toKey}T00:00:00Z`);
    fromKey = new Date(to - (defaultDays - 1) * 86_400_000).toISOString().slice(0, 10);
  }

  const span = Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000) + 1;
  if (span <= 0) throw ApiError.badRequest('The start date must not be after the end date.');
  if (span > maxDays) throw ApiError.badRequest(`That range is too long to analyse. The maximum is ${maxDays} days.`);

  return { fromKey, toKey };
}
