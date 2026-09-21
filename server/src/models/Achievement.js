/**
 * Achievement unlock record.
 *
 * Only *when* an achievement was earned is stored — never whether it is earned.
 * Earned-ness is recomputed from the user's history by
 * `@focusforge/core`'s `evaluateAchievements`, so the catalogue can be extended
 * or rebalanced without a migration, and a data fix (say, a mis-tracked session)
 * automatically corrects progress instead of leaving a stale flag behind.
 *
 * Indexes
 * -------
 *   { user: 1, key: 1 } UNIQUE
 *     One record per achievement per user. Also the upsert target, which is what
 *     makes "record newly earned achievements" safe to run concurrently from two
 *     devices.
 *
 *   { user: 1, seenAt: 1 }
 *     Powers the "new achievement" badge: count records where `seenAt` is null.
 *     Small and selective because most records are already seen.
 */

import mongoose from 'mongoose';

const achievementSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Matches `ACHIEVEMENTS[].id` in the shared core. */
    key: { type: String, required: true, trim: true, maxlength: 60 },
    unlockedAt: { type: Date, default: Date.now },
    /** Null until the user has actually been shown the celebration. */
    seenAt: { type: Date, default: null },
    /** Snapshot of the metric at unlock time, for a meaningful "you did X" line. */
    valueAtUnlock: { type: Number, default: null },
  },
  { timestamps: true },
);

achievementSchema.index({ user: 1, key: 1 }, { unique: true, name: 'user_key_unique' });
achievementSchema.index({ user: 1, seenAt: 1 }, { name: 'unseen' });

export const Achievement = mongoose.model('Achievement', achievementSchema);
