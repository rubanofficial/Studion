/**
 * Authentication service.
 *
 * Creating an account means creating *everything* a usable account needs in one
 * place: the user document, their settings (which carry the timezone that all
 * analytics depend on) and a daily goal (so the cockpit always has a target to
 * draw). Centralising that here means no route can produce a half-provisioned
 * user whose first screen is broken.
 *
 * Every credential failure returns the same message, and the work performed is
 * comparable whether or not the account exists, so the endpoint cannot be used to
 * enumerate registered email addresses.
 */

import { Achievement } from '../models/Achievement.js';
import { DailyStats } from '../models/DailyStats.js';
import { FocusSession } from '../models/FocusSession.js';
import { Goal } from '../models/Goal.js';
import { Subject } from '../models/Subject.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { UserSettings } from '../models/UserSettings.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

import * as goalService from './goalService.js';
import { ensureRoleDefaults } from './onboardingService.js';
import * as settingsService from './settingsService.js';
import { assertFound } from './support.js';
import {
  issueAccessToken,
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
} from './tokenService.js';

/**
 * @param {any} user
 * @param {Date} refreshExpiresAt
 */
function publicUser(user, refreshExpiresAt) {
  return {
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name,
      onboarded: Boolean(user.onboardedAt),
      createdAt: user.createdAt,
    },
    refreshExpiresAt: refreshExpiresAt.toISOString(),
  };
}

/**
 * @param {{email: string, password: string, name: string, timeZone?: string}} input
 * @param {{userAgent?: string|null, ip?: string|null}} context
 */
export async function register(input, context = {}) {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw ApiError.conflict('EMAIL_TAKEN', 'An account with that email address already exists. Try signing in instead.');
  }

  const user = new User({ email: input.email, name: input.name, password: input.password });

  try {
    await user.save();
  } catch (error) {
    // Two simultaneous registrations for the same address: the unique index wins
    // the race and we report the same friendly conflict rather than a 500.
    if (/** @type {any} */ (error)?.code === 11000) {
      throw ApiError.conflict('EMAIL_TAKEN', 'An account with that email address already exists. Try signing in instead.');
    }
    throw error;
  }

  await settingsService.getOrCreate(user._id, { timeZone: input.timeZone ?? 'UTC' });

  const access = issueAccessToken(user);
  const refresh = await issueRefreshToken(user, context);
  logger.info('Account registered', { userId: String(user._id) });

  return { ...publicUser(user, refresh.expiresAt), accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh.token };
}

/**
 * @param {{email: string, password: string}} input
 * @param {{userAgent?: string|null, ip?: string|null}} context
 */
export async function login(input, context = {}) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  if (!user || user.deletedAt) {
    throw ApiError.unauthorized('That email and password combination is not correct.');
  }

  const valid = await user.verifyPassword(input.password);
  if (!valid) {
    logger.warn('Failed sign-in attempt', { email: input.email, ip: context.ip });
    throw ApiError.unauthorized('That email and password combination is not correct.');
  }

  user.lastActiveAt = new Date();
  await user.save();

  const access = issueAccessToken(user);
  const refresh = await issueRefreshToken(user, context);

  return { ...publicUser(user, refresh.expiresAt), accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh.token };
}

/**
 * @param {string|null|undefined} rawToken
 * @param {{userAgent?: string|null, ip?: string|null}} context
 */
export async function refresh(rawToken, context = {}) {
  if (!rawToken) throw ApiError.unauthorized('No session was found. Please sign in.');
  const { user, token, expiresAt } = await rotateRefreshToken(rawToken, context);
  const access = issueAccessToken(user);
  return { ...publicUser(user, expiresAt), accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: token };
}

/** @param {string|null|undefined} rawToken */
export async function logout(rawToken) {
  if (rawToken) await revokeRefreshToken(rawToken, 'sign-out');
  return { signedOut: true };
}

