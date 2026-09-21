/**
 * Shared vocabulary for the FocusForge domain.
 *
 * Everything here is plain data so it can be serialised over HTTP, persisted in
 * MongoDB, and shipped to the browser without transformation.
 */

/**
 * The append-only focus event log is the single source of truth for "how long
 * did I actually focus?". Aggregates are always *derived* from this log and are
 * never accepted from a client, which is what makes refresh / sleep / offline /
 * multi-device reporting correct.
 */
export const EVENT = Object.freeze({
  START: 'start',
  PAUSE: 'pause',
  RESUME: 'resume',
  BREAK_START: 'breakStart',
  BREAK_END: 'breakEnd',
  /** Records an interruption. Does not change the run state. */
  DISTRACTION: 'distraction',
  /**
   * Liveness ping emitted by the owning tab every `HEARTBEAT_INTERVAL_MS`.
   * Used to detect machine sleep / frozen tabs, which would otherwise be
   * billed as focus time because we only ever store wall-clock instants.
   */
  HEARTBEAT: 'heartbeat',
  END: 'end',
});

export const EVENT_TYPES = Object.freeze(Object.values(EVENT));

/** Timeline segment kinds produced by folding the event log. */
export const SEGMENT = Object.freeze({
  FOCUS: 'focus',
  BREAK: 'break',
  PAUSED: 'paused',
  /** Wall-clock time inside a focus window with no liveness evidence. */
  IDLE: 'idle',
});

export const SESSION_STATUS = Object.freeze({
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  /** Finished before the planned duration, by the user, deliberately. */
  CANCELLED: 'cancelled',
  /** Ended by something other than a deliberate "end session" (sleep, crash, idle guard). */
  INTERRUPTED: 'interrupted',
});

export const SESSION_STATUSES = Object.freeze(Object.values(SESSION_STATUS));

/** Statuses that mean the session is still live on some device. */
export const OPEN_STATUSES = Object.freeze([SESSION_STATUS.RUNNING, SESSION_STATUS.PAUSED]);

export const SESSION_KIND = Object.freeze({
  FOCUS: 'focus',
  SHORT_BREAK: 'shortBreak',
  LONG_BREAK: 'longBreak',
});

export const SESSION_KINDS = Object.freeze(Object.values(SESSION_KIND));

export const TASK_STATUS = Object.freeze({
  TODO: 'todo',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  SKIPPED: 'skipped',
});

export const TASK_STATUSES = Object.freeze(Object.values(TASK_STATUS));

export const PRIORITY = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

export const PRIORITIES = Object.freeze(Object.values(PRIORITY));

export const GOAL_PERIOD = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
});

export const GOAL_PERIODS = Object.freeze(Object.values(GOAL_PERIOD));

/** Canonical distraction taxonomy. `other` keeps free-text but stays countable. */
export const DISTRACTION_KINDS = Object.freeze([
  'youtube',
  'instagram',
  'whatsapp',
  'phone',
  'browsing',
  'people',
  'notifications',
  'other',
]);

export const DEVICES = Object.freeze(['web-desktop', 'web-mobile', 'web-tablet', 'unknown']);

export const THEMES = Object.freeze(['dark', 'light', 'system']);

export const AMBIENCE = Object.freeze(['none', 'rain', 'cafe', 'forest', 'white', 'brown', 'lofi']);

/** Timer presets offered out of the box, in minutes. */
export const DEFAULT_FOCUS_PRESETS = Object.freeze([15, 25, 45, 60, 90]);
export const DEFAULT_BREAK_PRESETS = Object.freeze([5, 10, 15]);

/**
 * Liveness cadence, and the tolerance before silence is read as "this machine
 * was not running".
 *
 * Browsers throttle timers in background tabs: normally to one tick per minute,
 * but as low as one per five minutes under Chrome's intensive throttling. A
 * 6-minute tolerance therefore sits just above the worst documented throttle, so
 * a backgrounded tab is never mistaken for a sleeping laptop, while a real
 * suspend (minutes to hours of silence) is still caught exactly.
 *
 * Idle inference additionally requires at least two heartbeats inside the focus
 * window (`MIN_HEARTBEATS_FOR_IDLE`). A client that never sends heartbeats — an
 * older build, or a replayed offline log — gives us no evidence either way, and
 * absence of evidence must not be turned into a penalty.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const IDLE_GAP_MS = 360_000;
export const MIN_HEARTBEATS_FOR_IDLE = 2;

/**
 * Sessions shorter than this are not scored — a 20 second accidental tap does
 * not deserve a "97 Focus Score".
 */
export const MIN_SCORABLE_FOCUS_SECONDS = 60;

export const DEFAULT_DAILY_GOAL_SECONDS = 4 * 3600;
export const DEFAULT_SUCCESS_THRESHOLD_SECONDS = 30 * 60;

/**
 * Focus Score weights. They are exported so the UI can show the user exactly
 * how each factor moved their score (see `focusScore.js`).
 */
export const FOCUS_SCORE_WEIGHTS = Object.freeze({
  completion: 0.3,
  timeInFocus: 0.25,
  interruptionControl: 0.18,
  distractionControl: 0.17,
  outcome: 0.1,
});

/** Days of history required before an insight is allowed to be emitted. */
export const INSIGHT_MIN_SAMPLE = Object.freeze({
  sessions: 5,
  distinctDays: 3,
  distractions: 10,
  subjectsForSplit: 5,
});
