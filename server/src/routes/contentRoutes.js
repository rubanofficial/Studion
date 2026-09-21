/**
 * Subject, task and goal routes.
 *
 * All three are mounted behind `requireAuth` here rather than per-route, so it is
 * structurally impossible to add an endpoint to this file that forgets to
 * authenticate. That is the reason the three share a module.
 */

import { Router } from 'express';

import * as controller from '../controllers/resourceControllers.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/params.js';
import {
  archiveSubjectSchema,
  createGoalSchema,
  createSubjectSchema,
  createTaskSchema,
  deleteSubjectQuery,
  listSubjectsQuery,
  listTasksQuery,
  updateGoalSchema,
  updateSubjectSchema,
  updateTaskSchema,
} from '../validators/resources.js';
import { objectId } from '../validators/common.js';
import { z } from 'zod';

// ------------------------------------------------------------------- subjects

export const subjectRouter = Router();
subjectRouter.use(requireAuth);
subjectRouter.get('/', validate({ query: listSubjectsQuery }), controller.listSubjects);
subjectRouter.post('/', validate({ body: createSubjectSchema }), controller.createSubject);
subjectRouter.get('/:id', validate({ params: idParam }), controller.getSubject);
subjectRouter.patch('/:id', validate({ params: idParam, body: updateSubjectSchema }), controller.updateSubject);
subjectRouter.post('/:id/archive', validate({ params: idParam, body: archiveSubjectSchema }), controller.archiveSubject);
subjectRouter.delete('/:id', validate({ params: idParam, query: deleteSubjectQuery }), controller.deleteSubject);

// ---------------------------------------------------------------------- tasks

export const taskRouter = Router();
taskRouter.use(requireAuth);
taskRouter.get('/', validate({ query: listTasksQuery }), controller.listTasks);
taskRouter.get('/next', validate({ query: z.object({ subjectId: objectId.optional() }) }), controller.getNextTask);
taskRouter.post('/', validate({ body: createTaskSchema }), controller.createTask);
taskRouter.get('/:id', validate({ params: idParam }), controller.getTask);
taskRouter.patch('/:id', validate({ params: idParam, body: updateTaskSchema }), controller.updateTask);
taskRouter.delete('/:id', validate({ params: idParam }), controller.deleteTask);

// ---------------------------------------------------------------------- goals

export const goalRouter = Router();
goalRouter.use(requireAuth);
goalRouter.get('/', controller.listGoals);
goalRouter.post('/', validate({ body: createGoalSchema }), controller.createGoal);
goalRouter.patch('/:id', validate({ params: idParam, body: updateGoalSchema }), controller.updateGoal);
goalRouter.delete('/:id', validate({ params: idParam }), controller.deleteGoal);
