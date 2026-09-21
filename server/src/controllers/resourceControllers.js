/**
 * Subject, task and goal controllers.
 *
 * Grouped in one module because they are structurally identical — list, create,
 * read, update, delete — and keeping them together makes it obvious when one of
 * them drifts from the pattern (for example forgetting to return a 201 on
 * create). Each still delegates entirely to its own service.
 */

import * as goalService from '../services/goalService.js';
import * as settingsService from '../services/settingsService.js';
import * as subjectService from '../services/subjectService.js';
import * as taskService from '../services/taskService.js';
import { sendCreated, sendData, sendNoContent } from '../utils/http.js';

// ------------------------------------------------------------------- subjects

/** @type {import('express').RequestHandler} */
export async function listSubjects(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const subjects = await subjectService.list(user._id, req.validated.query);
  sendData(res, { subjects });
}

/** @type {import('express').RequestHandler} */
export async function createSubject(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const subject = await subjectService.create(user._id, req.validated.body);
  sendCreated(res, `/api/subjects/${subject._id}`, { subject });
}

/** @type {import('express').RequestHandler} */
export async function getSubject(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  sendData(res, { subject: await subjectService.get(user._id, req.validated.params.id) });
}

/** @type {import('express').RequestHandler} */
export async function updateSubject(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  sendData(res, { subject: await subjectService.update(user._id, id, req.validated.body) });
}

/** @type {import('express').RequestHandler} */
export async function archiveSubject(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const subject = await subjectService.setArchived(user._id, id, req.validated.body.archived);
  sendData(res, { subject });
}

/** @type {import('express').RequestHandler} */
export async function deleteSubject(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  sendData(res, await subjectService.remove(user._id, id, req.validated.query));
}

// ---------------------------------------------------------------------- tasks

/** @type {import('express').RequestHandler} */
export async function listTasks(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { items, total } = await taskService.list(user._id, req.validated.query);
  sendData(res, { tasks: items }, { meta: { total } });
}

/** @type {import('express').RequestHandler} */
export async function createTask(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const task = await taskService.create(user._id, req.validated.body);
  sendCreated(res, `/api/tasks/${task._id}`, { task });
}

/** @type {import('express').RequestHandler} */
export async function getTask(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  sendData(res, { task: await taskService.get(user._id, req.validated.params.id) });
}

/** @type {import('express').RequestHandler} */
export async function updateTask(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  sendData(res, { task: await taskService.update(user._id, id, req.validated.body) });
}

/** @type {import('express').RequestHandler} */
export async function deleteTask(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  await taskService.remove(user._id, req.validated.params.id);
  sendNoContent(res);
}

/** The single task the cockpit should suggest next. */
export async function getNextTask(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const subjectId = req.validated.query.subjectId ?? null;
  const task = await taskService.nextTask(user._id, { subjectId });
  sendData(res, { task });
}

// ---------------------------------------------------------------------- goals

/** @type {import('express').RequestHandler} */
export async function listGoals(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  const settings = await settingsService.getOrCreate(user._id);
  const result = await goalService.evaluate(user._id, settings, {});
  sendData(res, { goals: result.goals, status: result.status, periods: result.periods });
}

/** @type {import('express').RequestHandler} */
export async function createGoal(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const goal = await goalService.create(user._id, req.validated.body);
  sendCreated(res, `/api/goals/${goal._id}`, { goal });
}

/** @type {import('express').RequestHandler} */
export async function updateGoal(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const { id } = req.validated.params;
  // @ts-expect-error set by the validate middleware
  const goal = await goalService.update(user._id, id, req.validated.body);
  sendData(res, { goal });
}

/** @type {import('express').RequestHandler} */
export async function deleteGoal(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  await goalService.remove(user._id, req.validated.params.id);
  sendNoContent(res);
}
