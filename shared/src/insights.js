/**
 * Insights.
 *
 * Rules this module obeys absolutely:
 *   - Every sentence is derived from a number that is attached as `evidence`.
 *     If the UI ever needs to justify an insight, the numbers are right there.
 *   - Every rule has a minimum sample size. Below it, the rule emits nothing —
 *     we never turn two sessions into a confident claim about your habits.
 *   - When the whole window is too thin, we say so explicitly instead of
 *     inventing filler. Empty is better than wrong.
 *   - Tone is factual and non-punitive. There is no "you failed" branch, and
 *     `nudge` copy always pairs the problem with a concrete next action.
 */

import { INSIGHT_MIN_SAMPLE } from './constants.js';
import { distractionLabel } from './labels.js';
import { formatDuration } from './time.js';
import { formatDayKey } from './timezone.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * @typedef {{
 *   id: string,
 *   category: 'rhythm'|'trend'|'balance'|'focus'|'momentum'|'goal'|'break'|'info',
 *   tone: 'positive'|'neutral'|'nudge'|'info',
 *   title: string,
 *   detail: string,
 *   evidence: Record<string, unknown>,
 *   priority: number,
 * }} Insight
 */

/**
 * @param {number|string} hour24
 * @returns {string} e.g. `8 PM`
 */
