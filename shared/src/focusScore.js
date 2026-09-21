/**
 * The Focus Score.
 *
 * Design goal: a number the user can *argue with*. If it drops, the product
 * must be able to point at the exact factor that caused it. So the score is a
 * weighted sum of five normalised factors, each of which is independently
 * explainable, and `explainFocusScore` returns the per-factor contribution.
 *
 *   Focus Score = 100 × ( 0.30·completion
 *                       + 0.25·timeInFocus
 *                       + 0.18·interruptionControl
 *                       + 0.17·distractionControl
 *                       + 0.10·outcome )
 *
 *      completion            = min(1, focused / planned)
 *                              Did you do the session you committed to?
 *      timeInFocus           = focused / wall
 *                              Of the time the session was open, how much was
 *                              spent working rather than paused or on a break?
 *      interruptionControl   = e^(−pauses / 3)
 *                              Smooth decay: 0 pauses → 1.00, 3 → 0.37, 6 → 0.13.
 *                              Chosen over a linear penalty so that a single
 *                              interruption barely dents a good session, while a
 *                              pattern of them becomes very visible.
 *      distractionControl    = e^(−(distractions per hour) / 2)
 *                              Rate-based, not absolute, so a 90 minute session
 *                              is not punished for what a 25 minute session gets
 *                              away with.
 *      outcome               = 1.00 completed · 0.50 interrupted · 0.00 cancelled
 *                              Did you finish, or did something end it for you?
 *
 * Deliberate omissions:
 *   - No randomness. The same session always scores the same, forever.
 *   - No time-of-day bonus. Studying at 6am is not inherently better than 11pm.
 *   - No streak component. Consistency is a property of a *period*, not of one
 *     session; it is reported separately by `analytics.js` as the Focus Index so
 *     that a single missed day cannot retroactively rewrite last month's scores.
 */

import { FOCUS_SCORE_WEIGHTS } from './constants.js';
import { clamp, ratio, round } from './time.js';

/**
 * Normalised 0..1 factor values for a session.
 * @param {{
 *   focusedSeconds: number,
 *   plannedSeconds: number,
 *   wallSeconds: number,
 *   pauseCount: number,
 *   distractionsPerHour: number,
 *   status?: string,
 * }} stats
 * @returns {{completion:number, timeInFocus:number, interruptionControl:number, distractionControl:number, outcome:number}}
 */
export function focusScoreFactors(stats) {
  const focused = Math.max(0, stats.focusedSeconds || 0);
  const planned = Math.max(0, stats.plannedSeconds || 0);
  const wall = Math.max(0, stats.wallSeconds || 0);
  const pauses = Math.max(0, stats.pauseCount || 0);
  const perHour = Math.max(0, stats.distractionsPerHour || 0);

  return {
    completion: planned > 0 ? clamp(ratio(focused, planned), 0, 1) : 0,
    timeInFocus: wall > 0 ? clamp(ratio(focused, wall), 0, 1) : focused > 0 ? 1 : 0,
    interruptionControl: clamp(Math.exp(-pauses / 3), 0, 1),
    distractionControl: clamp(Math.exp(-perHour / 2), 0, 1),
    outcome:
      stats.status === 'completed' ? 1 : stats.status === 'interrupted' ? 0.5 : stats.status === 'cancelled' ? 0 : 0,
  };
}

/**
 * Compute the 0..100 Focus Score.
 * Returns `null` for sessions too short to be meaningful (< 60s focused), so we
 * never display a confident score for an accidental tap.
 *
 * @param {{
 *   focusedSeconds: number,
 *   plannedSeconds: number,
 *   wallSeconds: number,
 *   pauseCount: number,
 *   distractionsPerHour: number,
 *   status?: string,
 * }} stats
 * @param {{minFocusedSeconds?: number}} [options]
 * @returns {number|null}
 */
