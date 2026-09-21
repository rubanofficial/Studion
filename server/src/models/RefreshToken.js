/**
 * Refresh tokens — the durable half of authentication.
 *
 * Design
 * ------
 * The access token is a short-lived JWT held in memory by the client. The refresh
 * token is an opaque random string stored only as a SHA-256 hash, delivered in an
 * httpOnly cookie. Rotating on every use means a stolen refresh token is usable
 * at most once, and the theft is detectable: replaying a token that has already
 * been rotated revokes the whole family (see `services/authService.js`).
 *
 * Indexes
 * -------
 *   { tokenHash: 1 } UNIQUE
 *     Every refresh is a lookup by hash. Unique also makes a duplicate insert
 *     impossible, which is the last line of defence against a token collision.
 *
 *   { expiresAt: 1 } TTL, expireAfterSeconds: 0
 *     MongoDB deletes expired rows for us, so the collection stays small and no
 *     cron job is needed. TTL reaping is best-effort (it runs about once a
 *     minute), so expiry is *also* checked in code — the index is for hygiene,
 *     never for correctness.
 *
 *   { user: 1, revokedAt: 1 }
 *     "Sign out everywhere" and reuse-detection both fan out from a user to all
 *     their live sessions. This index makes that a covered lookup.
 *
 *   { familyId: 1 }
 *     Revoking a rotation family after reuse detection.
 */

import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** SHA-256 of the opaque token. The raw value is never stored. */
    tokenHash: { type: String, required: true },
    /**
     * Groups every token descended from one login, so reuse detection can
     * invalidate the whole chain rather than just the presented token.
     */
    familyId: { type: String, required: true },
    /** Hash of the token this one replaced, for audit and reuse detection. */
    replacedByHash: { type: String, default: null },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    userAgent: { type: String, maxlength: 300, default: null },
    /** Stored hashed-adjacent rather than raw: full IPs are not needed. */
    ipPrefix: { type: String, maxlength: 45, default: null },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiry_ttl' });
refreshTokenSchema.index({ user: 1, revokedAt: 1 }, { name: 'user_live' });
refreshTokenSchema.index({ familyId: 1 }, { name: 'family' });

/** @returns {boolean} */
refreshTokenSchema.methods.isUsable = function isUsable() {
  return this.revokedAt === null && this.expiresAt.getTime() > Date.now();
};

export const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);
