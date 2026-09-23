/**
 * API client.
 *
 * Design decisions that matter:
 *
 *   **The access token lives in memory only** — a module-scoped variable, never
 *   localStorage. An XSS payload cannot lift a credential that is not persisted,
 *   and a page reload simply triggers one silent refresh. The refresh token is an
 *   httpOnly cookie the page's JavaScript cannot read at all.
 *
 *   **Refreshes are single-flight.** When several requests 401 at once (which
 *   happens on every page load after the access token expires), they all await
 *   one refresh rather than stampeding the endpoint and tripping the rate limiter.
 *
 *   **Network failure is a first-class outcome, not an exception to swallow.**
 *   `ApiResult` distinguishes "the server said no" from "the server could not be
 *   reached", because the offline queue needs to treat those completely
 *   differently: the first must be surfaced to the user, the second queued.
 */

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '')}/api`
  : '/api';

/** Module-scoped, intentionally not persisted. */
let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export type ApiErrorKind = 'network' | 'timeout' | 'offline' | 'http' | 'parse' | 'auth';

export interface ApiErrorShape {
  kind: ApiErrorKind;
  status: number;
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
  /** Present when a field-level validation error occurred. */
  fields?: Record<string, string>;
}

export class ApiError extends Error implements ApiErrorShape {
  kind: ApiErrorKind;
  status: number;
  code: string;
  details?: unknown;
  retryable: boolean;
  fields?: Record<string, string>;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = 'ApiError';
    this.kind = shape.kind;
    this.status = shape.status;
    this.code = shape.code;
    this.details = shape.details;
    this.retryable = shape.retryable;
    this.fields = shape.fields;
  }

  /** True when the request never reached the server, so queueing is safe. */
  get isOffline(): boolean {
    return this.kind === 'offline' || this.kind === 'network' || this.kind === 'timeout';
  }
}

export type ApiResult<T> = { ok: true; data: T; meta?: Record<string, unknown> } | { ok: false; error: ApiError };

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when refreshing definitively fails, so the app can route to sign-in. */
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the refresh-and-retry cycle (used by the refresh call itself). */
  skipRefresh?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Progress-free requests that should not surface a global error toast. */
  quiet?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Timeout wrapper.
 *
 * Fetch has no timeout of its own, and a hung request on a flaky mobile
 * connection would otherwise leave a spinner forever. The abort is reported as a
 * retryable timeout rather than as a generic failure, so the UI can say something
 * useful.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, external?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);

  const forward = () => controller.abort(external?.reason);
  external?.addEventListener('abort', forward, { once: true });

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', forward);
  }
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/auth/refresh`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } },
        12_000,
      );
      if (!response.ok) return false;
      const payload = (await response.json()) as { data?: { accessToken?: string } };
      if (!payload.data?.accessToken) return false;
      accessToken = payload.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next macrotask so concurrent callers all observe the
      // resolved value instead of starting a second refresh.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

function buildError(response: Response, payload: unknown): ApiError {
  const error = (payload as { error?: { code?: string; message?: string; details?: unknown; retryable?: boolean } })?.error;

  const fields: Record<string, string> = {};
  if (Array.isArray(error?.details)) {
    for (const detail of error.details as Array<{ field?: string; message?: string }>) {
      if (detail?.field && detail?.message) {
        // Route-level prefixes like `body.email` are noise in a form.
        fields[detail.field.replace(/^(body|query|params)\./, '')] = detail.message;
      }
    }
  }

  return new ApiError({
    kind: response.status === 401 ? 'auth' : 'http',
    status: response.status,
    code: error?.code ?? `HTTP_${response.status}`,
    message: error?.message ?? defaultMessageForStatus(response.status),
    details: error?.details,
    retryable: error?.retryable ?? response.status >= 500,
    fields: Object.keys(fields).length > 0 ? fields : undefined,
  });
}

function defaultMessageForStatus(status: number): string {
  if (status === 401) return 'You need to sign in to do that.';
  if (status === 403) return 'You do not have access to that.';
  if (status === 404) return 'That could not be found.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  if (status >= 500) return 'The server had a problem. Nothing you did caused it.';
  return 'That request could not be completed.';
}