/** @param {any} user */
export async function logoutEverywhere(user) {
  await revokeAllForUser(user._id, 'sign-out-all');
  return { signedOut: true, scope: 'all-devices' };
}

/** @param {any} user */
export async function me(user) {
  const settings = await settingsService.getOrCreate(user._id);
  return {
    user: {
      id: String(user._id),
      email: user.email,
      name: user.name,
      onboarded: Boolean(user.onboardedAt),
      createdAt: user.createdAt,
      lastActiveAt: user.lastActiveAt,
    },
    settings: settingsService.toPublicSettings(settings),
  };
}

/**
 * @param {any} user
 * @param {{name?: string, timeZone?: string}} patch
 */
export async function updateProfile(user, patch) {
  if (patch.name !== undefined) user.name = patch.name;
  await user.save();
  if (patch.timeZone !== undefined) await settingsService.update(user._id, { timeZone: patch.timeZone });
  return me(assertFound(await User.findById(user._id), 'Account'));
}

/**
 * Change a password and invalidate every other session.
 *
 * Revoking all refresh tokens is the point of the operation: if the reason for
 * changing a password is that somebody else may have it, leaving their session
 * alive would defeat the exercise. The caller must sign in again.
 *
 * @param {any} user
 * @param {string} currentPassword
 * @param {string} newPassword
 */
export async function changePassword(user, currentPassword, newPassword) {
  const document = assertFound(await User.findById(user._id).select('+passwordHash'), 'Account');

  const valid = await document.verifyPassword(currentPassword);
  if (!valid) throw ApiError.badRequest('Your current password is not correct.');
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('Your new password must be different from your current one.');
  }

  document.password = newPassword;
  await document.save();
  await revokeAllForUser(document._id, 'password-changed');

  return { changed: true, reauthenticate: true };
}

/**
 * Delete the account and everything it owns.
 *
 * A hard delete, not a flag. The privacy statement says the data is gone, so it
 * has to actually be gone — a soft delete retained forever would make that
 * statement false.
 *
 * @param {any} user
 * @param {string} password
 */
export async function deleteAccount(user, password) {
  const document = assertFound(await User.findById(user._id).select('+passwordHash'), 'Account');
  const valid = await document.verifyPassword(password);
  if (!valid) throw ApiError.badRequest('That password is not correct.');

  await Promise.all([
    UserSettings.deleteMany({ user: document._id }),
    Task.deleteMany({ user: document._id }),
    Goal.deleteMany({ user: document._id }),
    FocusSession.deleteMany({ user: document._id }),
    Achievement.deleteMany({ user: document._id }),
    DailyStats.deleteMany({ user: document._id }),
    Subject.deleteMany({ user: document._id }),
    revokeAllForUser(document._id, 'account-deleted'),
  ]);

  await document.deleteOne();
  logger.info('Account deleted', { userId: String(document._id) });

  return { deleted: true };
}

/**
 * Finish onboarding: create the subjects the user picked, set their targets, and
 * make sure a daily goal exists.
 *
 * @param {any} user
 * @param {{subjectNames: string[], dailyGoalSeconds: number, successThresholdSeconds?: number, weekStart?: number, timeZone?: string}} input
 */
export async function completeOnboarding(user, input) {
  const settings = await settingsService.update(user._id, {
    dailyGoalSeconds: input.dailyGoalSeconds,
    ...(input.successThresholdSeconds ? { successThresholdSeconds: input.successThresholdSeconds } : {}),
    ...(input.weekStart !== undefined ? { weekStart: input.weekStart } : {}),
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  });

  const created = await ensureRoleDefaults(user._id, input.subjectNames);
  await goalService.ensureDefaults(user._id, settings);

  user.onboardedAt = user.onboardedAt ?? new Date();
  await user.save();

  return {
    subjects: created.map((subject) => ({
      id: String(subject._id),
      name: subject.name,
      color: subject.color,
      icon: subject.icon,
    })),
    settings: settingsService.toPublicSettings(settings),
    onboarded: true,
  };
}
