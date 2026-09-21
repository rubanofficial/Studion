/**
 * Development seed script.
 *
 * The point of this file is that analytics cannot be validated against random
 * data. Random durations produce insights that are technically correct and
 * obviously meaningless, so nothing gets verified and bugs hide. Instead this
 * script simulates a *plausible student*: a placement-preparation routine with
 * real subjects, a consistent evening study block, a bad week, a strong week, a
 * couple of genuine breaks in the routine, and the kinds of distraction a person
 * actually logs.
 *
 * Everything is derived through the real code path — events are appended and the
 * model folds them — so seeded data is shaped exactly like data the app produces
 * in use. Nothing is written directly into the derived columns.
 *
 * Usage:
 *   npm run seed              # seed into the configured database
 *   npm run seed:reset        # wipe first
 *   npm run seed -- --weeks 12
 */

import { EVENT, SESSION_STATUS, dayKey, shiftDayKey, zonedToUtc } from '@focusforge/core';

import { Achievement } from '../models/Achievement.js';
import { DailyStats } from '../models/DailyStats.js';
import { FocusSession } from '../models/FocusSession.js';
import { Goal } from '../models/Goal.js';
import { Subject } from '../models/Subject.js';
import { Task } from '../models/Task.js';
import { User } from '../models/User.js';
import { UserSettings } from '../models/UserSettings.js';
import { env } from '../config/env.js';
import { clearDatabase, connectDatabase, disconnectDatabase, syncIndexes } from '../db/connect.js';
import * as achievementService from '../services/achievementService.js';
import * as goalService from '../services/goalService.js';
import * as settingsService from '../services/settingsService.js';
import { backfill } from '../services/statsService.js';
import { logger } from '../utils/logger.js';

const TIME_ZONE = 'Asia/Kolkata';

/** Deterministic PRNG so repeated seeds produce identical analytics. */
function createRandom(seed = 20260302) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = createRandom();

/** @param {number} min @param {number} max */
function between(min, max) {
  return min + random() * (max - min);
}

/** @param {number} min @param {number} max */
function intBetween(min, max) {
  return Math.round(between(min, max));
}

/** Pick a value with the given weights. `[[value, weight], ...]` */
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const SUBJECTS = [
  { name: 'DSA', icon: '◈', color: '#5eead4', weight: 0.3, weeklyTargetSeconds: 10 * 3600 },
  { name: 'Java', icon: '{}', color: '#818cf8', weight: 0.18, weeklyTargetSeconds: 6 * 3600 },
  { name: 'PostgreSQL', icon: '▤', color: '#60a5fa', weight: 0.14, weeklyTargetSeconds: 4 * 3600 },
  { name: 'System Design', icon: '⬡', color: '#f472b6', weight: 0.14, weeklyTargetSeconds: 5 * 3600 },
  { name: 'Aptitude', icon: '∑', color: '#fbbf24', weight: 0.12, weeklyTargetSeconds: 3 * 3600 },
  { name: 'AI / ML', icon: '∿', color: '#a78bfa', weight: 0.12, weeklyTargetSeconds: 4 * 3600 },
];

const TASKS_BY_SUBJECT = {
  DSA: [
    'Graph traversal — BFS and DFS',
    'Dynamic programming — 1D problems',
    'Sliding window patterns',
    'Binary search on answer space',
    'Trie implementation from scratch',
    'Union-find and cycle detection',
  ],
  Java: [
    'Collections internals — HashMap',
    'Streams and functional interfaces',
    'Concurrency — executors and futures',
    'JVM memory model',
  ],
  PostgreSQL: [
    'Query planner and EXPLAIN ANALYZE',
    'Index types and when they are used',
    'Transactions and isolation levels',
    'Window functions',
  ],
  'System Design': [
    'Design a rate limiter',
    'Design a URL shortener',
    'Caching strategies and eviction',
    'Consistent hashing',
  ],
  Aptitude: [
    'Permutations and combinations',
    'Time, speed and distance sets',
    'Data interpretation practice',
  ],
  'AI / ML': [
    'Gradient descent from scratch',
    'Bias-variance tradeoff',
    'Regularisation techniques',
  ],
};

/** Realistic distraction sets, weighted towards the ones that actually happen. */
const DISTRACTIONS = [
  ['youtube', 0.28],
  ['instagram', 0.18],
  ['whatsapp', 0.16],
  ['phone', 0.12],
  ['browsing', 0.12],
  ['people', 0.08],
  ['notifications', 0.05],
  ['other', 0.01],
];

/**
 * Build one session's event log.
 *
 * Deliberately includes heartbeats: without them the idle guard cannot run, and
 * the whole reason the log exists would go untested by the seed data.
 *
 * @param {{
 *   startMs: number,
 *   plannedMinutes: number,
 *   focusMinutes: number,
 *   pauseCount: number,
 *   breakMinutes: number,
 *   distractionKinds: string[],
 * }} spec
 */
