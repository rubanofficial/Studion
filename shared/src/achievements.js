/**
 * Achievements.
 *
 * Kept deliberately adult: no confetti animals, no "Awesome!!!" copy. Each one
 * recognises a behaviour that actually correlates with better results —
 * repetition, sustained focus, and consistency over bursts.
 *
 * Evaluation is a pure function of lifetime stats, so achievements are always
 * *derived* from the data rather than stored as mutable flags that can drift out
 * of sync. The server only persists `unlockedAt` so the UI can celebrate a new
 * unlock exactly once.
 */

/** @typedef {'bronze'|'silver'|'gold'|'platinum'} Tier */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string,
 *   tier: Tier,
 *   metricLabel: string,
 *   target: number,
 *   unit: 'count'|'seconds'|'days'|'score',
 *   metric: (stats: LifetimeStats) => number,
 * }} AchievementDefinition
 */

/**
 * @typedef {{
 *   totalSessions: number,
 *   totalFocusedSeconds: number,
 *   totalDistractions: number,
 *   currentStreak: number,
 *   longestStreak: number,
 *   bestWeekSeconds: number,
 *   bestMonthSeconds: number,
 *   bestSessionSeconds: number,
 *   bestSessionScore: number,
 *   bestMonthActiveDays: number,
 *   topSubjectSeconds: number,
 *   cleanSessionCount: number,
 * }} LifetimeStats
 */

