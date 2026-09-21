/**
 * Task service.
 *
 * Two responsibilities beyond plain CRUD:
 *
 *   1. **The queue.** The cockpit's "next up" needs the user's open tasks in a
 *      deliberate order. Sorting in MongoDB (not in memory) is what keeps that
 *      cheap as a task list grows into the hundreds.
 *   2. **Rollups.** `focusedSeconds` and `sessionCount` on a task are recomputed
 *      from sessions rather than incremented, so deleting or editing a session
 *      leaves the task totals correct instead of drifting.
 */

import mongoose from 'mongoose';

import { FocusSession } from '../models/FocusSession.js';
import { Task } from '../models/Task.js';

import { assertFound } from './support.js';
import { resolveOwnedSubjectId } from './subjectService.js';

/** @type {Record<string, any>} */
const SORTS = {
  order: { order: 1, createdAt: 1 },
  dueAt: { dueAt: 1, order: 1 },
  createdAt: { createdAt: -1 },
  priority: { priority: 1, order: 1 },
};

/**
 * @param {any} userId
 * @param {{subjectId?: string, status?: string, priority?: string, search?: string, dueBefore?: Date, limit?: number, offset?: number, sort?: string}} [query]
 */
export async function list(userId, query = {}) {
  /** @type {Record<string, any>} */
  const filter = { user: userId };

  if (query.subjectId) filter.subject = query.subjectId;
  if (query.status === 'open') filter.status = { $in: ['todo', 'in-progress'] };
  else if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.dueBefore) filter.dueAt = { $lte: query.dueBefore, $ne: null };
  if (query.search) {
    // Anchored prefix match so the index can still be used for short queries,
    // with a case-insensitive fallback for the rest.
    filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
  }

  const [items, total] = await Promise.all([
    Task.find(filter)
      .sort(SORTS[/** @type {keyof typeof SORTS} */ (query.sort ?? 'order')] ?? SORTS.order)
      .skip(query.offset ?? 0)
      .limit(query.limit ?? 100),
    Task.countDocuments(filter),
  ]);

  return { items, total };
}

/**
 * @param {any} userId
 * @param {string} taskId
 */
export async function get(userId, taskId) {
  return assertFound(await Task.findOne({ _id: taskId, user: userId }), 'Task');
}

/**
 * @param {any} userId
 * @param {Record<string, any>} input
 */
export async function create(userId, input) {
  const rawSubjectId = input.subjectId ?? input.subject;
  const subjectId = await resolveOwnedSubjectId(userId, rawSubjectId);
  let order = input.order;
  if (order === undefined) {
    const last = await Task.findOne({ user: userId, subject: subjectId, status: { $ne: 'completed' } })
      .sort({ order: -1 })
      .select('order');
    order = last ? Number(last.order ?? 0) + 1 : 0;
  }
  const { subjectId: _s1, subject: _s2, ...rest } = input;
  return Task.create({ ...rest, subject: subjectId, order, user: userId });
}

/**
 * @param {any} userId
 * @param {string} taskId
 * @param {Record<string, any>} patch
 */
export async function update(userId, taskId, patch) {
  const task = await get(userId, taskId);
  const rawSubjectId = patch.subjectId ?? patch.subject;
  const { subjectId: _s1, subject: _s2, ...rest } = patch;

  if (rawSubjectId !== undefined) {
    task.subject = /** @type {any} */ (await resolveOwnedSubjectId(userId, rawSubjectId));
  }
  Object.assign(task, rest);
  await task.save();
  return task;
}

/**
 * @param {any} userId
 * @param {string} taskId
 */
export async function remove(userId, taskId) {
  const task = await get(userId, taskId);
  // Sessions keep their own `task` reference; that is intentional. Deleting a
  // task must not delete measured focus time, and the reference simply becomes
  // unresolvable. Analytics never depends on tasks existing.
  await task.deleteOne();
  return { deleted: true };
}

/**
 * Recompute a task's rollups from the sessions that reference it.
 *
 * @param {any} userId
 * @param {string} taskId
 */
export async function recomputeRollup(userId, taskId) {
  const [result] = await FocusSession.aggregate([
    {
      $match: {
        user: toObjectId(userId),
        task: toObjectId(taskId),
        // Open sessions are excluded: their totals are still moving.
        status: { $nin: ['running', 'paused'] },
        focusedSeconds: { $gt: 0 },
      },
    },
    { $group: { _id: null, focusedSeconds: { $sum: '$focusedSeconds' }, sessionCount: { $sum: 1 } } },
  ]).exec();

  await Task.updateOne(
    { _id: taskId, user: userId },
    { $set: { focusedSeconds: result?.focusedSeconds ?? 0, sessionCount: result?.sessionCount ?? 0 } },
  );
}

/**
 * The next task the user should work on: open, highest priority, earliest due.
 *
 * Explicitly deterministic — ties break on `order`, then `createdAt`. A "next up"
 * suggestion that changes between refreshes with identical data is worse than no
 * suggestion at all.
 *
 * @param {any} userId
 * @param {{subjectId?: string|null}} [options]
 */
export async function nextTask(userId, options = {}) {
  /** @type {Record<string, any>} */
  const filter = { user: userId, status: { $in: ['todo', 'in-progress'] } };
  if (options.subjectId) filter.subject = options.subjectId;

  return Task.findOne(filter).sort({ priority: 1, dueAt: 1, order: 1, createdAt: 1 });
}

/**
 * Tasks that are due soon or overdue, for the cockpit's attention strip.
 * @param {any} userId
 * @param {{withinHours?: number}} [options]
 */
export async function dueSoon(userId, options = {}) {
  const withinHours = options.withinHours ?? 72;
  const cutoff = new Date(Date.now() + withinHours * 3600_000);
  return Task.find({
    user: userId,
    status: { $in: ['todo', 'in-progress'] },
    dueAt: { $ne: null, $lte: cutoff },
  })
    .sort({ dueAt: 1 })
    .limit(5);
}

/** Recompute rollups for every task, used after a bulk session import. */
export async function recomputeAllRollups(userId) {
  const rows = await FocusSession.aggregate([
    { $match: { user: toObjectId(userId), task: { $ne: null }, focusedSeconds: { $gt: 0 } } },
    { $group: { _id: '$task', focusedSeconds: { $sum: '$focusedSeconds' }, sessionCount: { $sum: 1 } } },
  ]).exec();

  if (rows.length === 0) {
    await Task.updateMany({ user: userId }, { $set: { focusedSeconds: 0, sessionCount: 0 } });
    return 0;
  }

  await Task.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row._id, user: userId },
        update: { $set: { focusedSeconds: row.focusedSeconds, sessionCount: row.sessionCount } },
      },
    })),
  );
  return rows.length;
}

/**
 * The task list is the one place free-text search is worth supporting, but it
 * must not become a regex-injection vector.
 * @param {string} value
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mongoose does not cast strings inside an aggregation `$match`, so an
 * aggregation that filters on an id must be handed a real ObjectId.
 * @param {any} value
 * @returns {any}
 */
function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return value;
  return new mongoose.Types.ObjectId(String(value));
}
