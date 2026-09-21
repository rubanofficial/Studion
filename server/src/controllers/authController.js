/**
 * Auth controller.
 *
 * Controllers in this app do three things and nothing else: read validated input,
 * call a service, and shape the HTTP response (status code, cookies, headers). No
 * business rules live here, so every rule stays testable without HTTP.
 */

import { starterOptions } from '../services/onboardingService.js';
import * as authService from '../services/authService.js';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from '../services/tokenService.js';
import { sendData, sendNoContent } from '../utils/http.js';

/** @param {import('express').Request} req */
function context(req) {
  return { userAgent: req.get?.('user-agent') ?? null, ip: req.ip ?? null };
}

/** @type {import('express').RequestHandler} */
export async function register(req, res) {
  // @ts-expect-error set by the validate middleware
  const result = await authService.register(req.validated.body, context(req));
  setRefreshCookie(res, result.refreshToken, new Date(result.refreshExpiresAt));
  const { refreshToken, ...body } = result;
  void refreshToken;
  sendData(res, body, { status: 201 });
}

/** @type {import('express').RequestHandler} */
export async function login(req, res) {
  // @ts-expect-error set by the validate middleware
  const result = await authService.login(req.validated.body, context(req));
  setRefreshCookie(res, result.refreshToken, new Date(result.refreshExpiresAt));
  const { refreshToken, ...body } = result;
  void refreshToken;
  sendData(res, body);
}

/**
 * Exchange the refresh cookie for a new access token.
 *
 * The refresh token is read from the httpOnly cookie rather than the body, so a
 * script on the page cannot read or replay it.
 * @type {import('express').RequestHandler}
 */
export async function refresh(req, res) {
  const raw = req.cookies?.[REFRESH_COOKIE];
  try {
    const result = await authService.refresh(raw, context(req));
    setRefreshCookie(res, result.refreshToken, new Date(result.refreshExpiresAt));
    const { refreshToken, ...body } = result;
    void refreshToken;
    sendData(res, body);
  } catch (error) {
    // A rejected refresh must also clear the dead cookie, or the browser will
    // keep sending it and every subsequent request pays for a failing round trip.
    clearRefreshCookie(res);
    throw error;
  }
}

/** @type {import('express').RequestHandler} */
export async function logout(req, res) {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearRefreshCookie(res);
  sendNoContent(res);
}

/** @type {import('express').RequestHandler} */
export async function logoutEverywhere(req, res) {
  // @ts-expect-error set by requireAuth
  const result = await authService.logoutEverywhere(req.user);
  clearRefreshCookie(res);
  sendData(res, result);
}

/** @type {import('express').RequestHandler} */
export async function me(req, res) {
  // @ts-expect-error set by requireAuth
  sendData(res, await authService.me(req.user));
}

/** @type {import('express').RequestHandler} */
export async function updateProfile(req, res) {
  // @ts-expect-error set by requireAuth
  sendData(res, await authService.updateProfile(req.user, req.validated.body));
}

/** @type {import('express').RequestHandler} */
export async function changePassword(req, res) {
  // @ts-expect-error set by requireAuth
  const { currentPassword, newPassword } = req.validated.body;
  sendData(res, await authService.changePassword(req.user, currentPassword, newPassword));
  clearRefreshCookie(res);
}

/** @type {import('express').RequestHandler} */
export async function deleteAccount(req, res) {
  // @ts-expect-error set by requireAuth
  const result = await authService.deleteAccount(req.user, req.validated.body.password);
  clearRefreshCookie(res);
  sendData(res, result);
}

/** @type {import('express').RequestHandler} */
export async function completeOnboarding(req, res) {
  // @ts-expect-error set by requireAuth
  sendData(res, await authService.completeOnboarding(req.user, req.validated.body));
}

/** Public list of onboarding suggestions, so the UI does not hard-code them. */
export const getStarterOptions = (_req, res) => sendData(res, { options: starterOptions() });
