/**
 * Authentication routes.
 *
 * The credential endpoints (`register`, `login`, `refresh`) sit behind the tight
 * `authLimiter` rather than the general API limit, because password guessing is
 * the realistic attack and legitimate users touch these a handful of times a day.
 *
 * `refresh` is included even though it takes no password: it is the endpoint a
 * stolen cookie would be replayed against, so it deserves the same budget.
 */

import { Router } from 'express';

import * as authController from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/security.js';
import { validate } from '../middleware/validate.js';
import {
  changePasswordSchema,
  deleteAccountSchema,
  loginSchema,
  onboardingSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators/auth.js';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', requireAuth, authController.me);
router.patch('/me', requireAuth, validate({ body: updateProfileSchema }), authController.updateProfile);
router.post(
  '/change-password',
  requireAuth,
  authLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
router.post('/logout-all', requireAuth, authController.logoutEverywhere);
router.post('/delete-account', requireAuth, authLimiter, validate({ body: deleteAccountSchema }), authController.deleteAccount);
router.post('/onboarding', requireAuth, validate({ body: onboardingSchema }), authController.completeOnboarding);
router.get('/onboarding/options', authController.getStarterOptions);

export default router;