function buildEventLog(spec) {
  const { startMs, focusMinutes, pauseCount, breakMinutes, distractionKinds } = spec;
  const total = focusMinutes + pauseCount * intBetween(2, 5) + breakMinutes;
  const events = [{ type: EVENT.START, at: startMs }];

  // Distribute pauses evenly, then a break in the middle if there is one.
  const pauseAt = [];
  for (let index = 0; index < pauseCount; index += 1) {
    const position = ((index + 1) / (pauseCount + 1)) * total;
    pauseAt.push(Math.round(position));
  }

  const breakStart = breakMinutes > 0 ? Math.round(total * 0.55) : null;
  const breakEnd = breakStart === null ? null : breakStart + breakMinutes;

  /** @type {Array<{at: number, type: string, extra?: string}>} */
  const transitions = [];
  for (const at of pauseAt) {
    if (breakStart !== null && at > breakStart && at < breakEnd) continue;
    transitions.push({ at, type: EVENT.PAUSE });
    transitions.push({ at: at + intBetween(2, 5), type: EVENT.RESUME });
  }
  if (breakStart !== null && breakEnd !== null) {
    transitions.push({ at: breakStart, type: EVENT.BREAK_START });
    transitions.push({ at: breakEnd, type: EVENT.BREAK_END });
    transitions.push({ at: breakEnd, type: EVENT.RESUME });
  }

  for (const transition of transitions.sort((a, b) => a.at - b.at)) {
    events.push({ type: transition.type, at: startMs + transition.at * 60_000 });
  }

  // Distractions spread through the working minutes.
  for (const kind of distractionKinds) {
    const offset = Math.round(between(3, Math.max(4, focusMinutes - 3)));
    events.push({ type: EVENT.DISTRACTION, at: startMs + offset * 60_000, kind });
  }

  // Heartbeats every minute of the *wall* duration, which is what a live tab
  // would actually have emitted. The idle guard then has real evidence to work
  // with and, crucially, finds nothing to flag.
  for (let minute = 1; minute <= total; minute += 1) {
    events.push({ type: EVENT.HEARTBEAT, at: startMs + minute * 60_000 });
  }

  const endAt = startMs + total * 60_000;
  events.push({ type: EVENT.END, at: endAt });

  return { events: events.sort((a, b) => a.at - b.at), endAt };
}

/**
 * How a given day should go. Encodes the shape of a real routine rather than a
 * uniform random draw, so the analytics screens have something to find.
 *
 * @param {Date} date
 * @param {number} weeksAgo
 */
function planDay(date, weeksAgo) {
  const weekday = date.getUTCDay();

  // A deliberate light patch: two days of a break six weeks ago. The product
  // should report this neutrally, so the seed data must contain it.
  if (weeksAgo === 6 && (weekday === 3 || weekday === 4)) {
    return { sessions: [], note: 'scheduled break' };
  }

  // Saturday is a short day; Sunday is a rest day except in the final two weeks.
  if (weekday === 0 && weeksAgo > 1) return { sessions: [], note: 'rest day' };

  // Progression: earlier weeks are lighter, later weeks are heavier. This is what
  // makes "your average session grew this week" a real, derivable insight.
  const intensity = 1 - Math.min(0.45, weeksAgo * 0.12);
  const isStrongWeek = weeksAgo <= 1;

  if (weekday === 6) {
    return { sessions: intensity > 0.8 ? [intBetween(30, 45)] : [intBetween(20, 35)] };
  }
  if (weekday === 0) {
    return isStrongWeek ? { sessions: [intBetween(35, 50)] } : { sessions: [] };
  }

  // Weekday: a morning block and the main evening block. The evening block is
  // consistently 20:00–22:00, which is what the peak-window insight should find.
  const morning = random() < 0.75 ? [intBetween(25, 45)] : [];
  const evening = [intBetween(45, 70), random() < (isStrongWeek ? 0.7 : 0.45) ? intBetween(30, 50) : 0];
  return { sessions: [...morning, ...evening].filter((minutes) => minutes > 0).map((minutes) => Math.round(minutes * intensity)) };
}

