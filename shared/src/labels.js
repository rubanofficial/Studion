/**
 * Human labels for domain enums.
 *
 * Lives in the shared package because the same vocabulary appears in the API
 * payloads, the insights generator, the CSV export, and the UI. Defining it once
 * is what stops "breakStart" leaking into a sentence a user reads.
 */

/** @type {Record<string, {label: string, short: string}>} */
export const DISTRACTION_LABELS = {
  youtube: { label: 'YouTube', short: 'YT' },
  instagram: { label: 'Instagram', short: 'IG' },
  whatsapp: { label: 'WhatsApp', short: 'WA' },
  phone: { label: 'Phone', short: 'Phone' },
  browsing: { label: 'Random browsing', short: 'Web' },
  people: { label: 'Someone interrupted', short: 'People' },
  notifications: { label: 'Notifications', short: 'Notif' },
  other: { label: 'Other', short: 'Other' },
};

/** @param {string} kind */
export function distractionLabel(kind) {
  return DISTRACTION_LABELS[kind]?.label ?? kind;
}

/** @param {string} kind */
export function distractionShort(kind) {
  return DISTRACTION_LABELS[kind]?.short ?? kind;
}

/** @type {Record<string, string>} */
export const SESSION_STATUS_LABELS = {
  running: 'In progress',
  paused: 'Paused',
  completed: 'Completed',
  cancelled: 'Ended early',
  interrupted: 'Interrupted',
};

/** @param {string} status */
export function sessionStatusLabel(status) {
  return SESSION_STATUS_LABELS[status] ?? status;
}

/** @type {Record<string, string>} */
export const SESSION_KIND_LABELS = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
};

/** @param {string} kind */
export function sessionKindLabel(kind) {
  return SESSION_KIND_LABELS[kind] ?? kind;
}

/** @type {Record<string, string>} */
export const WEEKDAY_LABELS = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

/** @type {Record<string, string>} */
export const WEEKDAY_SHORT = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/**
 * Plain-language explanation of why a value matters, shown in the Focus Score
 * breakdown panel. Keeping it here means the wording is identical no matter
 * which screen renders it.
 * @param {string} factorKey
 * @returns {string}
 */
export function focusFactorHelp(factorKey) {
  switch (factorKey) {
    case 'completion':
      return 'How much of the duration you planned you actually focused for.';
    case 'timeInFocus':
      return 'Share of the open session spent working rather than paused or on a break.';
    case 'interruptionControl':
      return 'How often you had to pause. Fewer interruptions decays this factor far more gently than many.';
    case 'distractionControl':
      return 'Logged distractions per focused hour, so long sessions are judged fairly.';
    case 'outcome':
      return 'Whether you completed the session, ended it early, or something ended it for you.';
    default:
      return '';
  }
}
