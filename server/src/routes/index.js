/**
 * Route table.
 *
 * Every router is mounted here so the whole surface of the API is visible in one
 * file — which is the point. An API whose shape is spread across a dozen module
 * initialisers is one where a route eventually gets mounted without its limiter
 * or without authentication.
 *
 * Rate limiting is applied by the caller (`app.js`), which mounts this router
 * behind the general API limiter. That ordering is deliberate: Express applies
 * middleware in registration order, so a limiter added *after* these mounts would
 * silently do nothing. Health and the auth credential endpoints are the two
 * exceptions, and both are registered around the limiter rather than inside it.
 */

import { Router } from 'express';

import { downloadExport, getCapabilities, getDataStatement } from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { exportQuery } from '../validators/resources.js';
import { sendData } from '../utils/http.js';
import analyticsRouter from './analyticsRoutes.js';
import authRouter from './authRoutes.js';
import { goalRouter, subjectRouter, taskRouter } from './contentRoutes.js';
import metaRouter from './metaRoutes.js';
import sessionRouter from './sessionRoutes.js';
import settingsRouter from './settingsRoutes.js';

const router = Router();

router.use('/auth', authRouter);
router.use('/sessions', sessionRouter);
router.use('/subjects', subjectRouter);
router.use('/tasks', taskRouter);
router.use('/goals', goalRouter);
router.use('/analytics', analyticsRouter);
router.use('/settings', settingsRouter);
router.use('/meta', metaRouter);

// Exposed at the top level because they describe the application, not a resource.
router.get('/capabilities', getCapabilities);
router.get('/privacy/data-statement', getDataStatement);

/**
 * Take your data with you. JSON is lossless (it includes the raw event log, so a
 * re-import could reconstruct every duration exactly); CSV is for spreadsheets.
 */
router.get('/export', requireAuth, validate({ query: exportQuery }), downloadExport);

export default router;

/**
 * Health check. Mounted separately, ahead of the limiter, so a load balancer
 * probe can never be throttled by application traffic.
 */
export function healthRouter() {
  const health = Router();
  health.get('/', (_req, res) =>
    sendData(res, {
      status: 'ok',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );
  return health;
}
