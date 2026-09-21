/**
 * Session document → shared-core session record.
 *
 * This is the seam between persistence and analysis. Everything downstream
 * (`@focusforge/core`'s aggregation, streaks, insights, achievements) consumes
 * the record shape produced here, so this one function decides how stored data
 * is interpreted — and because both the API and the client-side optimistic view
 * use the same core functions, a number computed here and a number computed in
 * the browser come from identical logic.
 *
 * Note what it deliberately does *not* do: it never recomputes durations. It
 * reads the values the model already derived from the event log. Re-deriving here
 * would create a second implementation of the same rule and a chance for the two
 * to disagree.
 */

/** @param {any} value @returns {number|null} */
function msOrNull(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {any} document a `FocusSession`, lean or hydrated
 * @param {Map<string, {name: string, color: string, icon?: string}>} [subjects]
 * @returns {any} a `SessionRecord`
 */
export function toSessionRecord(document, subjects = new Map()) {
  const subjectId = document.subject ? String(document.subject) : null;
  const subject = subjectId ? subjects.get(subjectId) : null;
  /** @type {Map<string, number>} */
  const kindMap = document.distractionKinds instanceof Map ? document.distractionKinds : new Map(Object.entries(document.distractionKinds ?? {}));

  return {
    id: String(document._id),
    clientId: document.clientId ?? null,
    subjectId,
    subjectName: subject?.name ?? null,
    subjectColor: subject?.color ?? null,
    subjectIcon: subject?.icon ?? null,
    taskId: document.task ? String(document.task) : null,
    taskTitle: document.taskTitleSnapshot ?? null,
    startTimeMs: msOrNull(document.startTime),
    endTimeMs: msOrNull(document.endTime),
    focusedSeconds: document.focusedSeconds ?? 0,
    breakSeconds: document.breakSeconds ?? 0,
    pausedSeconds: document.pausedSeconds ?? 0,
    idleSeconds: document.idleSeconds ?? 0,
    plannedSeconds: document.plannedDuration ?? 0,
    wallSeconds: document.wallSeconds ?? 0,
    focusScore: document.focusScore ?? null,
    focusScoreBreakdown: document.focusScoreBreakdown ?? null,
    status: document.status,
    kind: document.kind ?? 'focus',
    pauseCount: document.pauseCount ?? 0,
    breakCount: document.breakCount ?? 0,
    distractionCount: document.distractionCount ?? 0,
    distractionKinds: Object.fromEntries(kindMap),
    // `to` is null for a still-open segment; the core treats that as "up to now".
    segments: (document.segments ?? []).map((segment) => ({
      kind: segment.kind,
      from: msOrNull(segment.from) ?? 0,
      to: msOrNull(segment.to),
    })),
    device: document.device ?? null,
    timeZone: document.timeZone ?? 'UTC',
    dayKey: document.dayKey ?? null,
    reflection: document.reflection ?? null,
    interruptedReason: document.interruptedReason ?? null,
    createdAt: msOrNull(document.createdAt),
    updatedAt: msOrNull(document.updatedAt),
  };
}

/**
 * Slim projection used by analytics. The event log is deliberately excluded: it
 * is the largest part of a session document and analytics never needs it, because
 * the derived durations and segments are already stored.
 */
export const SESSION_ANALYTICS_PROJECTION = [
  'clientId',
  'subject',
  'task',
  'kind',
  'status',
  'startTime',
  'endTime',
  'segments',
  'focusedSeconds',
  'breakSeconds',
  'pausedSeconds',
  'idleSeconds',
  'plannedDuration',
  'wallSeconds',
  'focusScore',
  'focusScoreBreakdown',
  'pauseCount',
  'breakCount',
  'distractionCount',
  'distractionKinds',
  'device',
  'timeZone',
  'dayKey',
  'interruptedReason',
  'taskTitleSnapshot',
  'createdAt',
  'updatedAt',
].join(' ');

/**
 * The full public representation of a session, with ISO timestamps.
 *
 * The client receives instants as ISO-8601 UTC and is responsible for rendering
 * them in the user's zone. Sending pre-formatted local strings would make the
 * payload unusable for computation and would freeze a timezone into the response.
 *
 * @param {any} document
 * @param {{includeEvents?: boolean, includeBreakdown?: boolean}} [options]
 */
export function toPublicSession(document, options = {}) {
  const raw = document.toObject ? document.toObject() : document;

  /** @type {Record<string, number>} */
  const kindMap = raw.distractionKinds instanceof Map ? Object.fromEntries(raw.distractionKinds) : raw.distractionKinds ?? {};

  return {
    id: String(raw._id),
    clientId: raw.clientId,
    subjectId: raw.subject ? String(raw.subject) : null,
    taskId: raw.task ? String(raw.task) : null,
    taskTitle: raw.taskTitleSnapshot ?? null,
    kind: raw.kind,
    status: raw.status,
    startTime: raw.startTime ? new Date(raw.startTime).toISOString() : null,
    endTime: raw.endTime ? new Date(raw.endTime).toISOString() : null,
    plannedDuration: raw.plannedDuration ?? 0,
    focusedSeconds: raw.focusedSeconds ?? 0,
    breakSeconds: raw.breakSeconds ?? 0,
    pausedSeconds: raw.pausedSeconds ?? 0,
    idleSeconds: raw.idleSeconds ?? 0,
    wallSeconds: raw.wallSeconds ?? 0,
    focusScore: raw.focusScore ?? null,
    ...(options.includeBreakdown === false ? {} : { focusScoreBreakdown: raw.focusScoreBreakdown ?? null }),
    pauseCount: raw.pauseCount ?? 0,
    breakCount: raw.breakCount ?? 0,
    distractionCount: raw.distractionCount ?? 0,
    distractionKinds: kindMap,
    distractions: (raw.distractions ?? []).map((item) => ({
      kind: item.kind,
      at: new Date(item.at).toISOString(),
    })),
    segments: (raw.segments ?? []).map((segment) => ({
      kind: segment.kind,
      from: new Date(segment.from).toISOString(),
      to: segment.to ? new Date(segment.to).toISOString() : null,
    })),
    timeZone: raw.timeZone,
    dayKey: raw.dayKey,
    device: raw.device,
    lastHeartbeatAt: raw.lastHeartbeatAt ? new Date(raw.lastHeartbeatAt).toISOString() : null,
    interruptedReason: raw.interruptedReason ?? null,
    reflection: raw.reflection ?? null,
    ...(options.includeEvents ? { events: (raw.events ?? []).map((event) => ({ type: event.type, at: new Date(event.at).toISOString(), kind: event.kind ?? null })) } : {}),
    createdAt: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : null,
  };
}
