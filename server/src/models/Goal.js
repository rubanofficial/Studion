/**
 * Goal — a focused-time target over a period, optionally scoped to one subject.
 *
 * Indexes
 * -------
 *   { user: 1, period: 1, subject: 1 } UNIQUE
 *     "Study DSA 10 hours a week" is one goal, not two. Making the triple unique
 *     means a retried create (or two devices racing) cannot leave the user with
 *     duplicate goals that double-count against their progress. `subject` is null
 *     for a global goal, and MongoDB treats null as a value, so the constraint
 *     also covers the global case.
 *
 *   { user: 1, active: 1 }
 *     Loading the handful of goals evaluated on every cockpit render.
 */

import mongoose from 'mongoose';

import { GOAL_PERIODS } from '@focusforge/core';

const goalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    period: { type: String, enum: GOAL_PERIODS, required: true },
    /** Null means "across all subjects". */
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
    targetSeconds: { type: Number, required: true, min: 60, max: 1000 * 3600 },
    label: { type: String, trim: true, maxlength: 80, default: '' },
    active: { type: Boolean, default: true },
    /** Set when the goal is paused rather than deleted. */
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true, transform: (_doc, ret) => (delete ret.__v, ret) } },
);

goalSchema.index({ user: 1, period: 1, subject: 1 }, { unique: true, name: 'one_goal_per_scope' });
goalSchema.index({ user: 1, active: 1 }, { name: 'active_goals' });

export const Goal = mongoose.model('Goal', goalSchema);
