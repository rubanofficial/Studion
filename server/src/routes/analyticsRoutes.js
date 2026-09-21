/**
 * Analytics routes.
 *
 * Read-only, and the most expensive endpoints in the app, so each is explicit
 * about what it returns: a period summary, a heatmap, a calendar month, one day,
 * or the overview the cockpit boots from.
 *
 * `/stats/overview` lives here rather than under `/sessions` because it is an
 * aggregate, not a session.
 */

import { Router } from 'express';

import * as analytics from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { analyticsQuery, calendarQuery, dayDetailQuery, heatmapQuery } from '../validators/resources.js';

const router = Router();

router.use(requireAuth);

// ------------------------------------------------------------------ analytics
router.get('/', validate({ query: analyticsQuery }), analytics.getAnalytics);
router.get('/heatmap', validate({ query: heatmapQuery }), analytics.getHeatmap);
router.get('/calendar', validate({ query: calendarQuery }), analytics.getCalendar);
router.get('/day', validate({ query: dayDetailQuery }), analytics.getDay);
router.get(
  '/trend',
  validate({ query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }) }),
  analytics.getMonthlyTrend,
);

// -------------------------------------------------------------------- reviews
router.get('/review/daily', validate({ query: dayDetailQuery }), analytics.getDailyReview);
router.get('/review/weekly', validate({ query: analyticsQuery }), analytics.getWeeklyReview);

// -------------------------------------------------------------------- cockpit
router.get('/stats/overview', analytics.getOverview);

// --------------------------------------------------------------- achievements
router.get('/achievements', analytics.listAchievements);
router.post(
  '/achievements/seen',
  validate({ body: z.object({ keys: z.array(z.string().trim().max(60)).max(100).optional() }) }),
  analytics.markAchievementsSeen,
);

export default router;
