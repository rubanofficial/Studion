/**
 * FocusSession — the record of one sitting.
 *
 * The important idea in this file: `events` is the source of truth and every
 * other number is *derived* from it. That derivation is wired into a
 * `pre('validate')` hook, so it is impossible to save a session whose
 * `focusedSeconds` disagrees with its event log — no matter which route, service,
 * migration or script produced the write.
 *
 * Why an event log rather than a stopwatch
 * ----------------------------------------
 *   - A refresh, crash, dead battery or offline stretch cannot lose time: the
 *     client only ever appends observations with timestamps.
 *   - The server re-folds the same log through the same shared code, so a client
 *     cannot inflate its own statistics.
 *   - Pauses, breaks, idle stretches and interruptions are all just entries, so
 *     "planned time" and "actually productive time" stay independently
 *     measurable — the distinction the whole product depends on.
 *
 * Indexes
 * -------
 *   { user: 1, clientId: 1 } UNIQUE
 *     Idempotency. The device generates `clientId` before it ever has a server
 *     id, so an offline queue can be flushed twice — after a reconnect, a retry,
 *     or a service-worker replay — and the session is still created exactly once.
 *     This single index is what makes offline sync safe.
 *
 *   { user: 1, startTime: -1 }
 *     The workhorse: every date-range analytics query and the session history
 *     list. Descending so "most recent first" is a forward index scan.
 *
 *   { user: 1, status: 1 } PARTIAL (status in [running, paused])
 *     "Which session is currently open?" is asked on every cockpit load and on
 *     every device switch. The partial filter means the index only contains the
 *     handful of live documents, so it stays tiny even after years of history.
 *
 *   { user: 1, subject: 1, startTime: -1 }
 *     Per-subject time series and the subject detail screen.
 *
 *   { user: 1, task: 1, startTime: -1 }
 *     Time actually spent per task, used to close the loop on estimates.
 *
 *   { user: 1, 'distractions.kind': 1, startTime: -1 }
 *     Multikey index backing distraction-pattern analytics ("YouTube is your
 *     most common interruption this month") without scanning sessions.
 *
 *   { user: 1, dayKey: 1 }
 *     Cheap "what happened on this day" lookup for the calendar day drawer.
 *
 *   { user: 1, updatedAt: -1 }
 *     Delta sync cursor.
 */

import mongoose from 'mongoose';

import {
  EVENT_TYPES,
  SEGMENT,
  SESSION_KINDS,
  SESSION_STATUS,
  SESSION_STATUSES,
  computeFocusScore,
  deriveSessionStats,
  explainFocusScore,
  isScorable,
} from '@focusforge/core';

/** @type {import('mongoose').SchemaDefinition} */
const eventSchema = {
  _id: false,
  type: { type: String, enum: EVENT_TYPES, required: true },
  at: { type: Date, required: true },
  /** Only meaningful for `distraction` events. */
  kind: { type: String, default: null },
};

/** @type {import('mongoose').SchemaDefinition} */
const segmentSchema = {
  _id: false,
  kind: { type: String, enum: Object.values(SEGMENT), required: true },
  from: { type: Date, required: true },
  /** Null while the segment is still open (a live session). */
  to: { type: Date, default: null },
};

const focusSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /**
     * Device-generated UUID. Unique per user, and the idempotency key for the
     * whole offline/retry story.
     */
    clientId: { type: String, required: true, trim: true, maxlength: 64 },

    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', default: null },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    kind: { type: String, enum: SESSION_KINDS, default: 'focus' },

    status: { type: String, enum: SESSION_STATUSES, default: SESSION_STATUS.RUNNING },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },

    // --------------------------------------------------- the source of truth
    events: { type: [eventSchema], default: [] },

    // -------------------------------------- derived, recomputed on every save
    segments: { type: [segmentSchema], default: [] },
    focusedSeconds: { type: Number, min: 0, default: 0 },
    breakSeconds: { type: Number, min: 0, default: 0 },
    pausedSeconds: { type: Number, min: 0, default: 0 },
    idleSeconds: { type: Number, min: 0, default: 0 },
    wallSeconds: { type: Number, min: 0, default: 0 },
    plannedDuration: { type: Number, min: 0, default: 0 },
    pauseCount: { type: Number, min: 0, default: 0 },
    breakCount: { type: Number, min: 0, default: 0 },
    distractionCount: { type: Number, min: 0, default: 0 },
    /** Histogram of distractions, kept in sync so analytics needs no array scan. */
    distractionKinds: { type: Map, of: Number, default: () => new Map() },
    distractions: {
      type: [{ _id: false, kind: { type: String, required: true }, at: { type: Date, required: true } }],
      default: [],
    },

    // ------------------------------------------------------------ focus score
    focusScore: { type: Number, min: 0, max: 100, default: null },
    /** Per-factor audit trail so the UI can explain the score. */
    focusScoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },

    // -------------------------------------------------------- context / meta
    /** Timezone at the moment of the session, so history buckets reproducibly. */
    timeZone: { type: String, default: 'UTC' },
    /** Local calendar day the session started on, denormalised for fast lookup. */
    dayKey: { type: String, default: null },
    device: { type: String, default: 'unknown' },
    userAgent: { type: String, maxlength: 300, default: null },
    lastHeartbeatAt: { type: Date, default: null },
    /** Set when the idle guard shortened a session, so the UI can explain itself. */
    interruptedReason: { type: String, default: null },
    reflection: { type: String, trim: true, maxlength: 1000, default: null },
    /**
     * Priority label shown on the snapshot at the time of the session. Optional
     * and cosmetic; the live `task` ref remains the link.
     */
    taskTitleSnapshot: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, transform: (_doc, ret) => (delete ret.__v, ret) },
  },
);

