/**
 * Achievement service.
 *
 * Earned-ness is recomputed from history; only the moment of unlocking is stored.
 * That has two consequences worth stating plainly:
 *
 *   - The catalogue can be edited — rebalanced targets, new badges — without a
 *     migration, because nothing was stored that depends on the old numbers.
 *   - If a session is corrected or deleted, progress self-corrects. A stored
 *     "unlocked" flag would leave the user holding a badge for work the data no
 *     longer contains.
 *
 * The cost is that this is O(sessions) rather than O(1). That is acceptable for
 * a single user's history, and it is the same read the analytics screens already
 * perform. If it ever became hot, the natural fix is to cache the lifetime stats
 * in `DailyStats` (which is already a rollup), not to reintroduce mutable flags.
 */

import {
  deriveLifetimeStats,
  evaluateAchievements,
  newlyUnlocked,
  startOfWeekKey,
} from '@focusforge/core';

import { Achievement } from '../models/Achievement.js';
import { FocusSession } from '../models/FocusSession.js';
import { logger } from '../utils/logger.js';

import { SESSION_ANALYTICS_PROJECTION, toSessionRecord } from './sessionMapper.js';
import { streakState, trailingSeries } from './statsService.js';

/**
 * Lifetime stats for a user, derived from real history.
 *
 * @param {any} userId
 * @param {any} settings
 * @returns {Promise<{stats: any, streaks: any}>}
 */
async function computeStats(userId, settings) {
  const [documents, series, streaks] = await Promise.all([
    FocusSession.find({ user: userId, status: { $nin: ['running', 'paused'] } })
      .select(SESSION_ANALYTICS_PROJECTION)
      .lean(),
    trailingSeries(userId, {
      timeZone: settings.timeZone,
      successThresholdSeconds: settings.successThresholdSeconds,
      days: 400,
    }),
    streakState(userId, {
      timeZone: settings.timeZone,
      successThresholdSeconds: settings.successThresholdSeconds,
      weekStart: settings.weekStart,
    }),
  ]);

  const records = documents.map((document) => toSessionRecord(document));

  const stats = deriveLifetimeStats(records, {
    dailySeries: series,
    longestStreak: streaks.daily.longest,
    currentStreak: streaks.daily.current,
    weekOf: (dayKey) => startOfWeekKey(dayKey, settings.weekStart),
    monthOf: (dayKey) => dayKey.slice(0, 7),
  });

  return { stats, streaks };
}

/**
 * Evaluate the catalogue and persist any newly earned unlocks.
 *
 * The upsert uses `$setOnInsert` so an achievement's original unlock time is
 * never overwritten by a later sync — the badge should keep the date it was
 * genuinely first earned.
 *
 * @param {any} userId
 * @param {any} settings
 * @returns {Promise<{evaluated: any[], newlyUnlocked: string[], stats: any, streaks: any}>}
 */
export async function evaluateAndSync(userId, settings) {
  const [{ stats, streaks }, stored] = await Promise.all([
    computeStats(userId, settings),
    Achievement.find({ user: userId }).lean(),
  ]);

  const unlockedAt = Object.fromEntries(stored.map((row) => [row.key, row.unlockedAt.toISOString()]));
  const evaluated = evaluateAchievements(stats, unlockedAt);
  const fresh = newlyUnlocked(evaluated, unlockedAt);

  if (fresh.length > 0) {
    const valueByKey = new Map(evaluated.map((entry) => [entry.id, entry.value]));
    await Achievement.bulkWrite(
      fresh.map((key) => ({
        updateOne: {
          filter: { user: userId, key },
          update: {
            $setOnInsert: {
              user: userId,
              key,
              unlockedAt: new Date(),
              seenAt: null,
              valueAtUnlock: valueByKey.get(key) ?? null,
            },
          },
          upsert: true,
        },
      })),
    );
    logger.info('Achievements unlocked', { userId: String(userId), keys: fresh });
  }

  // Re-read so the response carries the persisted unlock times.
  const persisted = await Achievement.find({ user: userId }).lean();
  const persistedMap = Object.fromEntries(persisted.map((row) => [row.key, row.unlockedAt.toISOString()]));

  return {
    evaluated: evaluateAchievements(stats, persistedMap),
    freshlyUnlocked: fresh,
    stats,
    streaks,
  };
}

/**
 * The achievements screen payload, including how many are unseen.
 * @param {any} userId
 * @param {any} settings
 */
export async function list(userId, settings) {
  const { evaluated, freshlyUnlocked: fresh, stats, streaks } = await evaluateAndSync(userId, settings);
  const unseen = await Achievement.countDocuments({ user: userId, seenAt: null });

  const unlocked = evaluated.filter((entry) => entry.unlocked);
  const locked = evaluated.filter((entry) => !entry.unlocked);

  return {
    achievements: evaluated,
    unlocked,
    /** Nearest to completion first, so the list ends with something achievable. */
    inProgress: locked.sort((a, b) => b.progress - a.progress),
    unlockedCount: unlocked.length,
    totalCount: evaluated.length,
    unseenCount: unseen,
    freshlyUnlocked: fresh,
    stats,
    streaks,
  };
}

/**
 * Mark unlocks as seen so the celebration only plays once.
 * @param {any} userId
 * @param {string[]} [keys] omit to mark everything seen
 */
export async function markSeen(userId, keys) {
  const filter = /** @type {Record<string, any>} */ ({ user: userId, seenAt: null });
  if (keys && keys.length > 0) filter.key = { $in: keys };
  const result = await Achievement.updateMany(filter, { $set: { seenAt: new Date() } });
  return { marked: result.modifiedCount ?? 0 };
}

/** Rules shown in the UI so the user knows what is being measured. */
export function rules() {
  return {
    dailyThresholdSeconds: null, // resolved per user from settings
    note: 'Achievements are derived from recorded sessions. Idle time and non-completed sessions still count towards totals where they represent real focused minutes.',
  };
}
