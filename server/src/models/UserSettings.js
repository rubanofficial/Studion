/**
 * User settings — one document per user.
 *
 * A separate collection rather than fields on `User` because settings are read
 * on essentially every request (they carry the timezone that all analytics
 * depend on) while `User` is read rarely. Keeping them apart means a settings
 * write never touches the authentication document, and the auth document never
 * grows a schema per feature.
 *
 * Indexes
 * -------
 *   { user: 1 } UNIQUE
 *     Exactly one settings document per user, and the only lookup pattern.
 */

import mongoose from 'mongoose';

import { AMBIENCE, DEFAULT_DAILY_GOAL_SECONDS, DEFAULT_SUCCESS_THRESHOLD_SECONDS, THEMES } from '@focusforge/core';

/** @type {import('mongoose').SchemaDefinition} */
const presetSchema = {
  _id: false,
  minutes: { type: Number, required: true, min: 1, max: 600 },
  label: { type: String, trim: true, maxlength: 40, default: '' },
};

const userSettingsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

    // ------------------------------------------------------------ appearance
    theme: { type: String, enum: THEMES, default: 'dark' },
    /** Hex accent. Drives the instrument colour when no subject is selected. */
    accent: { type: String, default: '#5eead4', match: /^#[0-9a-fA-F]{6}$/ },
    reduceMotion: { type: Boolean, default: false },
    /** Ambient background responds to focus state unless this is off. */
    ambientBackground: { type: Boolean, default: true },

    // -------------------------------------------------------------- calendar
    timeZone: { type: String, default: 'UTC' },
    /** 0 = Sunday .. 6 = Saturday. */
    weekStart: { type: Number, min: 0, max: 6, default: 1 },

    // ----------------------------------------------------------------- goals
    dailyGoalSeconds: { type: Number, min: 0, default: DEFAULT_DAILY_GOAL_SECONDS },
    /** What the user considers a successful day, for streaks. */
    successThresholdSeconds: { type: Number, min: 1, default: DEFAULT_SUCCESS_THRESHOLD_SECONDS },

    // ----------------------------------------------------------------- timer
    focusPresets: {
      type: [presetSchema],
      default: [
        { minutes: 15, label: 'Warm up' },
        { minutes: 25, label: 'Classic' },
        { minutes: 45, label: 'Deep' },
        { minutes: 60, label: 'Hour' },
        { minutes: 90, label: 'Deep dive' },
      ],
    },
    breakPresets: {
      type: [presetSchema],
      default: [
        { minutes: 5, label: 'Short' },
        { minutes: 10, label: 'Medium' },
        { minutes: 15, label: 'Long' },
      ],
    },
    shortBreakMinutes: { type: Number, min: 1, max: 120, default: 5 },
    longBreakMinutes: { type: Number, min: 1, max: 180, default: 15 },
    /** A long break is offered after every N focus sessions. */
    longBreakEvery: { type: Number, min: 1, max: 12, default: 4 },
    autoStartBreaks: { type: Boolean, default: false },
    autoStartFocus: { type: Boolean, default: false },
    /** Extending a session is capped so an accidental tap cannot add hours. */
    maxExtendMinutes: { type: Number, min: 1, max: 240, default: 60 },

    // --------------------------------------------------------- notifications
    notifications: {
      _id: false,
      sessionComplete: { type: Boolean, default: true },
      breakFinished: { type: Boolean, default: true },
      dailyGoal: { type: Boolean, default: true },
      weeklyGoal: { type: Boolean, default: true },
      streakMilestone: { type: Boolean, default: true },
      /** In-app only; no email or push is sent without explicit opt-in. */
      desktop: { type: Boolean, default: false },
    },

    // ----------------------------------------------------------------- sound
    sound: {
      _id: false,
      enabled: { type: Boolean, default: false },
      ambience: { type: String, enum: AMBIENCE, default: 'none' },
      volume: { type: Number, min: 0, max: 1, default: 0.4 },
      /** Chime when a session or break ends. */
      chime: { type: Boolean, default: true },
    },

    // ------------------------------------------------------------- shortcuts
    shortcuts: {
      _id: false,
      enabled: { type: Boolean, default: true },
    },

    // ------------------------------------------------------- session defaults
    defaultSubject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
    /** Ask for a reflection note when the day's last session ends. */
    promptDailyReview: { type: Boolean, default: true },
    /** Confirm before ending a session early. */
    confirmEarlyEnd: { type: Boolean, default: true },
  },
  { timestamps: true },
);

userSettingsSchema.index({ user: 1 }, { unique: true, name: 'user_unique' });

export const UserSettings = mongoose.model('UserSettings', userSettingsSchema);
