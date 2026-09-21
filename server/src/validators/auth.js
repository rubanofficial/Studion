/**
 * Authentication request schemas.
 *
 * Password rules are enforced on the server as the authority and mirrored in the
 * UI purely for feedback. Note the deliberate absence of character-class
 * requirements: length is the property that actually resists offline cracking,
 * and composition rules mostly push people towards `Password1!`.
 */

import { z } from 'zod';

import { strictBody, timeZone } from './common.js';

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'An email address is required.')
  .max(254, 'That email address is too long.')
  .email('That does not look like a valid email address.');

export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const registerSchema = strictBody({
  email,
  password,
  name: z.string().trim().min(1, 'A name is required.').max(80),
  timeZone: timeZone.optional(),
});

export const loginSchema = strictBody({
  email,
  password: z.string().min(1, 'A password is required.').max(200),
});

export const refreshSchema = strictBody({}).partial();

export const updateProfileSchema = strictBody({
  name: z.string().trim().min(1).max(80).optional(),
  timeZone: timeZone.optional(),
});

export const changePasswordSchema = strictBody({
  currentPassword: z.string().min(1, 'Your current password is required.').max(200),
  newPassword: password,
});

export const deleteAccountSchema = strictBody({
  password: z.string().min(1, 'Confirm your password to delete the account.').max(200),
  /** Typed confirmation so an accidental request cannot erase an account. */
  confirm: z.literal('DELETE', { errorMap: () => ({ message: 'Type DELETE to confirm.' }) }),
});

export const onboardingSchema = strictBody({
  subjectNames: z.array(z.string().trim().min(1).max(60)).min(1, 'Pick at least one thing to focus on.').max(12),
  dailyGoalSeconds: z.number().int().min(600).max(16 * 3600),
  successThresholdSeconds: z.number().int().min(300).max(8 * 3600).optional(),
  weekStart: z.coerce.number().int().min(0).max(6).optional(),
  timeZone: timeZone.optional(),
});
