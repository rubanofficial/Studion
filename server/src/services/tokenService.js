/**
 * Token issuing and rotation.
 *
 * Two tokens, two jobs:
 *
 *   - **Access token** — a JWT with a 15 minute life, held in memory by the
 *     client and sent as `Authorization: Bearer`. Never stored, never in a
 *     cookie, so an XSS payload cannot lift a long-lived credential and a
 *     cross-site request cannot ride an existing session.
 *   - **Refresh token** — a 256-bit opaque random string, stored only as a
 *     SHA-256 hash, delivered in an httpOnly cookie scoped to `/api/auth`.
 *     It is rotated on every use.
 *
 * Why rotation matters
 * --------------------
 * Rotating means a stolen refresh token is usable at most once. More usefully, it
 * makes theft *detectable*: if a token that has already been exchanged is
 * presented again, either the thief or the victim is replaying it. We cannot tell
 * which, so the whole rotation family is revoked and both parties must sign in
 * again. Safe failure, and it is the standard OAuth 2.0 recommended behaviour.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

export const REFRESH_COOKIE = 'ff_refresh';
/** Scoped so the refresh cookie is never attached to ordinary API calls. */
export const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Sign an access token and report when it expires.
 *
 * The expiry is read back off the signed token rather than recomputed from the
 * TTL, so the value the client is told can never drift from the value the token
 * actually carries.
 *
 * @param {any} user
 * @returns {{token: string, expiresAt: Date}}
 */
export function issueAccessToken(user) {
  const token = jwt.sign({ sub: String(user._id), email: user.email }, env.accessSecret, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'focusforge',
    audience: 'focusforge-web',
  });
  const decoded = /** @type {any} */ (jwt.decode(token));
  return { token, expiresAt: new Date((decoded?.exp ?? Math.floor(Date.now() / 1000) + 900) * 1000) };
}

/**
 * @param {string} token
 * @returns {{sub: string, email?: string, iat?: number, exp?: number}}
 */
export function verifyAccessToken(token) {
  try {
    return /** @type {any} */ (
      jwt.verify(token, env.accessSecret, { issuer: 'focusforge', audience: 'focusforge-web' })
    );
  } catch (error) {
    if (/** @type {any} */ (error)?.name === 'TokenExpiredError') {
      throw new ApiError(401, 'TOKEN_EXPIRED', 'Your session expired. Please sign in again.', { retryable: false });
    }
    throw ApiError.unauthorized('That sign-in token is not valid.');
  }
}

/** @param {string} raw */
export function hashToken(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

/** @returns {string} 256 bits of URL-safe randomness */
function generateOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

/** @param {string|undefined} ip */
function ipPrefix(ip) {
  if (!ip) return null;
  // Store only the network portion. Enough to spot a hijacked session, not
  // enough to be a location record.
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip.split('.').slice(0, 3).join('.');
}

/**
 * Start a new rotation family. Called once per successful sign-in.
 *
 * @param {any} user
 * @param {{userAgent?: string|null, ip?: string|null}} [context]
 * @returns {Promise<{token: string, expiresAt: Date}>}
 */
export async function issueRefreshToken(user, context = {}) {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    familyId: randomUUID(),
    expiresAt,
    userAgent: context.userAgent ? String(context.userAgent).slice(0, 300) : null,
    ipPrefix: ipPrefix(context.ip ?? undefined),
  });

  return { token, expiresAt };
}

/**
 * Exchange a refresh token for a new one.
 *
 * @param {string} raw
 * @param {{userAgent?: string|null, ip?: string|null}} [context]
 * @returns {Promise<{user: any, token: string, expiresAt: Date}>}
 */
export async function rotateRefreshToken(raw, context = {}) {
  const existing = await RefreshToken.findOne({ tokenHash: hashToken(raw) }).populate('user');
  if (!existing) throw ApiError.unauthorized('That session is no longer valid. Please sign in again.');

  if (existing.revokedAt) {
    // Replay of an already-exchanged token: assume compromise and burn the
    // family. This is the whole point of rotation.
    logger.warn('Refresh token reuse detected — revoking family', {
      userId: String(existing.user?._id ?? existing.user),
      familyId: existing.familyId,
    });
    await revokeFamily(existing.familyId, 'reuse-detected');
    throw ApiError.unauthorized('For your security this session was ended. Please sign in again.');
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('That session expired. Please sign in again.');
  }

  const user = /** @type {any} */ (existing.user);
  if (!user || user.deletedAt) throw ApiError.unauthorized('That account is no longer available.');

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  // Mark the old one revoked and point it at its successor in a single write, so
  // a crash between the two cannot leave a usable token with no audit trail.
  await RefreshToken.updateOne(
    { _id: existing._id },
    { $set: { revokedAt: new Date(), revokedReason: 'rotated', replacedByHash: hashToken(token) } },
  );

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    familyId: existing.familyId,
    expiresAt,
    userAgent: context.userAgent ? String(context.userAgent).slice(0, 300) : null,
    ipPrefix: ipPrefix(context.ip ?? undefined),
  });

  return { user, token, expiresAt };
}

/**
 * @param {string} raw
 * @param {string} reason
 * @returns {Promise<boolean>} whether a live token was found and revoked
 */
export async function revokeRefreshToken(raw, reason = 'sign-out') {
  const result = await RefreshToken.updateOne(
    { tokenHash: hashToken(raw), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount > 0;
}

/**
 * @param {string} familyId
 * @param {string} reason
 */
export async function revokeFamily(familyId, reason) {
  await RefreshToken.updateMany({ familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/**
 * Sign out everywhere. Used on password change and on account deletion.
 * @param {any} userId
 * @param {string} reason
 */
export async function revokeAllForUser(userId, reason = 'revoke-all') {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
}

/**
 * @param {import('express').Response} res
 * @param {string} token
 * @param {Date} expiresAt
 */
export function setRefreshCookie(res, token, expiresAt) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // SameSite=None requires Secure; in local development over http we must use
    // Lax or the browser silently drops the cookie.
    sameSite: env.cookieSecure ? 'none' : 'lax',
    secure: env.cookieSecure,
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

/** @param {import('express').Response} res */
export function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: env.cookieSecure ? 'none' : 'lax',
    secure: env.cookieSecure,
    path: REFRESH_COOKIE_PATH,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });
}

/**
 * Housekeeping for tokens that expired without being rotated.
 *
 * The TTL index already removes these, but TTL reaping is best-effort (roughly
 * once a minute) and is not a correctness guarantee — this keeps the collection
 * tidy on a predictable schedule and is safe to run concurrently.
 * @returns {Promise<number>}
 */
export async function pruneExpiredTokens() {
  const result = await RefreshToken.deleteMany({ expiresAt: { $lt: new Date() } });
  return result.deletedCount ?? 0;
}
