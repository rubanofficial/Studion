/**
 * Session routes.
 *
 * The full timer lifecycle. Named transitions (`pause`, `resume`, `break`) exist
 * alongside the generic `events` batch for two reasons: they make the API
 * self-documenting, and they let a transition be its own immediate request when
 * latency matters (pressing pause should not wait for a batched flush).
 *
 * `current` and `start` are the only two a cold client needs to reconcile a
 * running timer on a new device.
 */

import { Router } from 'express';

import * as sessionController from '../controllers/sessionController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { idParam } from '../validators/params.js';
import {
  appendEventsSchema,
  closeSessionSchema,
  distractionSchema,
  extendSessionSchema,
  heartbeatSchema,
  listSessionsQuery,
  startSessionSchema,
  updateSessionSchema,
} from '../validators/session.js';

const router = Router();

router.use(requireAuth);

router.get('/', validate({ query: listSessionsQuery }), sessionController.list);
router.get('/current', sessionController.current);
router.get('/distraction-options', sessionController.getDistractionOptions);

router.post('/', validate({ body: startSessionSchema }), sessionController.start);
router.get('/:id', validate({ params: idParam }), sessionController.preview);
router.patch('/:id', validate({ params: idParam, body: updateSessionSchema }), sessionController.update);
router.delete('/:id', validate({ params: idParam }), sessionController.remove);

// ------------------------------------------------------------------ lifecycle
router.post('/:id/events', validate({ params: idParam, body: appendEventsSchema }), sessionController.appendEvents);
router.post('/:id/pause', validate({ params: idParam, body: heartbeatSchema }), sessionController.pause);
router.post('/:id/resume', validate({ params: idParam, body: heartbeatSchema }), sessionController.resume);
router.post('/:id/break', validate({ params: idParam, body: heartbeatSchema }), sessionController.breakStart);
router.post('/:id/break/end', validate({ params: idParam, body: heartbeatSchema }), sessionController.breakEnd);
router.post('/:id/heartbeat', validate({ params: idParam, body: heartbeatSchema }), sessionController.heartbeat);
router.post('/:id/distractions', validate({ params: idParam, body: distractionSchema }), sessionController.distraction);
router.post('/:id/extend', validate({ params: idParam, body: extendSessionSchema }), sessionController.extend);
router.post('/:id/complete', validate({ params: idParam, body: closeSessionSchema }), sessionController.complete);

export default router;