/** @type {AchievementDefinition[]} */
export const ACHIEVEMENTS = [
  {
    id: 'first-focus',
    name: 'First Light',
    description: 'Complete your first focus session.',
    tier: 'bronze',
    metricLabel: 'sessions',
    target: 1,
    unit: 'count',
    metric: (s) => s.totalSessions,
  },
  {
    id: 'sessions-10',
    name: 'Getting Reps',
    description: 'Complete 10 focus sessions.',
    tier: 'bronze',
    metricLabel: 'sessions',
    target: 10,
    unit: 'count',
    metric: (s) => s.totalSessions,
  },
  {
    id: 'sessions-100',
    name: 'Hundred Club',
    description: 'Complete 100 focus sessions.',
    tier: 'gold',
    metricLabel: 'sessions',
    target: 100,
    unit: 'count',
    metric: (s) => s.totalSessions,
  },
  {
    id: 'sessions-500',
    name: 'Instrument of Discipline',
    description: 'Complete 500 focus sessions.',
    tier: 'platinum',
    metricLabel: 'sessions',
    target: 500,
    unit: 'count',
    metric: (s) => s.totalSessions,
  },
  {
    id: 'deep-dive',
    name: 'Deep Dive',
    description: 'Hold a single unbroken focus block of 90 minutes or more.',
    tier: 'silver',
    metricLabel: 'longest block',
    target: 90 * 60,
    unit: 'seconds',
    metric: (s) => Math.max(s.bestSessionSeconds, 0),
  },
  {
    id: 'week-5h',
    name: 'Five Hour Week',
    description: 'Focus for 5 hours in a single week.',
    tier: 'bronze',
    metricLabel: 'best week',
    target: 5 * 3600,
    unit: 'seconds',
    metric: (s) => s.bestWeekSeconds,
  },
  {
    id: 'week-10h',
    name: 'Ten Hour Week',
    description: 'Focus for 10 hours in a single week.',
    tier: 'silver',
    metricLabel: 'best week',
    target: 10 * 3600,
    unit: 'seconds',
    metric: (s) => s.bestWeekSeconds,
  },
  {
    id: 'week-20h',
    name: 'Serious Week',
    description: 'Focus for 20 hours in a single week.',
    tier: 'gold',
    metricLabel: 'best week',
    target: 20 * 3600,
    unit: 'seconds',
    metric: (s) => s.bestWeekSeconds,
  },
  {
    id: 'month-50h',
    name: 'Fifty Hour Month',
    description: 'Focus for 50 hours in a single calendar month.',
    tier: 'gold',
    metricLabel: 'best month',
    target: 50 * 3600,
    unit: 'seconds',
    metric: (s) => s.bestMonthSeconds,
  },
  {
    id: 'hours-100',
    name: 'One Hundred Hours',
    description: 'Accumulate 100 focused hours in total.',
    tier: 'gold',
    metricLabel: 'total',
    target: 100 * 3600,
    unit: 'seconds',
    metric: (s) => s.totalFocusedSeconds,
  },
  {
    id: 'hours-1000',
    name: 'Thousand Hour Foundation',
    description: 'Accumulate 1000 focused hours in total.',
    tier: 'platinum',
    metricLabel: 'total',
    target: 1000 * 3600,
    unit: 'seconds',
    metric: (s) => s.totalFocusedSeconds,
  },
  {
    id: 'streak-7',
    name: 'Seven Day Streak',
    description: 'Meet your daily threshold 7 days in a row.',
    tier: 'silver',
    metricLabel: 'streak',
    target: 7,
    unit: 'days',
    metric: (s) => s.longestStreak,
  },
  {
    id: 'streak-30',
    name: 'Thirty Day Streak',
    description: 'Meet your daily threshold 30 days in a row.',
    tier: 'gold',
    metricLabel: 'streak',
    target: 30,
    unit: 'days',
    metric: (s) => s.longestStreak,
  },
  {
    id: 'streak-100',
    name: 'Century Streak',
    description: 'Meet your daily threshold 100 days in a row.',
    tier: 'platinum',
    metricLabel: 'streak',
    target: 100,
    unit: 'days',
    metric: (s) => s.longestStreak,
  },
  {
    id: 'consistent-month',
    name: 'Twenty Days In',
    description: 'Study on 20 or more days within one calendar month.',
    tier: 'silver',
    metricLabel: 'active days',
    target: 20,
    unit: 'days',
    metric: (s) => s.bestMonthActiveDays,
  },
  {
    id: 'subject-devotion',
    name: 'Subject Devotion',
    description: 'Put 50 focused hours into a single subject.',
    tier: 'gold',
    metricLabel: 'top subject',
    target: 50 * 3600,
    unit: 'seconds',
    metric: (s) => s.topSubjectSeconds,
  },
  {
    id: 'clean-run',
    name: 'Clean Run',
    description: 'Complete 10 sessions with zero logged distractions.',
    tier: 'silver',
    metricLabel: 'clean sessions',
    target: 10,
    unit: 'count',
    metric: (s) => s.cleanSessionCount,
  },
  {
    id: 'score-90',
    name: 'Peak Form',
    description: 'Finish a session with a Focus Score of 90 or above.',
    tier: 'silver',
    metricLabel: 'best score',
    target: 90,
    unit: 'score',
    metric: (s) => s.bestSessionScore,
  },
];

/**
 * Evaluate every achievement against lifetime stats.
 *
 * @param {LifetimeStats} stats
 * @param {Record<string, string>} [unlockedAt] previously persisted unlock times
 * @returns {Array<AchievementDefinition & {value:number, progress:number, progressLabel:string, unlocked:boolean, unlockedAt:string|null, remainingLabel:string}>}
 */
export function evaluateAchievements(stats, unlockedAt = {}) {
  return ACHIEVEMENTS.map((definition) => {
    const value = Math.max(0, definition.metric(stats) || 0);
    const progress = definition.target > 0 ? Math.min(1, value / definition.target) : 1;
    const unlocked = value >= definition.target;
    return {
      ...definition,
      value,
      progress: Math.round(progress * 1000) / 1000,
      progressLabel: labelFor(value, definition.unit),
      remainingLabel: unlocked ? 'Complete' : `${labelFor(Math.max(0, definition.target - value), definition.unit)} to go`,
      unlocked,
      unlockedAt: unlockedAt[definition.id] ?? null,
    };
  });
}

