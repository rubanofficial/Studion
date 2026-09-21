/**
 * Schemas for the user's own content — subjects, tasks, goals — plus the
 * settings document and analytics query strings.
 *
 * Grouped in one file because they share a shape: nearly all of them are
 * "create" and "update" pairs over the same field list, and keeping the pairs
 * adjacent is what prevents the classic bug where a field is added to create but
 * forgotten on update (or vice versa).
 */

import { z } from 'zod';

import { AMBIENCE, THEMES } from '@focusforge/core';

import {
  booleanQuery,
  dayKey,
  durationSeconds,
  goalPeriod,
  hexColor,
  objectId,
  optionalRef,
  pagination,
  periodKind,
  priority,
  strictBody,
  taskStatus,
  timeZone,
  weekStart,
} from './common.js';

// ------------------------------------------------------------------- subjects

const subjectFields = {
  name: z.string().trim().min(1, 'A subject name is required.').max(60),
  icon: z.string().trim().max(8).optional(),
  color: hexColor.optional(),
  description: z.string().trim().max(400).optional(),
  weeklyTargetSeconds: durationSeconds.optional(),
  monthlyTargetSeconds: durationSeconds.optional(),
  order: z.number().int().min(0).max(9999).optional(),
};

export const createSubjectSchema = strictBody(subjectFields);
export const updateSubjectSchema = strictBody(subjectFields).partial();

export const listSubjectsQuery = z
  .object({
    includeArchived: booleanQuery.default(false),
  })
  .strict();

export const archiveSubjectSchema = strictBody({
  archived: z.boolean(),
});

/**
 * Deleting a subject that owns sessions would silently destroy history, so the
 * caller must say what should happen to it.
 */
export const deleteSubjectQuery = z
  .object({
    /** Move sessions to another subject instead of losing them. */
    reassignTo: objectId.optional(),
    /** Required when the subject has sessions and no reassignment is given. */
    confirm: z.literal('DELETE').optional(),
  })
  .strict();

// ---------------------------------------------------------------------- tasks

const taskFields = {
  subjectId: objectId.optional(),
  subject: objectId.optional(),
  title: z.string().trim().min(1, 'A task title is required.').max(200),
  description: z.string().trim().max(2000).optional(),
  priority: priority.optional(),
  estimatedDuration: durationSeconds.optional(),
  dueAt: z.preprocess((value) => (value === null ? null : value), z.coerce.date().nullable().optional()),
  status: taskStatus.optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  order: z.number().int().min(0).max(99999).optional(),
};

export const createTaskSchema = strictBody(taskFields).refine(
  (data) => Boolean(data.subjectId || data.subject),
  { message: 'A subject is required.', path: ['subjectId'] },
);
export const updateTaskSchema = strictBody(taskFields).partial();

export const listTasksQuery = z
  .object({
    subjectId: objectId.optional(),
    status: z.union([taskStatus, z.literal('open')]).optional(),
    priority: priority.optional(),
    search: z.string().trim().max(120).optional(),
    dueBefore: z.coerce.date().optional(),
    ...pagination,
    sort: z.enum(['order', 'dueAt', 'createdAt', 'priority']).default('order'),
  })
  .strict();

// ---------------------------------------------------------------------- goals

const goalFields = {
  period: goalPeriod,
  targetSeconds: z.number().int().min(60).max(1000 * 3600),
  subjectId: optionalRef,
  label: z.string().trim().max(80).optional(),
  active: z.boolean().optional(),
};

export const createGoalSchema = strictBody(goalFields);
export const updateGoalSchema = strictBody(goalFields).partial();

// ------------------------------------------------------------------- settings

const presetSchema = z
  .object({
    minutes: z.number().int().min(1).max(600),
    label: z.string().trim().max(40).optional(),
  })
  .strict();

export const updateSettingsSchema = strictBody({
  theme: z.enum(/** @type {[string, ...string[]]} */(THEMES)).optional(),
  accent: hexColor.optional(),
  reduceMotion: z.boolean().optional(),
  ambientBackground: z.boolean().optional(),
  timeZone: timeZone.optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  dailyGoalSeconds: durationSeconds.optional(),
  successThresholdSeconds: z.number().int().min(60).max(24 * 3600).optional(),
  focusPresets: z.array(presetSchema).min(1).max(10).optional(),
  breakPresets: z.array(presetSchema).min(1).max(10).optional(),
  shortBreakMinutes: z.number().int().min(1).max(120).optional(),
  longBreakMinutes: z.number().int().min(1).max(180).optional(),
  longBreakEvery: z.number().int().min(1).max(12).optional(),
  autoStartBreaks: z.boolean().optional(),
  autoStartFocus: z.boolean().optional(),
  maxExtendMinutes: z.number().int().min(1).max(240).optional(),
  notifications: z
    .object({
      sessionComplete: z.boolean().optional(),
      breakFinished: z.boolean().optional(),
      dailyGoal: z.boolean().optional(),
      weeklyGoal: z.boolean().optional(),
      streakMilestone: z.boolean().optional(),
      desktop: z.boolean().optional(),
    })
    .strict()
    .optional(),
  sound: z
    .object({
      enabled: z.boolean().optional(),
      ambience: z.enum(/** @type {[string, ...string[]]} */(AMBIENCE)).optional(),
      volume: z.number().min(0).max(1).optional(),
      chime: z.boolean().optional(),
    })
    .strict()
    .optional(),
  shortcuts: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  defaultSubject: optionalRef,
  promptDailyReview: z.boolean().optional(),
  confirmEarlyEnd: z.boolean().optional(),
});

// ------------------------------------------------------------------ analytics

export const analyticsQuery = z
  .object({
    period: periodKind.default('week'),
    /** Any instant inside the wanted period. Defaults to now. */
    reference: z.string().trim().optional(),
    timeZone: timeZone.optional(),
    weekStart: weekStart.optional(),
    /** Compare against the preceding period of the same length. */
    compare: booleanQuery.default(true),
  })
  .strict();

export const heatmapQuery = z
  .object({
    days: z.coerce.number().int().min(7).max(730).default(365),
    subjectId: objectId.optional(),
    timeZone: timeZone.optional(),
  })
  .strict();

export const calendarQuery = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, 'Months look like 2026-03.').optional(),
    subjectId: objectId.optional(),
    timeZone: timeZone.optional(),
  })
  .strict();

export const dayDetailQuery = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    timeZone: timeZone.optional(),
  })
  .strict();

/**
 * Export selectors. `from`/`to` are optional; the service falls back to the last
 * 365 local days when they are omitted, which is the range a user almost always
 * means by "everything".
 */
export const exportQuery = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
    dataset: z.enum(['all', 'sessions', 'tasks', 'subjects', 'analytics']).default('all'),
    from: dayKey.optional(),
    to: dayKey.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start date must not be after the end date.',
    path: ['from'],
  });

export const listQuery = z.object({ ...pagination }).strict();