async function seedUser() {
  const email = env.SEED_DEMO_EMAIL;
  const existing = await User.findOne({ email });
  if (existing) {
    logger.info('Removing existing demo user', { email });
    await Promise.all([
      FocusSession.deleteMany({ user: existing._id }),
      Subject.deleteMany({ user: existing._id }),
      Task.deleteMany({ user: existing._id }),
      Goal.deleteMany({ user: existing._id }),
      Achievement.deleteMany({ user: existing._id }),
      DailyStats.deleteMany({ user: existing._id }),
      UserSettings.deleteMany({ user: existing._id }),
      existing.deleteOne(),
    ]);
  }

  const user = new User({ email, name: 'Demo Student', password: env.SEED_DEMO_PASSWORD });
  await user.save();

  const settings = await settingsService.getOrCreate(user._id, { timeZone: TIME_ZONE });
  settings.timeZone = TIME_ZONE;
  settings.weekStart = 1;
  settings.dailyGoalSeconds = 4 * 3600;
  settings.successThresholdSeconds = 30 * 60;
  settings.theme = 'dark';
  settings.sound = { enabled: false, ambience: 'none', volume: 0.4, chime: true };
  await settings.save();

  const subjects = await Subject.insertMany(
    SUBJECTS.map((subject, index) => ({
      user: user._id,
      name: subject.name,
      icon: subject.icon,
      color: subject.color,
      weeklyTargetSeconds: subject.weeklyTargetSeconds,
      monthlyTargetSeconds: subject.weeklyTargetSeconds * 4,
      order: index,
      description: '',
    })),
  );

  const subjectByName = new Map(subjects.map((subject) => [subject.name, subject]));

  const tasks = await Task.insertMany(
    Object.entries(TASKS_BY_SUBJECT).flatMap(([subjectName, titles]) =>
      titles.map((title, index) => ({
        user: user._id,
        subject: subjectByName.get(subjectName)._id,
        title,
        priority: weighted([
          ['high', 0.25],
          ['medium', 0.55],
          ['low', 0.2],
        ]),
        estimatedDuration: intBetween(3, 8) * 900,
        status: index < 2 ? 'in-progress' : random() < 0.2 ? 'completed' : 'todo',
        tags: [subjectName.toLowerCase().replace(/\s+/g, '-')],
        order: index,
        dueAt: random() < 0.35 ? new Date(Date.now() + intBetween(-4, 12) * 86_400_000) : null,
      })),
    ),
  );

  await Goal.insertMany([
    { user: user._id, period: 'daily', subject: null, targetSeconds: 4 * 3600, label: 'Daily focus' },
    { user: user._id, period: 'weekly', subject: null, targetSeconds: 25 * 3600, label: 'Weekly deep work' },
    { user: user._id, period: 'weekly', subject: subjectByName.get('DSA')._id, targetSeconds: 10 * 3600, label: 'DSA problem sets' },
    { user: user._id, period: 'monthly', subject: null, targetSeconds: 100 * 3600, label: 'Placement prep' },
  ]);

  return { user, settings, subjects, subjectByName, tasks };
}

/**
 * @param {{user: any, settings: any, subjectByName: Map<string, any>, tasks: any[]}} context
 * @param {number} weeks
 */
