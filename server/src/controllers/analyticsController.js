/**
 * Analytics, cockpit, achievement, settings and export controllers.
 *
 * These are read-mostly and share one concern: resolving the timezone every
 * analytics answer depends on. That resolution happens once, here, through
 * `resolveAnalyticsTimeZone`, so a screen, a review and an export can never bucket
 * the same data differently.
 */

import { buildPeriod } from '@focusforge/core';

import * as achievementService from '../services/achievementService.js';
import * as analyticsService from '../services/analyticsService.js';
import * as exportService from '../services/exportService.js';
import * as goalService from '../services/goalService.js';
import * as sessionService from '../services/sessionService.js';
import * as settingsService from '../services/settingsService.js';
import * as statsService from '../services/statsService.js';
import * as taskService from '../services/taskService.js';
import { nameAndColorMap } from '../services/subjectService.js';
import { parseReference, resolveAnalyticsTimeZone, todayKey } from '../services/support.js';
import { sendData } from '../utils/http.js';

/**
 * Load the settings that every analytics query needs: timezone, thresholds,
 * week start and the daily goal.
 * @param {any} user
 * @param {any} query
 */
async function contextFor(user, query) {
  const settings = await settingsService.getOrCreate(user._id);
  return {
    settings,
    timeZone: resolveAnalyticsTimeZone({ requested: query?.timeZone, saved: settings.timeZone }),
  };
}

// ------------------------------------------------------------------ analytics

/** @type {import('express').RequestHandler} */
export async function getAnalytics(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);

  const result = await analyticsService.periodSummary(user, settings, {
    period: query.period,
    reference: parseReference(query.reference ?? query.anchor),
    compare: query.compare,
    timeZone,
    weekStart: query.weekStart ?? settings.weekStart,
    subjectId: query.subjectId,
  });

  sendData(res, result);
}

/** @type {import('express').RequestHandler} */
export async function getHeatmap(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);
  sendData(res, await analyticsService.heatmap(user, settings, { ...query, timeZone }));
}

/** @type {import('express').RequestHandler} */
export async function getCalendar(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);
  sendData(res, await analyticsService.calendar(user, settings, { ...query, timeZone }));
}

/** @type {import('express').RequestHandler} */
export async function getDay(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);
  sendData(res, await analyticsService.dayDetail(user, settings, { ...query, timeZone }));
}

/** @type {import('express').RequestHandler} */
export async function getDailyReview(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);
  sendData(res, await analyticsService.dailyReview(user, settings, { ...query, timeZone }));
}

/** @type {import('express').RequestHandler} */
export async function getWeeklyReview(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const { settings, timeZone } = await contextFor(user, query);
  sendData(
    res,
    await analyticsService.weeklyReview(user, settings, {
      reference: parseReference(query.reference ?? query.anchor),
      timeZone,
    }),
  );
}

/** @type {import('express').RequestHandler} */
export async function getMonthlyTrend(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  const settings = await settingsService.getOrCreate(user._id);
  // @ts-expect-error set by the validate middleware
  const year = Number(req.validated.query.year ?? todayKey(settings.timeZone).slice(0, 4));
  sendData(res, await analyticsService.monthlyTrend(user, settings, { year }));
}

// --------------------------------------------------------------- cockpit home

/**
 * Everything the first screen needs, in one round trip.
 *
 * `nextTask`, `dueSoon` and the subject colour map are fetched in parallel with
 * the rollups rather than sequentially, because the cockpit is the one screen
 * where an extra round trip is immediately visible.
 * @type {import('express').RequestHandler}
 */
export async function getOverview(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  const settings = await settingsService.getOrCreate(user._id);

  const [openReconciled, subjects, nextTask, dueSoon] = await Promise.all([
    sessionService.currentSession(user),
    nameAndColorMap(user._id),
    taskService.nextTask(user._id),
    taskService.dueSoon(user._id),
  ]);

  const result = await statsService.overview(user._id, settings, {
    subjects,
    nextTask,
    dueSoon,
    openRecord: openReconciled.openRecord,
  });

  const goals = await goalService.evaluate(user._id, settings, {});
  const achievements = await achievementService.list(user._id, settings);

  sendData(res, {
    ...result,
    /** Raw open-session document view, with the event log, for reconciliation. */
    openSession: openReconciled.openSession,
    reconciled: openReconciled.reconciled,
    goals: goals.goals,
    goalStatus: goals.status,
    achievements: {
      unlockedCount: achievements.unlockedCount,
      totalCount: achievements.totalCount,
      unseenCount: achievements.unseenCount,
      next: achievements.inProgress.slice(0, 3),
    },
  });
}

// --------------------------------------------------------------- achievements

/** @type {import('express').RequestHandler} */
export async function listAchievements(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  const settings = await settingsService.getOrCreate(user._id);
  sendData(res, await achievementService.list(user._id, settings));
}

/** @type {import('express').RequestHandler} */
export async function markAchievementsSeen(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const keys = req.validated.body?.keys;
  sendData(res, await achievementService.markSeen(user._id, keys));
}

// ------------------------------------------------------------------- settings

/** @type {import('express').RequestHandler} */
export async function getSettings(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  const settings = await settingsService.getOrCreate(user._id);
  sendData(res, { settings: settingsService.toPublicSettings(settings) });
}

/** @type {import('express').RequestHandler} */
export async function updateSettings(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const settings = await settingsService.update(user._id, req.validated.body);

  // Changing the timezone re-buckets history, so the affected rollups are rebuilt
  // on the spot rather than being discovered as stale by the next analytics read.
  if (req.validated.body.timeZone) {
    const period = buildPeriod('year', { reference: new Date(), timeZone: settings.timeZone, weekStart: settings.weekStart });
    await statsService.backfill(user._id, {
      fromKey: period.fromKey,
      toKey: todayKey(settings.timeZone),
      timeZone: settings.timeZone,
      successThresholdSeconds: settings.successThresholdSeconds,
    });
  }

  sendData(res, { settings: settingsService.toPublicSettings(settings) });
}

// --------------------------------------------------------------------- export

/** @type {import('express').RequestHandler} */
export async function downloadExport(req, res) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  // @ts-expect-error set by the validate middleware
  const query = req.validated.query;
  const settings = await settingsService.getOrCreate(user._id);
  const timeZone = resolveAnalyticsTimeZone({ saved: settings.timeZone });

  const range = query.from && query.to ? { fromKey: query.from, toKey: query.to } : defaultExportRange(timeZone);
  const result = await exportService.build(user, settings, {
    fromKey: range.fromKey,
    toKey: range.toKey,
    dataset: query.dataset,
    format: query.format,
  });

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  // Exports can be large; never let a proxy hold a stale copy.
  res.setHeader('Cache-Control', 'no-store');
  res.send(result.body);
}

/** @param {string} timeZone */
function defaultExportRange(timeZone) {
  const toKey = todayKey(timeZone);
  const from = new Date(Date.parse(`${toKey}T00:00:00Z`) - 364 * 86_400_000);
  return { fromKey: from.toISOString().slice(0, 10), toKey };
}

/** What the application stores and why, rendered verbatim by the privacy screen. */
export const getDataStatement = (_req, res) => sendData(res, { statement: exportService.dataStatement() });

/** Feature detection for the client, so it can hide what the server cannot do. */
export const getCapabilities = (_req, res) =>
  sendData(res, {
    capabilities: {
      offlineSync: true,
      idleDetection: true,
      csvExport: true,
      jsonExport: true,
      achievements: true,
      heatmap: true,
      commandPalette: true,
    },
  });