/**
 * Achievements that just became unlocked and are not yet recorded.
 * @param {Array<ReturnType<typeof evaluateAchievements>[number]>} evaluated
 * @param {Record<string, string>} unlockedAt
 * @returns {string[]} ids
 */
export function newlyUnlocked(evaluated, unlockedAt = {}) {
  return evaluated.filter((a) => a.unlocked && !unlockedAt[a.id]).map((a) => a.id);
}

/**
 * @param {number} value
 * @param {'count'|'seconds'|'days'|'score'} unit
 * @returns {string}
 */
function labelFor(value, unit) {
  if (unit === 'seconds') {
    const total = Math.round(value / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    return `${m}m`;
  }
  if (unit === 'days') return `${Math.round(value)} day${Math.round(value) === 1 ? '' : 's'}`;
  if (unit === 'score') return `${Math.round(value)}`;
  return `${Math.round(value)}`;
}

/**
 * Derive lifetime stats from session records. Used by both the achievements
 * screen and the profile summary, so the numbers can never disagree.
 *
 * @param {Array<{
 *   focusedSeconds:number, focusScore:number|null, distractionCount:number,
 *   subjectId?:string|null, status:string, segments?:Array<{kind:string,from:number,to:number|null}>,
 * }>} sessions
 * @param {{
 *   dailySeries: Array<{dayKey:string, focusedSeconds:number}>,
 *   longestStreak: number,
 *   currentStreak: number,
 *   weekOf: (dayKey:string) => string,
 *   monthOf: (dayKey:string) => string,
 * }} context
 * @returns {LifetimeStats}
 */
export function deriveLifetimeStats(sessions, context) {
  const { dailySeries = [], longestStreak = 0, currentStreak = 0, weekOf, monthOf } = context;

  /** @type {Map<string, number>} */
  const byWeek = new Map();
  /** @type {Map<string, number>} */
  const byMonth = new Map();
  /** @type {Map<string, number>} */
  const byMonthDays = new Map();
  /** @type {Map<string, number>} */
  const bySubject = new Map();

  for (const day of dailySeries) {
    const week = weekOf(day.dayKey);
    const month = monthOf(day.dayKey);
    byWeek.set(week, (byWeek.get(week) ?? 0) + day.focusedSeconds);
    byMonth.set(month, (byMonth.get(month) ?? 0) + day.focusedSeconds);
    if (day.focusedSeconds > 0) byMonthDays.set(month, (byMonthDays.get(month) ?? 0) + 1);
  }

  let totalFocusedSeconds = 0;
  let totalDistractions = 0;
  let bestSessionSeconds = 0;
  let bestSessionScore = 0;
  let cleanSessionCount = 0;

  for (const session of sessions) {
    totalFocusedSeconds += session.focusedSeconds || 0;
    totalDistractions += session.distractionCount || 0;
    bestSessionSeconds = Math.max(bestSessionSeconds, session.focusedSeconds || 0);
    if (session.focusScore !== null && session.focusScore !== undefined) {
      bestSessionScore = Math.max(bestSessionScore, session.focusScore);
    }
    if ((session.distractionCount || 0) === 0 && session.status === 'completed') cleanSessionCount += 1;
    if (session.subjectId) {
      const key = String(session.subjectId);
      bySubject.set(key, (bySubject.get(key) ?? 0) + (session.focusedSeconds || 0));
    }
  }

  return {
    totalSessions: sessions.length,
    totalFocusedSeconds,
    totalDistractions,
    currentStreak,
    longestStreak,
    bestWeekSeconds: Math.max(0, ...byWeek.values()),
    bestMonthSeconds: Math.max(0, ...byMonth.values()),
    bestSessionSeconds,
    bestSessionScore,
    bestMonthActiveDays: Math.max(0, ...byMonthDays.values()),
    topSubjectSeconds: Math.max(0, ...bySubject.values()),
    cleanSessionCount,
  };
}