/**
 * Perform a request and always resolve with a discriminated result.
 *
 * Nothing in the app throws for control flow: a caller must explicitly handle
 * `ok === false`, which is what stops "the network is down" from being silently
 * treated as "the list is empty".
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, skipRefresh = false, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  // Distinguish "the browser knows it is offline" from "the request failed",
  // so the UI can say which one it is.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      ok: false,
      error: new ApiError({
        kind: 'offline',
        status: 0,
        code: 'OFFLINE',
        message: 'You are offline. This will sync when the connection returns.',
        retryable: true,
      }),
    };
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(
      `${BASE_URL}${path}`,
      {
        method,
        headers,
        credentials: 'include',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      timeoutMs,
      signal,
    );
  } catch (error) {
    const aborted = (error as { name?: string })?.name === 'AbortError';
    const timedOut = (error as { name?: string })?.name === 'TimeoutError';
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;

    return {
      ok: false,
      error: new ApiError({
        kind: aborted ? 'network' : timedOut ? 'timeout' : offline ? 'offline' : 'network',
        status: 0,
        code: aborted ? 'ABORTED' : timedOut ? 'TIMEOUT' : offline ? 'OFFLINE' : 'NETWORK_ERROR',
        message: aborted
          ? 'Request cancelled.'
          : timedOut
            ? 'The server took too long to respond. Your timer is unaffected.'
            : offline
              ? 'You are offline. This will sync when the connection returns.'
              : 'Could not reach the server. Check your connection — your timer keeps running.',
        retryable: true,
      }),
    };
  }

  // 204 has no body; treat it as a successful empty payload.
  if (response.status === 204) return { ok: true, data: undefined as T };

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (response.ok) {
        return {
          ok: false,
          error: new ApiError({
            kind: 'parse',
            status: response.status,
            code: 'PARSE_ERROR',
            message: 'The server sent something unexpected.',
            retryable: true,
          }),
        };
      }
    }
  }

  if (response.ok) {
    const data = (payload as { data?: T })?.data ?? (undefined as T);
    const meta = (payload as { meta?: Record<string, unknown> })?.meta;
    return { ok: true, data, ...(meta ? { meta } : {}) };
  }

  // One silent refresh-and-retry on expiry. `skipRefresh` prevents recursion
  // when the refresh call itself is the thing that 401ed.
  if (response.status === 401 && !skipRefresh && (await refreshAccessToken())) {
    return request<T>(path, { ...options, skipRefresh: true });
  }

  if (response.status === 401) onUnauthenticated?.();

  return { ok: false, error: buildError(response, payload) };
}

/**
 * Unwrap a result, throwing on failure. For call sites where a failure genuinely
 * is exceptional (inside a mutation the user explicitly triggered) and the global
 * error toast is the right place for it.
 */
export async function requestOrThrow<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const result = await request<T>(path, options);
  if (!result.ok) throw result.error;
  return result.data;
}

