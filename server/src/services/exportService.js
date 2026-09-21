/**
 * Data export.
 *
 * The privacy statement promises that all of a user's data can be taken out, so
 * export is a first-class feature rather than a debug endpoint. Two formats:
 *
 *   - **JSON** is lossless and is what a user should archive. It includes the raw
 *     event log, so a re-import could reconstruct every duration exactly.
 *   - **CSV** is for spreadsheets: one row per record, flattened, with durations
 *     as both raw seconds and a readable column so a formula can use either.
 *
 * The CSV writer is hand-rolled because the escaping rule that actually matters
 * (RFC 4180 quoting) is a dozen lines, and hand-rolling it removes a dependency
 * from the one code path that handles a user's entire history.
 */

import { formatDuration, distractionLabel } from '@focusforge/core';

import { FocusSession } from '../models/FocusSession.js';
import { Goal } from '../models/Goal.js';
import { Subject } from '../models/Subject.js';
import { Task } from '../models/Task.js';
import { Achievement } from '../models/Achievement.js';

import { nameAndColorMap } from './subjectService.js';
import { periodSummary } from './analyticsService.js';

/**
 * Quote a CSV field per RFC 4180.
 *
 * Two subtleties worth being explicit about: any field containing a quote,
 * comma, CR or LF must be quoted, and embedded quotes are doubled rather than
 * escaped. Getting this wrong silently corrupts a spreadsheet rather than
 * failing loudly, which is why it is tested directly.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {string[]} columns
 * @returns {string}
 */