// --------------------------------------------------------------------- indexes
focusSessionSchema.index({ user: 1, clientId: 1 }, { unique: true, name: 'idempotency' });
focusSessionSchema.index({ user: 1, startTime: -1 }, { name: 'history' });
focusSessionSchema.index(
  { user: 1, status: 1 },
  {
    partialFilterExpression: { status: { $in: [SESSION_STATUS.RUNNING, SESSION_STATUS.PAUSED] } },
    name: 'open_session',
  },
);
focusSessionSchema.index({ user: 1, subject: 1, startTime: -1 }, { name: 'by_subject' });
focusSessionSchema.index({ user: 1, task: 1, startTime: -1 }, { name: 'by_task' });
focusSessionSchema.index({ user: 1, 'distractions.kind': 1, startTime: -1 }, { name: 'distraction_kinds' });
focusSessionSchema.index({ user: 1, dayKey: 1 }, { name: 'by_day' });
focusSessionSchema.index({ user: 1, updatedAt: -1 }, { name: 'delta_sync' });

/** @returns {boolean} */
focusSessionSchema.statics.isOpenStatus = function isOpenStatus(status) {
  return status === SESSION_STATUS.RUNNING || status === SESSION_STATUS.PAUSED;
};

/**
 * Recompute every derived field from `events`.
 *
 * Idempotent: calling it twice produces the same document. Always computes
 * against real timestamps, never a counter, so refresh / sleep / offline are
 * handled by construction rather than by special cases.
 *
 * @param {number} [now] epoch ms; defaults to the current time
 */
focusSessionSchema.methods.derive = function derive(now = Date.now()) {
  const stats = deriveSessionStats(
    {
      events: this.events.map((event) => ({ type: event.type, at: event.at, kind: event.kind })),
      startTime: this.startTime,
      endTime: this.endTime,
      status: this.status,
      plannedDuration: this.plannedDuration,
    },
    { now },
  );

  this.segments = stats.segments.map((segment) => ({
    kind: segment.kind,
    from: new Date(segment.from),
    to: segment.to === null ? null : new Date(segment.to),
  }));

  this.focusedSeconds = stats.focusedSeconds;
  this.breakSeconds = stats.breakSeconds;
  this.pausedSeconds = stats.pausedSeconds;
  this.idleSeconds = stats.idleSeconds;
  this.wallSeconds = stats.wallSeconds;
  this.pauseCount = stats.pauseCount;
  this.breakCount = stats.breakCount;

  const distractions = this.events.filter((event) => event.type === 'distraction');
  this.distractionCount = distractions.length;
  this.distractions = distractions.map((event) => ({ kind: event.kind ?? 'other', at: event.at }));
  /** @type {Map<string, number>} */
  const kinds = new Map();
  for (const distraction of this.distractions) {
    kinds.set(distraction.kind, (kinds.get(distraction.kind) ?? 0) + 1);
  }
  this.distractionKinds = kinds;

  const heartbeats = this.events.filter((event) => event.type === 'heartbeat');
  this.lastHeartbeatAt = heartbeats.length > 0 ? heartbeats.at(-1).at : null;

  // A score is only meaningful once the session has actually ended.
  const isTerminal =
    this.status === SESSION_STATUS.COMPLETED ||
    this.status === SESSION_STATUS.CANCELLED ||
    this.status === SESSION_STATUS.INTERRUPTED;

  if (isTerminal && isScorable(stats)) {
    const explained = explainFocusScore({
      focusedSeconds: stats.focusedSeconds,
      plannedSeconds: stats.plannedSeconds,
      wallSeconds: stats.wallSeconds,
      pauseCount: stats.pauseCount,
      distractionsPerHour: stats.distractionsPerHour,
      status: this.status,
    });
    this.focusScore = explained.score;
    this.focusScoreBreakdown = {
      summary: explained.summary,
      strongest: explained.strongest,
      weakest: explained.weakest,
      factors: explained.factors,
    };
  } else {
    this.focusScore = null;
    this.focusScoreBreakdown = null;
  }

  void computeFocusScore; // scoring goes through explainFocusScore so the audit trail is never skipped
  return this;
};

/**
 * Guarantee consistency at the last possible moment. Because this runs on every
 * save, no caller can persist a session with stale derived numbers.
 */
focusSessionSchema.pre('validate', function deriveBeforeValidate(next) {
  try {
    this.derive();
    next();
  } catch (error) {
    next(/** @type {Error} */ (error));
  }
});

/**
 * Append events without ever mutating history.
 *
 * Duplicate `(type, at)` pairs are dropped here as well as in the shared folder,
 * so a retried batch is genuinely free rather than merely harmless.
 *
 * @param {Array<{type: string, at: Date|string|number, kind?: string|null}>} incoming
 * @returns {number} how many events were actually added
 */
focusSessionSchema.methods.appendEvents = function appendEvents(incoming) {
  const seen = new Set(this.events.map((event) => `${event.type}@${new Date(event.at).getTime()}`));
  let added = 0;
  for (const event of incoming) {
    const at = new Date(event.at);
    if (Number.isNaN(at.getTime())) continue;
    const key = `${event.type}@${at.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    this.events.push({ type: event.type, at, kind: event.kind ?? null });
    added += 1;
  }
  if (added > 0) {
    this.events.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return added;
};

/** @returns {boolean} */
focusSessionSchema.methods.isOpen = function isOpen() {
  return focusSessionSchema.statics.isOpenStatus(this.status);
};

export const FocusSession = mongoose.model('FocusSession', focusSessionSchema);