/** Builds a clean query string, stripping undefined, null, empty strings, and spurious 'undefined' literals. */
function toQueryString(params?: Record<string, unknown>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'undefined' && value !== 'null') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** Typed endpoint helpers, so paths and payload shapes live in one place. */
export const api = {
  auth: {
    register: (body: { email: string; password: string; name: string; timeZone?: string }) =>
      request<AuthPayload>('/auth/register', { method: 'POST', body }),
    login: (body: { email: string; password: string }) => request<AuthPayload>('/auth/login', { method: 'POST', body }),
    refresh: () => request<AuthPayload>('/auth/refresh', { method: 'POST', skipRefresh: true }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    logoutAll: () => request<{ signedOut: boolean }>('/auth/logout-all', { method: 'POST' }),
    me: () => request<{ user: UserDto; settings: SettingsDto }>('/auth/me'),
    updateProfile: (body: { name?: string; timeZone?: string }) => request<{ user: UserDto; settings: SettingsDto }>('/auth/me', { method: 'PATCH', body }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      request<{ changed: boolean }>('/auth/change-password', { method: 'POST', body }),
    deleteAccount: (body: { password: string; confirm: 'DELETE' }) =>
      request<{ deleted: boolean }>('/auth/delete-account', { method: 'POST', body }),
    onboarding: (body: { subjectNames: string[]; dailyGoalSeconds: number; successThresholdSeconds?: number; weekStart?: number; timeZone?: string }) =>
      request<{ subjects: SubjectDto[]; settings: SettingsDto; onboarded: boolean }>('/auth/onboarding', { method: 'POST', body }),
    onboardingOptions: () => request<{ options: Array<{ name: string; icon: string; color: string }> }>('/auth/onboarding/options'),
  },

  overview: () => request<OverviewDto>('/analytics/stats/overview'),

  sessions: {
    start: (body: Record<string, unknown>) => request<{ session: SessionDto; created: boolean; adopted: boolean; idempotent: boolean }>('/sessions', { method: 'POST', body }),
    current: () => request<{ openSession: SessionDto | null; openRecord: SessionRecordDto | null; reconciled: SessionDto | null; serverTime: string; idleGapMs: number; heartbeatIntervalMs: number }>('/sessions/current'),
    get: (id: string) => request<{ session: SessionDto; record: SessionRecordDto }>(`/sessions/${id}`),
    list: (query: Record<string, unknown> = {}) => request<{ sessions: SessionDto[] }>(`/sessions${toQueryString(query)}`),
    events: (id: string, events: Array<{ type: string; at: string; kind?: string | null }>) =>
      request<{ session: SessionDto; added: number; ignored: number }>(`/sessions/${id}/events`, { method: 'POST', body: { events } }),
    pause: (id: string) => request<{ session: SessionDto }>(`/sessions/${id}/pause`, { method: 'POST', body: {} }),
    resume: (id: string) => request<{ session: SessionDto }>(`/sessions/${id}/resume`, { method: 'POST', body: {} }),
    breakStart: (id: string) => request<{ session: SessionDto }>(`/sessions/${id}/break`, { method: 'POST', body: {} }),
    breakEnd: (id: string) => request<{ session: SessionDto }>(`/sessions/${id}/break/end`, { method: 'POST', body: {} }),
    heartbeat: (id: string, at?: string) => request<{ added: number }>(`/sessions/${id}/heartbeat`, { method: 'POST', body: at ? { at } : {} }),
    distraction: (id: string, kind: string) => request<{ session: SessionDto }>(`/sessions/${id}/distractions`, { method: 'POST', body: { kind } }),
    extend: (id: string, minutes: number) => request<{ session: SessionDto; addedMinutes: number }>(`/sessions/${id}/extend`, { method: 'POST', body: { minutes } }),
    complete: (id: string, body: Record<string, unknown>) =>
      request<{ session: SessionDto; closed: boolean; alreadyClosed: boolean; newlyUnlocked: string[] }>(`/sessions/${id}/complete`, { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) => request<{ session: SessionDto }>(`/sessions/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    distractionOptions: () => request<{ options: Array<{ kind: string; label: string; short: string }> }>('/sessions/distraction-options'),
  },

  subjects: {
    list: (includeArchived = false) => request<{ subjects: SubjectDto[] }>(`/subjects?includeArchived=${includeArchived}`),
    create: (body: Record<string, unknown>) => request<{ subject: SubjectDto }>('/subjects', { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) => request<{ subject: SubjectDto }>(`/subjects/${id}`, { method: 'PATCH', body }),
    archive: (id: string, archived: boolean) => request<{ subject: SubjectDto }>(`/subjects/${id}/archive`, { method: 'POST', body: { archived } }),
    remove: (id: string, query: { reassignTo?: string; confirm?: string } = {}) =>
      request<{ deleted: boolean; movedSessions: number }>(`/subjects/${id}${toQueryString(query)}`, { method: 'DELETE' }),
  },

  tasks: {
    list: (query: Record<string, unknown> = {}) => request<{ tasks: TaskDto[] }>(`/tasks${toQueryString(query)}`),
    next: (subjectId?: string) => request<{ task: TaskDto | null }>(`/tasks/next${toQueryString({ subjectId })}`),
    create: (body: Record<string, unknown>) => request<{ task: TaskDto }>('/tasks', { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) => request<{ task: TaskDto }>(`/tasks/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
  },

  goals: {
    list: () => request<{ goals: GoalDto[]; status: GoalStatusDto; periods: Record<string, unknown> }>('/goals'),
    create: (body: Record<string, unknown>) => request<{ goal: GoalDto }>('/goals', { method: 'POST', body }),
    update: (id: string, body: Record<string, unknown>) => request<{ goal: GoalDto }>(`/goals/${id}`, { method: 'PATCH', body }),
    remove: (id: string) => request<void>(`/goals/${id}`, { method: 'DELETE' }),
  },

  analytics: {
    period: (query: { period?: string; anchor?: string; reference?: string; subjectId?: string; compare?: boolean } = {}) =>
      request<AnalyticsDto>(`/analytics${toQueryString({
        period: query.period,
        reference: query.reference ?? query.anchor,
        anchor: query.anchor,
        subjectId: query.subjectId,
        compare: query.compare,
      })}`),
    heatmap: (days = 365, subjectId?: string) =>
      request<HeatmapDto>(`/analytics/heatmap${toQueryString({ days, subjectId })}`),
    calendar: (month?: string, subjectId?: string) =>
      request<CalendarDto>(`/analytics/calendar${toQueryString({ month, subjectId })}`),
    day: (day?: string) => request<DayDetailDto>(`/analytics/day${toQueryString({ day })}`),
    dailyReview: (day?: string) => request<DailyReviewDto>(`/analytics/review/daily${toQueryString({ day })}`),
    weeklyReview: (reference?: string) => request<WeeklyReviewDto>(`/analytics/review/weekly${toQueryString({ reference })}`),
    achievements: () => request<AchievementsDto>('/analytics/achievements'),
    markAchievementsSeen: (keys?: string[]) => request<{ marked: number }>('/analytics/achievements/seen', { method: 'POST', body: keys ? { keys } : {} }),
  },

  settings: {
    get: () => request<{ settings: SettingsDto }>('/settings'),
    update: (body: Record<string, unknown>) => request<{ settings: SettingsDto }>('/settings', { method: 'PATCH', body }),
  },

  meta: {
    focusScore: () => request<FocusScoreMetaDto>('/meta/focus-score'),
    achievements: () => request<{ achievements: AchievementDefinitionDto[] }>('/meta/achievements'),
    capabilities: () => request<{ capabilities: Record<string, boolean> }>('/capabilities'),
    privacy: () => request<{ statement: Array<{ key: string; title: string; stored: string[]; why: string }> }>('/privacy/data-statement'),
  },

  exportUrl: (query: { format: 'json' | 'csv'; dataset: string; from?: string; to?: string }) =>
    `${BASE_URL}/export${toQueryString(query)}`,
};

// ------------------------------------------------------------------ transport
// Shapes the server returns. Kept close to the client rather than generated, so a
// mismatched field is a compile error at the point of use.

export interface UserDto {
  id: string;
  email: string;
  name: string;
  onboarded: boolean;
  createdAt: string;
  lastActiveAt?: string;
}

export interface AuthPayload {
  user: UserDto;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshExpiresAt: string;
}

export interface SettingsDto {
  id: string;
  theme: 'dark' | 'light' | 'system';
  accent: string;
  reduceMotion: boolean;
  ambientBackground: boolean;
  timeZone: string;
  weekStart: number;
  dailyGoalSeconds: number;
  successThresholdSeconds: number;
  focusPresets: Array<{ minutes: number; label: string }>;
  breakPresets: Array<{ minutes: number; label: string }>;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  maxExtendMinutes: number;
  notifications: Record<string, boolean>;
  sound: { enabled: boolean; ambience: string; volume: number; chime: boolean };
  shortcuts: { enabled: boolean };
  defaultSubject: string | null;
  promptDailyReview: boolean;
  confirmEarlyEnd: boolean;
  updatedAt: string;
}

export interface SubjectDto {
  _id: string;
  id?: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  weeklyTargetSeconds: number;
  monthlyTargetSeconds: number;
  order: number;
  archivedAt: string | null;
}

export interface TaskDto {
  _id: string;
  subject: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  estimatedDuration: number;
  dueAt: string | null;
  status: 'todo' | 'in-progress' | 'completed' | 'skipped';
  tags: string[];
  focusedSeconds: number;
  sessionCount: number;
}

export interface GoalDto {
  id: string;
  period: 'daily' | 'weekly' | 'monthly';
  subjectId: string | null;
  targetSeconds: number;
  label: string;
  focusedSeconds: number;
  remainingSeconds: number;
  progress: number;
  paceRatio: number | null;
  expectedSeconds: number | null;
  isMet: boolean;
  isAhead: boolean;
  daysElapsed: number;
  daysTotal: number;
  projectedSeconds: number | null;
  message: string;
  periodFromKey: string;
  periodToKey: string;
}

export interface GoalStatusDto {
  anyMet: boolean;
  dailyMet: boolean;
  weeklyMet: boolean;
  monthlyMet: boolean;
}

export interface SessionSegment {
  kind: 'focus' | 'break' | 'paused' | 'idle';
  from: string;
  to: string | null;
}

export interface SessionDto {
  id: string;
  clientId: string;
  subjectId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  kind: string;
  status: 'running' | 'paused' | 'completed' | 'cancelled' | 'interrupted';
  startTime: string;
  endTime: string | null;
  plannedDuration: number;
  focusedSeconds: number;
  breakSeconds: number;
  pausedSeconds: number;
  idleSeconds: number;
  wallSeconds: number;
  focusScore: number | null;
  focusScoreBreakdown: ScoreBreakdown | null;
  pauseCount: number;
  breakCount: number;
  distractionCount: number;
  distractionKinds: Record<string, number>;
  distractions: Array<{ kind: string; at: string }>;
  segments: SessionSegment[];
  timeZone: string;
  dayKey: string;
  device: string;
  lastHeartbeatAt: string | null;
  interruptedReason: string | null;
  reflection: string | null;
  events?: Array<{ type: string; at: string; kind: string | null }>;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreBreakdown {
  summary: string;
  strongest: string | null;
  weakest: string | null;
  factors: Array<{ key: string; label: string; weight: number; value: number; points: number; maxPoints: number; note: string }>;
}

/** The session shape the shared core consumes — numbers, not ISO strings. */
export interface SessionRecordDto {
  id: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  focusedSeconds: number;
  breakSeconds: number;
  pausedSeconds: number;
  idleSeconds: number;
  plannedSeconds: number;
  wallSeconds: number;
  focusScore: number | null;
  status: string;
  pauseCount: number;
  distractionCount: number;
  distractionKinds: Record<string, number>;
  segments: Array<{ kind: string; from: number; to: number | null }>;
}

export interface OverviewDto {
  timeZone: string;
  nowKey: string;
  today: {
    dayKey: string;
    focusedSeconds: number;
    liveSeconds: number;
    breakSeconds: number;
    sessionCount: number;
    completedCount: number;
    distractionCount: number;
    goalSeconds: number;
    goalProgress: number;
    remainingSeconds: number;
    goalMet: boolean;
  };
  week: { keys: string[]; focusedSeconds: number; goalSeconds: number; series: DailyCellDto[] };
  streak: {
    daily: { current: number; longest: number; isTodayMet: boolean; thresholdSeconds: number; daysSinceLastSuccess: number | null; lastSuccessfulKey: string | null };
    weekly: { current: number; longest: number };
  };
  openSession: SessionDto | null;
  openRecord: SessionRecordDto | null;
  reconciled: SessionDto | null;
  recentSessions: SessionRecordDto[];
  subjects: Array<{ id: string; name: string; color: string; icon?: string }>;
  nextTask: { id: string; title: string; subjectId: string; priority: string; estimatedDuration: number; dueAt: string | null; status: string } | null;
  dueSoon: Array<{ id: string; title: string; subjectId: string; dueAt: string | null; priority: string }>;
  goals: GoalDto[];
  goalStatus: GoalStatusDto;
  achievements: { unlockedCount: number; totalCount: number; unseenCount: number; next: AchievementDto[] };
  generatedAt: string;
}

export interface DailyCellDto {
  dayKey: string;
  focusedSeconds: number;
  breakSeconds: number;
  sessionCount: number;
  completedCount: number;
  distractionCount: number;
  goalMet: boolean;
  intensity?: number;
}

export interface InsightDto {
  id: string;
  category: string;
  tone: 'positive' | 'neutral' | 'nudge' | 'info';
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  priority: number;
}

export interface AnalyticsDto {
  period: { kind: string; fromKey: string; toKey: string; dayKeys: string[]; label: string; from: string; to: string };
  previousPeriod: { fromKey: string; toKey: string; label: string };
  timeZone: string;
  summary: {
    focusedSeconds: number;
    breakSeconds: number;
    pausedSeconds: number;
    idleSeconds: number;
    sessionCount: number;
    completedCount: number;
    cancelledCount: number;
    interruptedCount: number;
    completionRate: number | null;
    averageSessionSeconds: number;
    longestSessionSeconds: number;
    averageDailySeconds: number;
    activeDays: number;
    averageFocusScore: number | null;
    distractions: { total: number; perHour: number; byKind: Array<{ kind: string; count: number; share: number }>; topKind: string | null };
    subjects: Array<{ subjectId: string; name: string; color: string | null; focusedSeconds: number; sessionCount: number; share: number; avgSessionSeconds: number; averageScore: number | null }>;
    dailySeries: DailyCellDto[];
    hourly: Array<{ hour: number; seconds: number; sessionStarts: number }>;
    byDayOfWeek: Array<{ weekday: number; focusedSeconds: number; sessionCount: number }>;
    bestDay: DailyCellDto | null;
    breakToFocusRatio: number | null;
    focusIndex: { consistency: number; goalPace: number | null; scoreQuality: number | null; focusIndex: number | null; daysMet: number; daysElapsed: number };
  };
  previous: AnalyticsDto['summary'] | null;
  comparison: Array<{ key: string; label: string; current: number; previous: number | null; delta: number | null; deltaRatio: number | null; format: 'duration' | 'count' | 'percent' | 'score' }>;
  goals: GoalDto[];
  goalStatus: GoalStatusDto;
  streak: { daily: OverviewDto['streak']['daily']; weekly: OverviewDto['streak']['weekly'] };
  insights: InsightDto[];
  headline: InsightDto | null;
  sessions: Array<Record<string, unknown>>;
  timeline: Array<{ sessionId: string; kind: string; from: string; to: string; seconds: number; subjectId: string | null; subjectName: string | null; subjectColor: string | null; taskTitle: string | null }>;
}

export interface HeatmapDto {
  timeZone: string;
  fromKey: string;
  toKey: string;
  days: number;
  subjectId: string | null;
  maxSeconds: number;
  totalSeconds: number;
  activeDays: number;
  peakDay: DailyCellDto | null;
  cells: Array<DailyCellDto & { intensity: number; averageFocusScore: number | null }>;
}

export interface CalendarDto {
  timeZone: string;
  month: string;
  label: string;
  fromKey: string;
  toKey: string;
  weekStart: number;
  lead: number;
  days: Array<DailyCellDto & { subjects: Array<{ subjectId: string; seconds: number }>; averageFocusScore: number | null }>;
  totalSeconds: number;
  previousMonth: string;
  nextMonth: string;
}

export interface DayDetailDto {
  dayKey: string;
  timeZone: string;
  label: string;
  focusedSeconds: number;
  breakSeconds: number;
  sessionCount: number;
  completedCount: number;
  interruptedCount: number;
  distractionCount: number;
  longestSessionSeconds: number;
  averageFocusScore: number | null;
  goalMet: boolean;
  subjects: Array<{ subjectId: string; name: string; color: string | null; focusedSeconds: number; sessionCount: number; share: number }>;
  subjectSeconds: Record<string, number>;
  distractions: { total: number; perHour: number; byKind: Array<{ kind: string; count: number; share: number }>; topKind: string | null };
  hourly: Array<{ hour: number; seconds: number; sessionStarts: number }>;
  sessions: Array<Record<string, unknown>>;
  timeline: Array<{ sessionId: string; kind: string; from: string; to: string; seconds: number; subjectId: string | null; subjectName: string | null; subjectColor: string | null; taskTitle: string | null }>;
  streak: OverviewDto['streak']['daily'];
  previousDay: string;
  nextDay: string;
}

export interface DailyReviewDto extends DayDetailDto {
  dailyGoal: GoalDto | null;
  observations: Array<{ id: string; tone: string; text: string }>;
  prompts: string[];
}

export interface WeeklyReviewDto {
  period: AnalyticsDto['period'];
  previousPeriod: AnalyticsDto['previousPeriod'];
  timeZone: string;
  comparison: AnalyticsDto['comparison'];
  observations: AnalyticsDto['comparison'];
  carryForward: InsightDto[];
  insights: InsightDto[];
  streak: AnalyticsDto['streak'];
  goals: GoalDto[];
  summary: AnalyticsDto['summary'];
  previous: AnalyticsDto['summary'] | null;
  generatedAt: string;
}

export interface AchievementDto {
  id: string;
  name: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
  metricLabel: string;
  target: number;
  unit: 'count' | 'seconds' | 'days' | 'score';
  value: number;
  progress: number;
  progressLabel: string;
  remainingLabel: string;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface AchievementsDto {
  achievements: AchievementDto[];
  unlocked: AchievementDto[];
  inProgress: AchievementDto[];
  unlockedCount: number;
  totalCount: number;
  unseenCount: number;
  freshlyUnlocked: string[];
  stats: Record<string, number>;
  streaks: { daily: OverviewDto['streak']['daily']; weekly: OverviewDto['streak']['weekly'] };
}

export interface AchievementDefinitionDto {
  id: string;
  name: string;
  description: string;
  tier: string;
  target: number;
  unit: string;
}

export interface FocusScoreMetaDto {
  weights: Record<string, number>;
  formula: string;
  factors: Record<string, string>;
  notes: string[];
  timing: { heartbeatIntervalMs: number; idleGapMs: number };
}