function hourLabel(hour24) {
  const numeric = Number(hour24);
  const hour = ((numeric % 24) + 24) % 24;
  const suffixList = hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`;
  return suffixList;
}

/**
 * The best contiguous `width`-hour block of the day by focused seconds.
 *
 * `hourly.seconds` is aligned to wall-clock hours, so the returned window is a
 * plain range like 20 → 22 meaning 20:00–22:59. Windows wrap around midnight,
 * which is the common case for students.
 *
 * @param {Array<{hour:number, seconds:number}>} hourly
 * @param {number} [width]
 * @returns {{startHour:number, endHour:number, seconds:number, firstHourSeconds?:number}|null}
 */
export function peakFocusWindow(hourly, width = 3) {
  if (!Array.isArray(hourly) || hourly.length !== 24) return null;
  const total = hourly.reduce((a, h) => a + (h.seconds || 0), 0);
  if (total <= 0) return null;
  let best = null;
  for (let start = 0; start < 24; start += 1) {
    let seconds = 0;
    for (let offset = 0; offset < width; offset += 1) {
      seconds += hourly[(start + offset) % 24].seconds || 0;
    }
    const firstHourSeconds = hourly[start].seconds || 0;
    // Ties are broken towards the window that *starts* while the user is already
    // working. Otherwise 8pm–11pm of real activity can be reported as "7pm–10pm"
    // merely because the wider window also happens to total the same.
    if (!best || seconds > best.seconds || (seconds === best.seconds && firstHourSeconds > best.firstHourSeconds)) {
      best = { startHour: start, endHour: (start + width - 1) % 24, seconds, firstHourSeconds };
    }
  }
  return best;
}

/**
 * Generate the insight feed for a period.
 *
 * @param {{
 *   current: any,
 *   previous?: any|null,
 *   streak?: any|null,
 *   goals?: Array<any>,
 *   nowKey: string,
 *   dailyGoalSeconds?: number,
 * }} input
 * @returns {Insight[]}
 */
export function generateInsights(input) {
  const { current, previous = null, streak = null, goals = [], nowKey, dailyGoalSeconds = 0 } = input;
  /** @type {Insight[]} */
  const out = [];
  if (!current) return out;

  const sessions = current.sessionCount ?? 0;
  const activeDays = current.activeDays ?? 0;
  const focusedSeconds = current.focusedSeconds ?? 0;
  const enough = sessions >= INSIGHT_MIN_SAMPLE.sessions && activeDays >= INSIGHT_MIN_SAMPLE.distinctDays;

  // ---------------------------------------------------------------- rhythm
  if (enough) {
    const peak = peakFocusWindow(current.hourly, 3);
    if (peak && peak.seconds > 0) {
      const share = Math.round((peak.seconds / Math.max(1, focusedSeconds)) * 100);
      out.push({
        id: 'peak-window',
        category: 'rhythm',
        tone: 'neutral',
        title: `You focus best between ${hourLabel(peak.startHour)} and ${hourLabel(peak.endHour + 1)}`,
        detail: `${share}% of your focused time in this period landed in that window. Protecting it is the highest-leverage change you can make.`,
        evidence: { startHour: peak.startHour, endHour: peak.endHour, seconds: peak.seconds, share },
        priority: 30,
      });
    }
  }

  // ------------------------------------------------------------- best day
  if (activeDays >= INSIGHT_MIN_SAMPLE.distinctDays && current.byDayOfWeek) {
    const ranked = [...current.byDayOfWeek].filter((d) => d.focusedSeconds > 0).sort((a, b) => b.focusedSeconds - a.focusedSeconds);
    const best = ranked[0];
    const worst = ranked.at(-1);
    if (best && worst && best.focusedSeconds > 0) {
      out.push({
        id: 'best-weekday',
        category: 'rhythm',
        tone: 'neutral',
        title: `${DAY_NAMES[best.weekday]} is your strongest day`,
        detail:
          worst.weekday === best.weekday
            ? `${formatDuration(best.focusedSeconds)} focused on ${DAY_NAMES[best.weekday]}s.`
            : `${formatDuration(best.focusedSeconds)} on ${DAY_NAMES[best.weekday]}s versus ${formatDuration(worst.focusedSeconds)} on ${DAY_NAMES[worst.weekday]}s.`,
        evidence: {
          bestWeekday: DAY_NAMES[best.weekday],
          bestSeconds: best.focusedSeconds,
          weakestWeekday: DAY_NAMES[worst.weekday],
          weakestSeconds: worst.focusedSeconds,
        },
        priority: 20,
      });
    }
  }

  // ------------------------------------------------------- week-over-week
  if (previous) {
    if (sessions >= 3 && (previous.sessionCount ?? 0) >= 3) {
      const delta = current.averageSessionSeconds - previous.averageSessionSeconds;
      if (Math.abs(delta) >= 120) {
        const up = delta > 0;
        out.push({
          id: 'avg-session-change',
          category: 'trend',
          tone: up ? 'positive' : 'neutral',
          title: up
            ? `Your average session grew by ${Math.abs(Math.round(delta / 60))} minutes`
            : `Your average session shortened by ${Math.abs(Math.round(delta / 60))} minutes`,
          detail: up
            ? `You are holding focus for longer without extra effort. Average is now ${formatDuration(current.averageSessionSeconds)}.`
            : `Average is now ${formatDuration(current.averageSessionSeconds)}. Shorter sessions are easier to start — worth testing deliberately.`,
          evidence: { deltaSeconds: delta, currentAverage: current.averageSessionSeconds, previousAverage: previous.averageSessionSeconds },
          priority: 25,
        });
      }
    }

    if ((previous.focusedSeconds ?? 0) > 0) {
      const delta = focusedSeconds - previous.focusedSeconds;
      const ratio = delta / previous.focusedSeconds;
      if (Math.abs(ratio) >= 0.1) {
        const up = delta > 0;
        out.push({
          id: 'focus-time-change',
          category: 'trend',
          tone: up ? 'positive' : 'neutral',
          title: up
            ? `${formatDuration(delta)} more focused time than last period`
            : `${formatDuration(Math.abs(delta))} less focused time than last period`,
          detail: `${formatDuration(focusedSeconds)} this period against ${formatDuration(previous.focusedSeconds)} before.`,
          evidence: { deltaSeconds: delta, deltaRatio: ratio, currentSeconds: focusedSeconds, previousSeconds: previous.focusedSeconds },
          priority: 40,
        });
      }
    }

    if (sessions > 0 && (previous.sessionCount ?? 0) > 0) {
      const delta = sessions - previous.sessionCount;
      if (Math.abs(delta) >= 2) {
        out.push({
          id: 'session-count-change',
          category: 'momentum',
          tone: delta > 0 ? 'positive' : 'neutral',
          title:
            delta > 0
              ? `You completed ${delta} more session${delta === 1 ? '' : 's'} than last period`
              : `${Math.abs(delta)} fewer sessions than last period`,
          detail: `${sessions} this period against ${previous.sessionCount} before.`,
          evidence: { delta, current: sessions, previous: previous.sessionCount },
          priority: 35,
        });
      }
    }
  }

  // --------------------------------------------------------------- balance
  if (sessions >= INSIGHT_MIN_SAMPLE.subjectsForSplit && current.subjects?.length >= 2 && focusedSeconds > 0) {
    const [top, second] = current.subjects;
    if (top.share >= 25) {
      const leader = top.share >= 60 && current.subjects.length >= 3;
      out.push({
        id: 'subject-concentration',
        category: 'balance',
        tone: leader ? 'nudge' : 'neutral',
        title: `${top.name} received ${Math.round(top.share)}% of your study time`,
        detail: leader
          ? `${formatDuration(top.focusedSeconds)} went to ${top.name} while ${current.subjects.length - 1} other subjects shared the rest. Deliberate focus or accidental drift?`
          : `${formatDuration(top.focusedSeconds)} to ${top.name}, then ${formatDuration(second?.focusedSeconds ?? 0)} to ${second?.name ?? 'nothing else'}.`,
        evidence: { topSubject: top.name, topSeconds: top.focusedSeconds, share: top.share, others: current.subjects.length - 1 },
        priority: 28,
      });
    }
  }

  // ------------------------------------------------------------- focus score
  if (current.averageFocusScore !== null && current.averageFocusScore !== undefined && sessions >= 3) {
    const score = current.averageFocusScore;
    const tone = score >= 80 ? 'positive' : score >= 60 ? 'neutral' : 'nudge';
    out.push({
      id: 'focus-score',
      category: 'focus',
      tone,
      title: `Average focus score: ${score}`,
      detail:
        score >= 80
          ? 'Your sessions are long, uninterrupted, and finished as planned.'
          : score >= 60
            ? 'Solid. Pauses and distractions are what is holding it below 80.'
            : 'Sessions are being cut short or interrupted frequently. Try a shorter planned duration you can actually finish.',
      evidence: { averageFocusScore: score, sessionCount: sessions },
      priority: 32,
    });
  }

  // ------------------------------------------------------------- distraction
  if (current.distractions?.total >= INSIGHT_MIN_SAMPLE.distractions) {
    const top = current.distractions.byKind[0];
    out.push({
      id: 'distraction-pattern',
      category: 'focus',
      tone: current.distractions.perHour <= 1 ? 'neutral' : 'nudge',
      title: `${distractionLabel(top.kind)} is your most common interruption`,
      detail: `${current.distractions.total} distractions logged, ${current.distractions.perHour.toFixed(1)} per focused hour. ${
        top.share >= 40 ? 'That one source is worth removing from the room entirely.' : 'Spread across a few sources rather than one.'
      }`,
      evidence: { total: current.distractions.total, perHour: current.distractions.perHour, topKind: top.kind, topCount: top.count },
      priority: 26,
    });
  }

  // ------------------------------------------------------------------ break
  if (current.breakToFocusRatio !== null && focusedSeconds >= 7200 && current.breakToFocusRatio > 0.4) {
    out.push({
      id: 'break-ratio',
      category: 'break',
      tone: 'info',
      title: `Breaks took ${Math.round(current.breakToFocusRatio * 100)}% as long as your focus time`,
      detail: `${formatDuration(current.breakSeconds)} of breaks against ${formatDuration(focusedSeconds)} of focus. Long breaks are not a problem if they are deliberate.`,
      evidence: { breakSeconds: current.breakSeconds, focusedSeconds, ratio: current.breakToFocusRatio },
      priority: 15,
    });
  }

  // ---------------------------------------------------------------- best day
  if (current.bestDay && current.bestDay.focusedSeconds > 0) {
    out.push({
      id: 'best-day',
      category: 'momentum',
      tone: 'positive',
      title: `${formatDayKey(current.bestDay.dayKey, { weekday: 'long' })} was your longest day`,
      detail: `${formatDuration(current.bestDay.focusedSeconds)} across ${current.bestDay.sessionCount} session${current.bestDay.sessionCount === 1 ? '' : 's'}.`,
      evidence: { dayKey: current.bestDay.dayKey, seconds: current.bestDay.focusedSeconds, sessions: current.bestDay.sessionCount },
      priority: 18,
    });
  }

  // ----------------------------------------------------------------- streak
  if (streak && streak.current >= 2) {
    out.push({
      id: 'streak',
      category: 'momentum',
      tone: 'positive',
      title: `${streak.current}-day streak`,
      detail:
        streak.current >= streak.longest
          ? 'This is your longest run so far.'
          : `Your record is ${streak.longest} days.`,
      evidence: { current: streak.current, longest: streak.longest, thresholdSeconds: streak.thresholdSeconds },
      priority: 22,
    });
  }

  // ------------------------------------------------------------------- goal
  const PACE_WORD = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };
  const pending = goals.filter((goal) => !goal.isMet && goal.targetSeconds > 0).sort((a, b) => a.remainingSeconds - b.remainingSeconds)[0];
  if (pending && pending.remainingSeconds > 0 && (pending.daysTotal > 1 ? pending.paceRatio !== null : true)) {
    const when = pending.period === 'daily' ? 'today' : pending.period === 'monthly' ? 'this month' : 'this week';
    out.push({
      id: 'goal-pacing',
      category: 'goal',
      tone: pending.isAhead ? 'positive' : 'neutral',
      title: `${formatDuration(pending.remainingSeconds)} away from your ${PACE_WORD[pending.period] ?? ''} goal`,
      detail: `${formatDuration(pending.focusedSeconds)} of ${formatDuration(pending.targetSeconds)} so far ${when}.`,
      evidence: { remaining: pending.remainingSeconds, target: pending.targetSeconds, focused: pending.focusedSeconds, period: pending.period },
      priority: 45,
    });
  }

  // ------------------------------------------------------------ consistency
  if (enough && current.focusIndex) {
    const { daysMet, daysElapsed, consistency } = current.focusIndex;
    if (daysElapsed > 0) {
      out.push({
        id: 'consistency',
        category: 'momentum',
        tone: consistency >= 0.7 ? 'positive' : 'neutral',
        title: `${daysMet} of ${daysElapsed} days hit your daily threshold`,
        detail:
          consistency >= 0.7
            ? 'That is a routine, not a burst. This is what moves exam results.'
            : 'Fewer, longer days can work too — but consistency is the stronger predictor.',
        evidence: { daysMet, daysElapsed, consistency },
        priority: 24,
      });
    }
  }

  // ------------------------------------------------- not enough data yet
  if (!enough) {
    const missingSessions = Math.max(0, INSIGHT_MIN_SAMPLE.sessions - sessions);
    out.unshift({
      id: 'insufficient-data',
      category: 'info',
      tone: 'info',
      title: 'Not enough data yet',
      detail:
        sessions === 0
          ? 'Complete a session or two and patterns in how you focus will show up here.'
          : `${missingSessions} more session${missingSessions === 1 ? '' : 's'} before patterns become meaningful. We would rather stay quiet than guess.`,
      evidence: { sessions, requiredSessions: INSIGHT_MIN_SAMPLE.sessions, activeDays, requiredDays: INSIGHT_MIN_SAMPLE.distinctDays },
      priority: 100,
    });
  }

  void nowKey;
  void dailyGoalSeconds;
  return out.sort((a, b) => b.priority - a.priority);
}

/**
 * A single headline for the cockpit, chosen deterministically so the same data
 * always produces the same sentence.
 * @param {Insight[]} insights
 * @returns {Insight|null}
 */
export function headlineInsight(insights) {
  return insights.find((i) => i.tone !== 'info') ?? insights[0] ?? null;
}