export function computeFocusScore(stats, options = {}) {
  const minFocused = options.minFocusedSeconds ?? 60;
  if (!stats || (stats.focusedSeconds || 0) < minFocused) return null;
  const factors = focusScoreFactors(stats);
  let total = 0;
  for (const [key, weight] of Object.entries(FOCUS_SCORE_WEIGHTS)) {
    total += weight * (factors[/** @type {keyof typeof factors} */ (key)] ?? 0);
  }
  return Math.round(clamp(total, 0, 1) * 100);
}

/** Plain-language copy per factor, used by the session summary and history. */
const FACTOR_COPY = Object.freeze({
  completion: {
    label: 'Completion',
    good: 'You ran the session you planned.',
    bad: 'You stopped short of the planned duration.',
  },
  timeInFocus: {
    label: 'Time in focus',
    good: 'Almost all of the session was spent working.',
    bad: 'A large share of the session was paused or on a break.',
  },
  interruptionControl: {
    label: 'Interruption control',
    good: 'You never had to pause.',
    bad: 'Frequent pausing broke up the session.',
  },
  distractionControl: {
    label: 'Distraction control',
    good: 'Few or no distractions logged.',
    bad: 'Distractions came often relative to the time you worked.',
  },
  outcome: {
    label: 'Outcome',
    good: 'Completed as intended.',
    bad: 'Ended early.',
  },
});

/**
 * Full audit trail for a score, so the UI can show *why* it moved.
 * This is what powers the "Score breakdown" panel — no black boxes.
 *
 * @param {Parameters<typeof computeFocusScore>[0]} stats
 * @returns {{
 *   score: number|null,
 *   factors: Array<{key:string,label:string,weight:number,value:number,points:number,maxPoints:number,note:string}>,
 *   summary: string,
 *   strongest: string|null,
 *   weakest: string|null,
 * }}
 */
export function explainFocusScore(stats) {
  const factors = focusScoreFactors(stats);
  const breakdown = Object.entries(FOCUS_SCORE_WEIGHTS).map(([key, weight]) => {
    const value = factors[/** @type {keyof typeof factors} */ (key)] ?? 0;
    const copy = FACTOR_COPY[/** @type {keyof typeof FACTOR_COPY} */ (key)];
    return {
      key,
      label: copy.label,
      weight,
      value: round(value, 4),
      points: round(value * weight * 100, 1),
      maxPoints: round(weight * 100, 1),
      note: value >= 0.7 ? copy.good : value >= 0.4 ? 'Partly there.' : copy.bad,
    };
  });

  const sorted = [...breakdown].sort((a, b) => b.value - a.value);
  const score = computeFocusScore(stats);
  const weakest = sorted.at(-1);
  const strongest = sorted[0];

  let summary;
  if (score === null) {
    summary = 'Not enough focused time to score this session.';
  } else if (score >= 85) {
    summary = 'A genuinely strong session — everything lined up.';
  } else if (score >= 70) {
    summary = `Solid session. ${weakest ? `${weakest.label} held it back the most.` : ''}`.trim();
  } else if (score >= 50) {
    summary = weakest ? `Roughly half marks — ${weakest.label.toLowerCase()} cost you the most points.` : 'Roughly half marks.';
  } else {
    summary = weakest ? `This one did not hold together. ${weakest.label} was the main drag.` : 'This one did not hold together.';
  }

  return {
    score,
    factors: breakdown,
    summary,
    strongest: strongest && strongest.value >= 0.7 ? strongest.key : null,
    weakest: weakest && weakest.value < 0.7 ? weakest.key : null,
  };
}

/**
 * Volume-weighted mean of session scores for a period.
 *
 * Weighted by focused time, not a plain average: one 3-second session should not
 * be able to drag a week's score around as hard as a 90-minute one.
 *
 * @param {Array<{focusScore: number|null, focusedSeconds: number}>} sessions
 * @returns {number|null}
 */
export function aggregateFocusScore(sessions) {
  let weighted = 0;
  let weight = 0;
  for (const session of sessions) {
    if (session.focusScore === null || session.focusScore === undefined) continue;
    const w = Math.max(1, session.focusedSeconds || 0);
    weighted += session.focusScore * w;
    weight += w;
  }
  if (weight === 0) return null;
  return Math.round(weighted / weight);
}
