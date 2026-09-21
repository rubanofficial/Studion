/**
 * Task — the thing a focus session is attached to.
 *
 * Tasks always belong to a subject, so `subject` is required. That is a
 * deliberate constraint: "what did I work on?" must always be answerable, and a
 * session with no subject is exactly the gap that makes analytics useless.
 * (Unassigned *sessions* are still supported for ad-hoc focus, they simply do not
 * come from a task.)
 *
 * Indexes
 * -------
 *   { user: 1, status: 1, dueAt: 1, order: 1 }
 *     The task queue is read as "my open tasks, most urgent first". Putting the
 *     status filter first keeps the index selective (completed tasks accumulate
 *     forever and are excluded from the common query).
 *
 *   { user: 1, subject: 1, status: 1 }
 *     Per-subject task lists and the "open tasks for this subject" lookup when a
 *     session starts.
 *
 *   { user: 1, updatedAt: -1 }
 *     Delta sync: the client asks for everything changed since a cursor.
 *
 *   { title: 'text', description: 'text', tags: 'text' }
 *     Command-palette and task search. A text index rather than regex scans,
 *     which cannot use an index at all on a growing collection.
 */

import mongoose from 'mongoose';

import { PRIORITIES, TASK_STATUSES } from '@focusforge/core';

const taskSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    title: { type: String, required: [true, 'A task title is required.'], trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    /** Intended length of a focus session on this task. 0 means "not estimated". */
    estimatedDuration: { type: Number, min: 0, max: 24 * 3600, default: 0 },
    /** Deadline instant. Named `dueAt` so the UI copy can be "due". */
    dueAt: { type: Date, default: null },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    tags: { type: [String], default: [] },
    completedAt: { type: Date, default: null },
    order: { type: Number, default: 0 },
    /**
     * Denormalised rollup of time actually spent. Written only by the session
     * service and always recomputed from sessions rather than incremented, so it
     * cannot drift when a session is edited or deleted.
     */
    focusedSeconds: { type: Number, min: 0, default: 0 },
    sessionCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true, transform: (_doc, ret) => (delete ret.__v, ret) } },
);

taskSchema.index({ user: 1, status: 1, dueAt: 1, order: 1 }, { name: 'queue_by_status_due' });
taskSchema.index({ user: 1, subject: 1, status: 1 }, { name: 'by_subject_status' });
taskSchema.index({ user: 1, updatedAt: -1 }, { name: 'delta_sync' });
taskSchema.index(
  { title: 'text', description: 'text', tags: 'text' },
  { name: 'search', weights: { title: 5, tags: 3, description: 1 } },
);

/**
 * Keep `completedAt` honest regardless of which code path flipped the status.
 */
taskSchema.pre('save', function syncCompletedAt(next) {
  if (this.isModified('status')) {
    this.completedAt = this.status === 'completed' ? this.completedAt ?? new Date() : null;
  }
  next();
});

/** @returns {Date|null} */
taskSchema.virtual('dueInSeconds').get(function dueInSeconds() {
  if (!this.dueAt) return null;
  return Math.round((this.dueAt.getTime() - Date.now()) / 1000);
});

export const Task = mongoose.model('Task', taskSchema);
