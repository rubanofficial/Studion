/**
 * Settings service.
 *
 * A user always has settings, even a brand new one. Rather than making every
 * caller handle "no settings document yet", this service creates one on first
 * read. That keeps the schema defaults (which carry the real product decisions —
 * default goal, success threshold, presets) in exactly one place: the model.
 */

import { UserSettings } from '../models/UserSettings.js';
import { resolveTimeZone } from '@focusforge/core';

import { assertFound } from './support.js';

/**
 * Load settings, creating them on first access.
 *
 * The upsert is race-safe: two concurrent first requests both try to insert, one
 * wins, and the loser re-reads the winner's document instead of failing. That
 * matters because the cockpit fires several requests in parallel on load.
 *
 * @param {any} userId
 * @param {{timeZone?: string}} [initial]
 * @returns {Promise<any>}
 */
export async function getOrCreate(userId, initial = {}) {
  const existing = await UserSettings.findOne({ user: userId });
  if (existing) return existing;

  try {
    return await UserSettings.create({
      user: userId,
      ...(initial.timeZone ? { timeZone: resolveTimeZone(initial.timeZone) } : {}),
    });
  } catch (error) {
    if (/** @type {any} */ (error)?.code === 11000) {
      return assertFound(await UserSettings.findOne({ user: userId }), 'Settings');
    }
    throw error;
  }
}

/**
 * Apply a partial update.
 *
 * Nested objects (`notifications`, `sound`, `shortcuts`) are merged field by
 * field rather than replaced, so a client that only knows about `sound.volume`
 * cannot wipe the rest of the `sound` block by omission.
 *
 * @param {any} userId
 * @param {Record<string, any>} patch
 * @returns {Promise<any>}
 */
export async function update(userId, patch) {
  const settings = await getOrCreate(userId);
  const NESTED = ['notifications', 'sound', 'shortcuts'];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (NESTED.includes(key) && value && typeof value === 'object') {
      const current = settings.get(key) ?? {};
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedValue !== undefined) current[nestedKey] = nestedValue;
      }
      settings.set(key, current);
    } else {
      settings.set(key, value);
    }
  }

  if (patch.timeZone) settings.set('timeZone', resolveTimeZone(patch.timeZone));
  await settings.save();
  return settings;
}

/**
 * A plain object safe to send to the client.
 * @param {any} settings
 */
export function toPublicSettings(settings) {
  const raw = settings.toObject ? settings.toObject() : settings;
  return {
    id: String(raw._id),
    theme: raw.theme,
    accent: raw.accent,
    reduceMotion: raw.reduceMotion,
    ambientBackground: raw.ambientBackground,
    timeZone: raw.timeZone,
    weekStart: raw.weekStart,
    dailyGoalSeconds: raw.dailyGoalSeconds,
    successThresholdSeconds: raw.successThresholdSeconds,
    focusPresets: raw.focusPresets,
    breakPresets: raw.breakPresets,
    shortBreakMinutes: raw.shortBreakMinutes,
    longBreakMinutes: raw.longBreakMinutes,
    longBreakEvery: raw.longBreakEvery,
    autoStartBreaks: raw.autoStartBreaks,
    autoStartFocus: raw.autoStartFocus,
    maxExtendMinutes: raw.maxExtendMinutes,
    notifications: raw.notifications,
    sound: raw.sound,
    shortcuts: raw.shortcuts,
    defaultSubject: raw.defaultSubject ? String(raw.defaultSubject) : null,
    promptDailyReview: raw.promptDailyReview,
    confirmEarlyEnd: raw.confirmEarlyEnd,
    updatedAt: raw.updatedAt,
  };
}
