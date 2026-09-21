/**
 * Onboarding.
 *
 * The only job here is turning the handful of things a new user picks into real
 * subjects. It is deliberately small: the product's first screen is the timer, so
 * onboarding exists to make the first session startable, not to collect a profile.
 *
 * Subject names are de-duplicated case-insensitively, because "DSA" and "dsa"
 * would collide with the live-name unique index and surface as a confusing error
 * on the very first interaction a user has with the product.
 */

import { Subject, DEFAULT_SUBJECT_COLORS } from '../models/Subject.js';

/**
 * Suggestions offered during onboarding, each with a matching glyph and colour so
 * the subject rail looks deliberate from the first session rather than generic.
 */
export const STARTER_SUBJECTS = [
  { name: 'DSA', icon: '◈', color: '#5eead4' },
  { name: 'Coding', icon: '{}', color: '#818cf8' },
  { name: 'Exam preparation', icon: '◎', color: '#f472b6' },
  { name: 'System design', icon: '⬡', color: '#60a5fa' },
  { name: 'Aptitude', icon: '∑', color: '#fbbf24' },
  { name: 'AI / ML', icon: '∿', color: '#a78bfa' },
  { name: 'Reading', icon: '≡', color: '#34d399' },
  { name: 'Personal project', icon: '✦', color: '#fb923c' },
  { name: 'Work', icon: '▤', color: '#94a3b8' },
];

/** @param {string} name */
function findStarter(name) {
  const needle = name.trim().toLowerCase();
  return STARTER_SUBJECTS.find((starter) => starter.name.toLowerCase() === needle) ?? null;
}

/**
 * Create the user's starting subjects, skipping any they already have.
 *
 * @param {any} userId
 * @param {string[]} names
 * @param {{weeklyTargetSecondsPerSubject?: number}} [options]
 * @returns {Promise<any[]>}
 */
export async function ensureRoleDefaults(userId, names, options = {}) {
  const cleaned = [];
  const seen = new Set();
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
  }

  if (cleaned.length === 0) return [];

  const existing = await Subject.find({ user: userId, archivedAt: null }).select('name');
  const taken = new Set(existing.map((subject) => subject.name.toLowerCase()));

  const created = [];
  for (const [index, name] of cleaned.entries()) {
    if (taken.has(name.toLowerCase())) continue;
    const starter = findStarter(name);
    created.push({
      user: userId,
      name,
      icon: starter?.icon ?? '',
      color: starter?.color ?? DEFAULT_SUBJECT_COLORS[index % DEFAULT_SUBJECT_COLORS.length],
      order: index,
      weeklyTargetSeconds: options.weeklyTargetSecondsPerSubject ?? 0,
    });
  }

  if (created.length === 0) return [];
  return Subject.insertMany(created);
}

/**
 * The onboarding screen's option list, so the UI and the server agree about what
 * exists without the client hard-coding it.
 */
export function starterOptions() {
  return STARTER_SUBJECTS.map((starter) => ({ ...starter }));
}
