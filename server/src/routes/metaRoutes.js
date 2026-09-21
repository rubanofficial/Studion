/**
 * Meta routes.
 *
 * These expose the vocabulary and rules the application runs on, so the client
 * never hard-codes them: the distraction taxonomy, the onboarding subject
 * suggestions, the achievement catalogue and the scoring weights. When one of
 * these changes on the server, the UI updates without a client release — and,
 * more importantly, the explanation a user reads is generated from the same
 * constants that produced the number.
 */

import { Router } from 'express';

import { ACHIEVEMENTS, DISTRACTION_LABELS, FOCUS_SCORE_WEIGHTS, HEARTBEAT_INTERVAL_MS, IDLE_GAP_MS } from '@focusforge/core';

import { starterOptions } from '../services/onboardingService.js';
import { sendData } from '../utils/http.js';

const router = Router();

/** Public: a signed-out visitor to the landing page may want the taxonomy. */
router.get('/distractions', (_req, res) =>
  sendData(res, {
    options: Object.entries(DISTRACTION_LABELS).map(([kind, labels]) => ({ kind, ...labels })),
  }),
);

router.get('/starter-subjects', (_req, res) => sendData(res, { options: starterOptions() }));

/**
 * How the Focus Score is calculated, including the weights.
 *
 * Published deliberately. A score the user cannot inspect is a score they will
 * eventually distrust, so the formula is part of the API surface rather than a
 * private implementation detail.
 */
router.get('/focus-score', (_req, res) =>
  sendData(res, {
    weights: FOCUS_SCORE_WEIGHTS,
    formula:
      'Focus Score = 100 x (0.30 x completion + 0.25 x timeInFocus + 0.18 x interruptionControl + 0.17 x distractionControl + 0.10 x outcome)',
    factors: {
      completion: 'min(1, focused seconds / planned seconds)',
      timeInFocus: 'focused seconds / wall seconds while the session was open',
      interruptionControl: 'e^(-pauses / 3)',
      distractionControl: 'e^(-(distractions per focused hour) / 2)',
      outcome: 'completed = 1.0, interrupted = 0.5, cancelled = 0',
    },
    notes: [
      'Sessions under 60 focused seconds are not scored.',
      'No randomness and no time-of-day bonus: the same session always scores the same.',
      'Consistency is measured per period as the Focus Index, never per session.',
    ],
    timing: { heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS, idleGapMs: IDLE_GAP_MS },
  }),
);

router.get('/achievements', (_req, res) =>
  sendData(res, {
    achievements: ACHIEVEMENTS.map(({ metric, ...rest }) => rest),
  }),
);

export default router;
