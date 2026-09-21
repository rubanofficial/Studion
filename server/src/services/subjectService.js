/**
 * Subject service.
 *
 * The interesting decision here is deletion. A subject accumulates history — it
 * owns sessions (real, measured focus time) and tasks (unfinished intentions).
 * Deleting one therefore has two possible meanings:
 *
 *   - "I created this by mistake, nothing is attached" → safe to remove.
 *   - "I am done with this" → the normal answer is *archive*, which hides it from
 *     the cockpit while keeping every hour of history attributed correctly.
 *
 * So delete means delete, but only when it is free; otherwise the caller must say
 * where the data should go. Silently cascading a delete across months of study
 * history would be the single most destructive thing this API could do.
 */

import { FocusSession } from '../models/FocusSession.js';
import { Subject } from '../models/Subject.js';
import { Task } from '../models/Task.js';
import { ApiError } from '../utils/ApiError.js';

import { assertFound } from './support.js';

/**
 * @param {any} userId
 * @param {{includeArchived?: boolean}} [options]
 */
export async function list(userId, options = {}) {
  const query = options.includeArchived ? { user: userId } : { user: userId, archivedAt: null };
  return Subject.find(query).sort({ order: 1, createdAt: 1 });
}

/**
 * @param {any} userId
 * @param {string} subjectId
 */
export async function get(userId, subjectId) {
  return assertFound(await Subject.findOne({ _id: subjectId, user: userId }), 'Subject');
}

/**
 * @param {any} userId
 * @param {Record<string, any>} input
 */
export async function create(userId, input) {
  // Append to the end of the rail rather than guessing a position.
  let order = input.order;
  if (order === undefined) {
    const last = await Subject.findOne({ user: userId }).sort({ order: -1 }).select('order');
    order = last ? Number(last.order ?? 0) + 1 : 0;
  }

  try {
    return await Subject.create({ ...input, order, user: userId });
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 11000) {
      throw ApiError.conflict(
        'SUBJECT_NAME_TAKEN',
        `You already have an active subject called "${input.name}". Archive it first, or pick a different name.`,
      );
    }
    throw error;
  }
}

/**
 * @param {any} userId
 * @param {string} subjectId
 * @param {Record<string, any>} patch
 */
export async function update(userId, subjectId, patch) {
  const subject = await get(userId, subjectId);
  Object.assign(subject, patch);
  try {
    await subject.save();
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 11000) {
      throw ApiError.conflict('SUBJECT_NAME_TAKEN', `You already have an active subject called "${patch.name}".`);
    }
    throw error;
  }
  return subject;
}

/**
 * @param {any} userId
 * @param {string} subjectId
 * @param {boolean} archived
 */
export async function setArchived(userId, subjectId, archived) {
  const subject = await get(userId, subjectId);

  // Un-archiving can collide with a live subject that took the name meanwhile.
  if (!archived) {
    const clash = await Subject.findOne({ user: userId, name: subject.name, archivedAt: null, _id: { $ne: subject._id } });
    if (clash) {
      throw ApiError.conflict(
        'SUBJECT_NAME_TAKEN',
        `An active subject called "${subject.name}" already exists. Rename one of them first.`,
      );
    }
  }

  subject.archivedAt = archived ? new Date() : null;
  if (!archived) {
    const last = await Subject.findOne({ user: userId }).sort({ order: -1 }).select('order');
    subject.order = last ? Number(last.order ?? 0) + 1 : 0;
  }
  await subject.save();
  return subject;
}

/**
 * Permanently remove a subject.
 *
 * @param {any} userId
 * @param {string} subjectId
 * @param {{reassignTo?: string, confirm?: string}} options
 */
export async function remove(userId, subjectId, options = {}) {
  const subject = await get(userId, subjectId);

  const [sessionCount, taskCount] = await Promise.all([
    FocusSession.countDocuments({ user: userId, subject: subject._id }),
    Task.countDocuments({ user: userId, subject: subject._id }),
  ]);

  if (options.reassignTo) {
    const target = await get(userId, options.reassignTo);
    if (String(target._id) === String(subject._id)) {
      throw ApiError.badRequest('A subject cannot be reassigned to itself.');
    }
    // Move history first. If this fails the subject is untouched, which is the
    // safe direction to fail in.
    await FocusSession.updateMany({ user: userId, subject: subject._id }, { $set: { subject: target._id } });
    await Task.updateMany({ user: userId, subject: subject._id }, { $set: { subject: target._id } });
    await subject.deleteOne();
    return { deleted: true, movedSessions: sessionCount, movedTasks: taskCount, reassignedTo: String(target._id) };
  }

  if (sessionCount > 0 || taskCount > 0) {
    throw ApiError.conflict(
      'SUBJECT_NOT_EMPTY',
      `"${subject.name}" still owns ${sessionCount} session${sessionCount === 1 ? '' : 's'} and ${taskCount} task${taskCount === 1 ? '' : 's'}. Archive it, or pass reassignTo to move them somewhere else.`,
      { sessionCount, taskCount, subjectId: String(subject._id) },
    );
  }

  await subject.deleteOne();
  return { deleted: true, movedSessions: 0, movedTasks: 0 };
}

/**
 * Ensure the client can only ever reference a subject it owns. Used by session
 * and task creation, where an unvalidated reference would be a data-integrity
 * bug rather than a security one (but a bug all the same).
 *
 * @param {any} userId
 * @param {string|null|undefined} subjectId
 * @returns {Promise<string|null>}
 */
export async function resolveOwnedSubjectId(userId, subjectId) {
  if (!subjectId) return null;
  const exists = await Subject.exists({ _id: subjectId, user: userId });
  if (!exists) throw ApiError.badRequest('That subject does not exist.');
  return subjectId;
}

/**
 * A lookup map of id → `{name, color}` for denormalising analytics responses.
 * @param {any} userId
 * @returns {Promise<Map<string, {name: string, color: string, icon?: string}>>}
 */
export async function nameAndColorMap(userId) {
  const subjects = await Subject.find({ user: userId }).select('name color icon archivedAt');
  return new Map(
    subjects.map((subject) => [String(subject._id), { name: String(subject.name), color: String(subject.color), icon: subject.icon ? String(subject.icon) : undefined }]),
  );
}
