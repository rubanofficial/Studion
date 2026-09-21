/**
 * User account.
 *
 * Indexes
 * -------
 *   { email: 1 } UNIQUE
 *     Login is a lookup by email and email must be unique across accounts. One
 *     index serves both the uniqueness constraint and the hot login query.
 *
 * Password hashing lives in a Mongoose hook rather than in a service so that no
 * code path — seeder, admin script, or future OAuth linking — can accidentally
 * persist a plaintext password.
 */

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { env } from '../config/env.js';

const BCRYPT_ROUNDS = env.isTest ? 4 : 12;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'An email address is required.'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    name: {
      type: String,
      required: [true, 'A name is required.'],
      trim: true,
      maxlength: 80,
    },
    // Never selected by default: an explicit `.select('+passwordHash')` is
    // required, so a stray `User.find()` cannot leak hashes into a response.
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    /**
     * Plaintext password, accepted on the way in and erased before the document
     * is ever written. Declared as a real path (rather than relying on an
     * undeclared property) so `isModified('password')` is meaningful and strict
     * mode cannot silently discard it. `select: false` keeps it out of queries.
     */
    password: {
      type: String,
      select: false,
    },
    lastActiveAt: { type: Date, default: Date.now },
    /** Set once onboarding completes; used to decide whether to show it. */
    onboardedAt: { type: Date, default: null },
    /** Soft-delete marker. Present means the account is scheduled for erasure. */
    deletedAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });

/**
 * Hash the password on the way in.
 *
 * This must be `pre('validate')`, not `pre('save')`: Mongoose runs validation
 * *before* the save hooks, so a `pre('save')` hasher leaves `passwordHash` unset
 * at exactly the moment it is checked as required — which is the bug this hook
 * exists to avoid.
 *
 * Clearning `password` afterwards both stops the plaintext from ever reaching
 * disk and makes the hook idempotent: a second validation pass sees no password
 * and does nothing, so the hash cannot be hashed again.
 */
userSchema.pre('validate', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const plain = /** @type {string|undefined} */ (this.get('password'));
  if (!plain) return next();

  this.set('passwordHash', await bcrypt.hash(plain, BCRYPT_ROUNDS));
  this.set('password', undefined);
  if (!this.isNew) this.set('passwordChangedAt', new Date());
  next();
});

/**
 * Constant-time comparison handled by bcrypt. Returns false for a missing hash
 * so callers get a clean boolean rather than a throw on a half-built document.
 * @param {string} candidate
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = async function verifyPassword(candidate) {
  const hash = /** @type {string|undefined} */ (this.get('passwordHash'));
  if (!hash) return false;
  return bcrypt.compare(candidate, hash);
};

/** @returns {boolean} */
userSchema.methods.hasCompletedOnboarding = function hasCompletedOnboarding() {
  return Boolean(this.get('onboardedAt'));
};

export const User = mongoose.model('User', userSchema);
