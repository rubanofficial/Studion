/**
 * Subject / project — the unit a user actually thinks in.
 *
 * Archiving is a soft delete on purpose: a subject that owns three months of
 * sessions must remain resolvable for history and analytics. Deleting one is
 * only allowed once it has no sessions, or by explicitly reassigning them
 * (enforced in `services/subjectService.js`, not here — the model should not
 * need to know about the session collection).
 *
 * Indexes
 * -------
 *   { user: 1, archivedAt: 1, order: 1 }
 *     The cockpit's subject rail and the subject picker both want "this user's
 *     live subjects, in the user's chosen order". One compound index serves the
 *     filter and the sort together, so no in-memory sort is needed.
 *
 *   { user: 1, name: 1 } UNIQUE PARTIAL (archivedAt: null)
 *     Two live subjects may not share a name — that is a confusing bug, not a
 *     feature. The partial filter keeps the constraint off archived rows, so a
 *     user can archive "DSA" and later create a fresh "DSA" without hitting a
 *     duplicate-key error against a document they can no longer see.
 */

import mongoose from 'mongoose';

const DEFAULT_SUBJECT_COLORS = ['#5eead4', '#818cf8', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb923c', '#a78bfa'];

const subjectSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: [true, 'A subject name is required.'], trim: true, maxlength: 60 },
    /** Short glyph or emoji shown on the rail. */
    icon: { type: String, trim: true, maxlength: 8, default: '' },
    color: {
      type: String,
      default: () => DEFAULT_SUBJECT_COLORS[Math.floor(Math.random() * DEFAULT_SUBJECT_COLORS.length)],
      match: /^#[0-9a-fA-F]{6}$/,
    },
    description: { type: String, trim: true, maxlength: 400, default: '' },
    /** Optional long-horizon target, surfaced alongside rolling goals. */
    weeklyTargetSeconds: { type: Number, min: 0, default: 0 },
    monthlyTargetSeconds: { type: Number, min: 0, default: 0 },
    /** Manual ordering on the subject rail; lower sorts first. */
    order: { type: Number, default: 0 },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true, transform: (_doc, ret) => (delete ret.__v, ret) } },
);

subjectSchema.index({ user: 1, archivedAt: 1, order: 1 }, { name: 'list_active_ordered' });
subjectSchema.index(
  { user: 1, name: 1 },
  { unique: true, partialFilterExpression: { archivedAt: null }, name: 'unique_live_name' },
);

/** @returns {boolean} */
subjectSchema.methods.isArchived = function isArchived() {
  return this.archivedAt !== null;
};

export const Subject = mongoose.model('Subject', subjectSchema);
export { DEFAULT_SUBJECT_COLORS };
