/**
 * Authentication middleware.
 *
 * The access token is a short-lived JWT carried in the `Authorization: Bearer`
 * header. It is deliberately *not* read from a cookie: keeping it out of cookies
 * means a cross-site request cannot ride an existing session, which removes the
 * usual CSRF surface for every mutating endpoint. The refresh token, which is in
 * a cookie, is only ever sent to one endpoint.
 */

import { ApiError } from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { User } from '../models/User.js';

/**
 * Extract a bearer token, tolerating the casing and whitespace variations that
 * real clients produce.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function bearerToken(req) {
  const header = req.get?.('authorization') ?? req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Verify the token and attach the live user document.
 * @param {import('express').Request} req
 * @returns {Promise<any>}
 */
async function resolveUser(req) {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized('You need to sign in to do that.');

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('That account no longer exists.');
  if (user.deletedAt) throw ApiError.forbidden('This account has been deleted.');

  // A password change invalidates every token issued before it, so changing a
  // password after a suspected compromise actually logs the attacker out.
  if (user.passwordChangedAt && payload.iat) {
    const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
    if (payload.iat < changedAtSeconds - 1) {
      throw ApiError.unauthorized('Your password was changed. Please sign in again.');
    }
  }

  return user;
}

/** @type {import('express').RequestHandler} */
export function requireAuth(req, _res, next) {
  resolveUser(req)
    .then((user) => {
      // @ts-expect-error augmenting the request
      req.user = user;
      next();
    })
    .catch(next);
}

/**
 * Attach the user when a valid token is present, but never reject. Used by
 * endpoints that behave slightly differently when signed in (for example a
 * public health/demo surface) without making them private.
 * @type {import('express').RequestHandler}
 */
export function optionalAuth(req, _res, next) {
  resolveUser(req)
    .then((user) => {
      // @ts-expect-error augmenting the request
      req.user = user;
      next();
    })
    .catch(() => next());
}

/**
 * Update the coarse "last active" marker. Fire-and-forget: a failure here must
 * never fail the user's actual request.
 * @type {import('express').RequestHandler}
 */
export function touchActivity(req, _res, next) {
  // @ts-expect-error set by requireAuth
  const user = req.user;
  if (user) {
    const stale = !user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > 5 * 60_000;
    if (stale) {
      User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
    }
  }
  next();
}