async function seedSessions(context, weeks) {
  const { user, subjectByName, tasks } = context;
  const today = new Date();
  const todayKey = dayKey(today, TIME_ZONE);
  const documents = [];

  const tasksBySubject = new Map();
  for (const task of tasks) {
    const key = String(task.subject);
    if (!tasksBySubject.has(key)) tasksBySubject.set(key, []);
    tasksBySubject.get(key).push(task);
  }

  const devicePool = [['web-desktop', 0.75], ['web-mobile', 0.2], ['web-tablet', 0.05]];

  for (let dayOffset = weeks * 7 - 1; dayOffset >= 0; dayOffset -= 1) {
    const key = shiftDayKey(todayKey, -dayOffset);
    const date = new Date(`${key}T00:00:00Z`);
    const weeksAgo = Math.floor(dayOffset / 7);
    const plan = planDay(date, weeksAgo);
    if (plan.sessions.length === 0) continue;

    // Start times: a mid-morning block and the main evening block from 20:00.
    const startHours = plan.sessions.length > 1 ? [intBetween(9, 11), 20] : [weighted([[10, 0.3], [16, 0.2], [20, 0.5]])];

    plan.sessions.forEach((minutes, index) => {
      if (minutes < 12) return;
      const startHour = startHours[index] ?? 20;
      const startMinute = weighted([[0, 0.6], [15, 0.25], [30, 0.15]]) === 0 ? intBetween(0, 5) : intBetween(0, 55);
      const [year, month, day] = key.split('-').map(Number);
      const startMs = zonedToUtc({ year, month, day, hour: startHour, minute: startMinute }, TIME_ZONE).getTime();

      const subjectName = weighted(SUBJECTS.map((subject) => [subject.name, subject.weight]));
      const subject = subjectByName.get(subjectName);

      const isGoodSession = random() < 0.78;
      const focusMinutes = Math.max(10, Math.round(minutes * (isGoodSession ? between(0.9, 1) : between(0.45, 0.8))));
      const pauseCount = isGoodSession ? weighted([[0, 0.45], [1, 0.35], [2, 0.15], [3, 0.05]]) : intBetween(2, 5);
      const breakMinutes = focusMinutes > 40 && random() < 0.7 ? intBetween(5, 12) : 0;
      const distractionCount = isGoodSession ? weighted([[0, 0.35], [1, 0.35], [2, 0.2], [3, 0.1]]) : intBetween(2, 5);
      const distractionKinds = Array.from({ length: Math.round(distractionCount) }, () => weighted(DISTRACTIONS));

      const { events, endAt } = buildEventLog({
        startMs,
        plannedMinutes: minutes,
        focusMinutes,
        pauseCount,
        breakMinutes,
        distractionKinds,
      });

      const planned = minutes * 60_000;
      const wall = endAt - startMs;
      const completed = wall >= planned * 0.9;
      const subjectTasks = tasksBySubject.get(String(subject._id)) ?? [];
      const task = subjectTasks.length > 0 && random() < 0.7 ? subjectTasks[intBetween(0, subjectTasks.length - 1)] : null;

      documents.push({
        user: user._id,
        clientId: `seed-${key}-${index}-${Math.round(startMs / 1000)}`,
        subject: subject._id,
        task: task?._id ?? null,
        taskTitleSnapshot: task?.title ?? null,
        kind: 'focus',
        status: completed ? SESSION_STATUS.COMPLETED : SESSION_STATUS.CANCELLED,
        startTime: new Date(startMs),
        endTime: new Date(endAt),
        plannedDuration: minutes * 60,
        timeZone: TIME_ZONE,
        dayKey: key,
        device: weighted(devicePool),
        userAgent: 'seed-script',
        events,
      });
    });
  }

  // Inserted via the model so `derive()` and the scoring hooks run — the seeded
  // rows are shaped exactly like rows the app produces in use.
  let written = 0;
  for (const document of documents) {
    const session = new FocusSession(document);
    await session.save();
    written += 1;
  }

  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const weeksIndex = args.indexOf('--weeks');
  const weeks = weeksIndex === -1 ? 10 : Math.max(1, Math.min(52, Number(args[weeksIndex + 1]) || 10));

  await connectDatabase();
  await syncIndexes();

  if (args.includes('--reset')) {
    logger.info('Clearing all collections');
    await clearDatabase();
  }

  const context = await seedUser();
  const sessionsWritten = await seedSessions(context, weeks);

  // Rollups are rebuilt from the seeded sessions rather than written by hand.
  const todayKeyValue = dayKey(new Date(), TIME_ZONE);
  await backfill(context.user._id, {
    fromKey: shiftDayKey(todayKeyValue, -(weeks * 7 + 2)),
    toKey: todayKeyValue,
    timeZone: TIME_ZONE,
    successThresholdSeconds: context.settings.successThresholdSeconds,
  });

  const achievements = await achievementService.evaluateAndSync(context.user._id, context.settings);
  const goals = await goalService.evaluate(context.user._id, context.settings, {});

  const bySubject = await FocusSession.aggregate([
    { $match: { user: context.user._id } },
    { $group: { _id: '$subject', seconds: { $sum: '$focusedSeconds' }, count: { $sum: 1 } } },
  ]);

  // eslint-disable-next-line no-console
  console.log('\n  FocusForge demo data ready\n');
  // eslint-disable-next-line no-console
  console.log(`  Sign in with:  ${env.SEED_DEMO_EMAIL}`);
  // eslint-disable-next-line no-console
  console.log(`  Password:      ${env.SEED_DEMO_PASSWORD}`);
  // eslint-disable-next-line no-console
  console.log(`  Timezone:      ${TIME_ZONE}`);
  // eslint-disable-next-line no-console
  console.log(`  Span:          ${weeks} weeks`);
  // eslint-disable-next-line no-console
  console.log(`  Subjects:      ${context.subjects.length}`);
  // eslint-disable-next-line no-console
  console.log(`  Tasks:         ${context.tasks.length}`);
  // eslint-disable-next-line no-console
  console.log(`  Sessions:      ${sessionsWritten}`);
  // eslint-disable-next-line no-console
  console.log(`  Achievements:  ${achievements.evaluated.filter((entry) => entry.unlocked).length} unlocked`);
  // eslint-disable-next-line no-console
  console.log(`  Goals:         ${goals.goals.length}`);
  for (const subject of context.subjects) {
    const row = bySubject.find((entry) => String(entry._id) === String(subject._id));
    const hours = ((row?.seconds ?? 0) / 3600).toFixed(1);
    // eslint-disable-next-line no-console
    console.log(`    ${subject.name.padEnd(16)} ${hours.padStart(6)}h   ${String(row?.count ?? 0).padStart(3)} sessions`);
  }
  // eslint-disable-next-line no-console
  console.log('');

  await disconnectDatabase();
}

main().catch(async (error) => {
  logger.error('Seed failed', { error });
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
