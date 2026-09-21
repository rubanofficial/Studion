/**
 * Settings and export routes.
 *
 * Both are "whole account" operations rather than resources: settings describe
 * how the application behaves, and export describes how to take everything out.
 * Keeping them together makes the account-level surface easy to audit.
 */

import { Router } from 'express';

import * as analytics from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { updateSettingsSchema } from '../validators/resources.js';

const router = Router();

router.use(requireAuth);

router.get('/', analytics.getSettings);
router.patch('/', validate({ body: updateSettingsSchema }), analytics.updateSettings);

export default router;