export function toCsv(rows, columns) {
  const header = columns.map(csvField).join(',');
  const body = rows.map((row) => columns.map((column) => csvField(row[column])).join(','));
  // A UTF-8 BOM so Excel opens accented subject names correctly instead of
  // mangling them. Harmless everywhere else.
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`;
}

const SESSION_COLUMNS = [
  'id',
  'clientId',
  'subject',
  'task',
  'kind',
  'status',
  'startTime',
  'endTime',
  'timeZone',
  'dayKey',
  'plannedDurationSeconds',
  'focusedSeconds',
  'focusedReadable',
  'breakSeconds',
  'pausedSeconds',
  'idleSeconds',
  'wallSeconds',
  'focusScore',
  'pauseCount',
  'breakCount',
  'distractionCount',
  'distractions',
  'device',
  'interruptedReason',
  'reflection',
];

const TASK_COLUMNS = [
  'id',
  'subject',
  'title',
  'description',
  'priority',
  'status',
  'estimatedDurationSeconds',
  'focusedSeconds',
  'sessionCount',
  'dueAt',
  'completedAt',
  'tags',
  'createdAt',
];

const SUBJECT_COLUMNS = [
  'id',
  'name',
  'icon',
  'color',
  'description',
  'weeklyTargetSeconds',
  'monthlyTargetSeconds',
  'archivedAt',
  'createdAt',
];

/**
 * Build the whole export payload.
 *
 * @param {any} user
 * @param {any} settings
 * @param {{fromKey: string, toKey: string, dataset: 'all'|'sessions'|'tasks'|'subjects'|'analytics', format: 'json'|'csv'}} options
 */
export async function build(user, settings, options) {
  const { fromKey, toKey, dataset, format } = options;
  const from = new Date(`${fromKey}T00:00:00.000Z`);
  const to = new Date(`${toKey}T23:59:59.999Z`);

  const wants = (name) => dataset === 'all' || dataset === name;
  const subjects = await nameAndColorMap(user._id);
  const payload = {};

  if (wants('sessions')) {
    const documents = await FocusSession.find({ user: user._id, startTime: { $gte: from, $lte: to } })
      .sort({ startTime: 1 })
      .lean();

    payload.sessions = documents.map((document) => ({
      ...document,
      subjects: undefined,
      subjectName: document.subject ? subjects.get(String(document.subject))?.name ?? null : null,
    }));
  }

  if (wants('tasks')) {
    payload.tasks = await Task.find({ user: user._id }).sort({ createdAt: 1 }).lean();
  }

  if (wants('subjects')) {
    payload.subjects = await Subject.find({ user: user._id }).sort({ order: 1 }).lean();
  }

  if (wants('analytics')) {
    const summary = await periodSummary(user, settings, { period: 'month' });
    payload.analytics = {
      generatedAt: new Date().toISOString(),
      period: summary.period,
      summary: summary.summary,
      dailySeries: summary.summary.dailySeries,
      subjects: summary.summary.subjects,
      distractions: summary.summary.distractions,
      insights: summary.insights,
      goals: summary.goals,
      streak: summary.streak,
    };
  }

  if (wants('sessions') || dataset === 'all') {
    payload.goals = await Goal.find({ user: user._id }).lean();
    payload.achievements = await Achievement.find({ user: user._id }).lean();
  }

  if (format === 'json') {
    return {
      contentType: 'application/json; charset=utf-8',
      filename: `focusforge-export-${fromKey}-to-${toKey}.json`,
      body: JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          application: 'FocusForge',
          schemaVersion: 1,
          range: { fromKey, toKey },
          settings: {
            timeZone: settings.timeZone,
            weekStart: settings.weekStart,
            dailyGoalSeconds: settings.dailyGoalSeconds,
            successThresholdSeconds: settings.successThresholdSeconds,
          },
          ...payload,
        },
        null,
        2,
      ),
    };
  }

  // CSV carries exactly one dataset, so an ambiguous request is resolved towards
  // sessions rather than producing an unusable file with three schemas in it.
  if (dataset === 'tasks') {
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `focusforge-tasks-${toKey}.csv`,
      body: toCsv(
        (payload.tasks ?? []).map((task) => ({
          ...task,
          id: String(task._id),
          subject: task.subject ? subjects.get(String(task.subject))?.name ?? String(task.subject) : '',
          tags: (task.tags ?? []).join('|'),
        })),
        TASK_COLUMNS,
      ),
    };
  }

  if (dataset === 'subjects') {
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `focusforge-subjects-${toKey}.csv`,
      body: toCsv((payload.subjects ?? []).map((subject) => ({ ...subject, id: String(subject._id) })), SUBJECT_COLUMNS),
    };
  }

  if (dataset === 'analytics') {
    const rows = (payload.analytics?.dailySeries ?? []).map((day) => ({
      dayKey: day.dayKey,
      focusedSeconds: day.focusedSeconds,
      focusedReadable: formatDuration(day.focusedSeconds),
      breakSeconds: day.breakSeconds,
      sessionCount: day.sessionCount,
      completedCount: day.completedCount,
      distractionCount: day.distractionCount,
      goalMet: day.goalMet,
    }));
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `focusforge-analytics-${fromKey}-to-${toKey}.csv`,
      body: toCsv(rows, [
        'dayKey',
        'focusedSeconds',
        'focusedReadable',
        'breakSeconds',
        'sessionCount',
        'completedCount',
        'distractionCount',
        'goalMet',
      ]),
    };
  }

  const rows = (payload.sessions ?? []).map((session) => ({
    ...session,
    id: String(session._id),
    subject: session.subjectName ?? '',
    task: session.task ? String(session.task) : '',
    plannedDurationSeconds: session.plannedDuration ?? 0,
    focusedReadable: formatDuration(session.focusedSeconds ?? 0),
    distractions: Object.entries(session.distractionKinds ?? {})
      .map(([kind, count]) => `${distractionLabel(kind)}×${count}`)
      .join('|'),
    startTime: session.startTime ? new Date(session.startTime).toISOString() : '',
    endTime: session.endTime ? new Date(session.endTime).toISOString() : '',
    createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : '',
    updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : '',
  }));

  return {
    contentType: 'text/csv; charset=utf-8',
    filename: `focusforge-sessions-${fromKey}-to-${toKey}.csv`,
    body: toCsv(rows, SESSION_COLUMNS),
  };
}

/**
 * A machine-readable statement of what the application stores, for the privacy
 * screen. Written as data rather than prose so the UI can render it consistently.
 */
export function dataStatement() {
  return [
    {
      key: 'account',
      title: 'Account',
      stored: ['Email address', 'Display name', 'Password (bcrypt hash, never the password itself)', 'Created and last-active timestamps'],
      why: 'To sign you in and to keep your data separate from everyone else’s.',
    },
    {
      key: 'sessions',
      title: 'Focus sessions',
      stored: [
        'Start and end instants',
        'The raw event log (start, pause, resume, break, heartbeat, distraction, end)',
        'Derived durations: focused, break, paused, idle, wall',
        'Focus score and its per-factor breakdown',
        'Timezone and device label recorded at the time',
      ],
      why: 'These are the measurements the entire product is built from. Storing instants rather than counts is what makes the numbers survive a refresh, a crash or an offline stretch.',
    },
    {
      key: 'subjects',
      title: 'Subjects, tasks and goals',
      stored: ['Names, colours, icons and targets you create', 'Task titles, notes, deadlines and tags'],
      why: 'So your time can be attributed to something meaningful.',
    },
    {
      key: 'settings',
      title: 'Preferences',
      stored: ['Theme, accent, timezone, week start', 'Timer presets and automation choices', 'Notification and sound preferences'],
      why: 'To make the app behave the way you asked it to on every device.',
    },
    {
      key: 'security',
      title: 'Sessions and tokens',
      stored: ['Refresh tokens as SHA-256 hashes (not recoverable)', 'A coarse network prefix and browser label per sign-in'],
      why: 'To let you stay signed in, and to detect a stolen token by invalidating the whole rotation family.',
    },
  ];
}
