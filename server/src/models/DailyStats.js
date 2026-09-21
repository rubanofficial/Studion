/**
 * DailyStats — a per-local-day rollup of focus activity.
 *
 * Why this exists
 * ---------------
 * The heatmap, the calendar and the year view all need ~400 days of history at
 * once. Folding 400 days of sessions on every render is wasteful, and pushing the
 * day-bucketing into a MongoDB aggregation would create a *second* implementation
 * of local-day logic that could silently disagree with the shared core (different
 * handling of midnight-spanning sessions, DST days, idle time).
 *
 * So this collection is a cache, not a source of truth, and it is written by
 * **recomputing the whole day** from sessions rather than by incrementing
 * counters. That makes it self-healing: if a session is edited, deleted, or
 * synced late from an offline device, the day is simply rebuilt correctly. An
 * increment-based rollup would drift permanently the first time that happened.
 *
 * Indexes
 * -------
 *   { user: 1, dayKey: 1 } UNIQUE
 *     One row per user per local day. Doubles as the upsert target (so concurrent
 *     recomputes converge) and the range-scan index for "give me the last 365
 *     days", which is the only read pattern.
 *
 *   { user: 1, timeZone: 1, updatedAt: -1 }
 *     Lets the rollup be invalidated wholesale if the user changes timezone: the
 *     cached rows carry the timezone they were computed in, so a mismatch is
 *     detectable and the affected range can be rebuilt.
 */

import mongoose from 'mongoose';

const dailyStatsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Local calendar day, `YYYY-MM-DD`. */
    dayKey: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** The timezone this row was computed in; a change invalidates the cache. */
    timeZone: { type: String, required: true },

    focusedSeconds: { type: Number, min: 0, default: 0 },
    breakSeconds: { type: Number, min: 0, default: 0 },
    sessionCount: { type: Number, min: 0, default: 0 },
    completedCount: { type: Number, min: 0, default: 0 },
    distractionCount: { type: Number, min: 0, default: 0 },
    /** Focused seconds per subject id, for subject-filtered heatmaps. */
    subjectSeconds: { type: Map, of: Number, default: () => new Map() },
    /** Time-weighted mean focus score for the day, or null when unscored. */
    averageFocusScore: { type: Number, min: 0, max: 100, default: null },
    firstStartAt: { type: Date, default: null },
    lastEndAt: { type: Date, default: null },
    /** True once the day cleared the user's success threshold. */
    goalMet: { type: Boolean, default: false },
  },
  { timestamps: true },
);

dailyStatsSchema.index({ user: 1, dayKey: 1 }, { unique: true, name: 'user_day_unique' });
dailyStatsSchema.index({ user: 1, timeZone: 1, updatedAt: -1 }, { name: 'tz_invalidation' });

export const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);
