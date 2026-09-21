/**
 * Application store.
 *
 * State is separated by *lifetime*, which is what keeps it from becoming a tangle:
 *
 *   - **session** — who is signed in and their settings. Changes rarely.
 *   - **data** — subjects, tasks, goals, overview, achievements. Refreshed from
 *     the server; the store never invents values the server owns.
 *   - **ui** — toasts, palette, focus mode, open panels. Never persisted, never
 *     synced, safe to lose on reload.
 *
 * The timer deliberately is *not* here (see `store/timer.ts`). Its state changes
 * once per second and must never be re-created by a store reset, so it lives in a
 * module-level engine that React subscribes to.
 */

import { create } from 'zustand';

import { ApiError, api, request, setAccessToken, setUnauthenticatedHandler } from '../lib/api';
import type {
  AchievementDto,
  AchievementsDto,
  GoalDto,
  GoalStatusDto,
  OverviewDto,
  SettingsDto,
  SubjectDto,
  TaskDto,
  UserDto,
} from '../lib/api';
import { cacheGet, cacheSet, clearUserData, isPersistenceAvailable } from '../lib/db';
import { applyAccent, applyMotion, applyTheme } from '../lib/theme';

export type AuthStatus = 'booting' | 'signed-out' | 'signed-in';

/**
 * The result of a store mutation.
 *
 * A discriminated union rather than `{ ok: boolean; error?: ApiError }`, because
 * the latter forces every call site to use optional chaining and silently turns a
 * missing error into `undefined.message`. With the union, checking `ok` gives the
 * caller a guaranteed `ApiError`, so the failure copy is always populated.
 */
export type ActionResult = { ok: true } | { ok: false; error: ApiError };

export interface Toast {
  id: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  /** Optional inline action, e.g. "Undo". */
  action?: { label: string; run: () => void };
  createdAt: number;
}

export type PanelId = 'none' | 'tasks' | 'insights' | 'session' | 'distractions';

interface AppState {
  // ------------------------------------------------------------------ session
  status: AuthStatus;
  user: UserDto | null;
  settings: SettingsDto | null;
  /** True when the last successful load came from the offline cache. */
  stale: boolean;
  lastSyncedAt: number | null;
  bootError: string | null;

  // --------------------------------------------------------------------- data
  overview: OverviewDto | null;
  subjects: SubjectDto[];
  tasks: TaskDto[];
  goals: GoalDto[];
  goalStatus: GoalStatusDto | null;
  achievements: AchievementsDto | null;
  loading: { overview: boolean; subjects: boolean; tasks: boolean; goals: boolean; achievements: boolean };

  // ----------------------------------------------------------------------- ui
  toasts: Toast[];
  paletteOpen: boolean;
  focusMode: boolean;
  /** The `?` reference sheet. Separate from `panel` because it is a modal, not a rail. */
  shortcutsOpen: boolean;
  panel: PanelId;
  online: boolean;
  pendingSync: number;

  // ------------------------------------------------------------------ actions
  bootstrap: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<ActionResult>;
  signUp: (input: { email: string; password: string; name: string; timeZone?: string }) => Promise<ActionResult>;
  signOut: () => Promise<void>;
  completeOnboarding: (input: {
    subjectNames: string[];
    dailyGoalSeconds: number;
    successThresholdSeconds?: number;
    timeZone?: string;
  }) => Promise<ActionResult>;

  loadOverview: (options?: { quiet?: boolean }) => Promise<void>;
  loadSubjects: () => Promise<void>;
  loadTasks: (query?: Record<string, string | number>) => Promise<void>;
  loadGoals: () => Promise<void>;
  loadAchievements: () => Promise<void>;
  refreshAll: () => Promise<void>;

  createSubject: (input: Partial<SubjectDto>) => Promise<ActionResult>;
  updateSubject: (id: string, patch: Partial<SubjectDto>) => Promise<ActionResult>;
  archiveSubject: (id: string, archived: boolean) => Promise<ActionResult>;
  deleteSubject: (id: string, options?: { reassignTo?: string; confirm?: string }) => Promise<ActionResult>;

  createTask: (input: Record<string, unknown>) => Promise<ActionResult>;
  updateTask: (id: string, patch: Record<string, unknown>) => Promise<ActionResult>;
  deleteTask: (id: string) => Promise<ActionResult>;

  saveGoal: (input: Record<string, unknown>) => Promise<ActionResult>;
  deleteGoal: (id: string) => Promise<ActionResult>;

  updateSettings: (patch: Record<string, unknown>) => Promise<ActionResult>;
  markAchievementsSeen: () => Promise<void>;

  toast: (toast: Omit<Toast, 'id' | 'createdAt'>) => void;
  dismissToast: (id: string) => void;
  setPaletteOpen: (open: boolean) => void;
  setFocusMode: (on: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setPanel: (panel: PanelId) => void;
  setOnline: (online: boolean) => void;
  setPendingSync: (count: number) => void;
}

let toastSeq = 0;

const emptyLoading = { overview: false, subjects: false, tasks: false, goals: false, achievements: false };

export const useApp = create<AppState>((set, get) => ({
  status: 'booting',
  user: null,
  settings: null,
  stale: false,
  lastSyncedAt: null,
  bootError: null,

  overview: null,
  subjects: [],
  tasks: [],
  goals: [],
  goalStatus: null,
  achievements: null,
  loading: { ...emptyLoading },

  toasts: [],
  paletteOpen: false,
  focusMode: false,
  shortcutsOpen: false,
  panel: 'none',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pendingSync: 0,

  // ---------------------------------------------------------------- bootstrap

  /**
   * Resolve the session on load.
   *
   * The access token is not persisted, so the first thing that happens on every
   * page load is one silent refresh against the httpOnly cookie. A failure here
   * is the *normal* signed-out path, not an error.
   */
  bootstrap: async () => {
    set({ bootError: null });

    const refreshed = await api.auth.refresh();
    if (!refreshed.ok) {
      set({ status: 'signed-out', user: null, settings: null });
      return;
    }

    setAccessToken(refreshed.data.accessToken);

    const me = await api.auth.me();
    if (!me.ok) {
      if (me.error.isOffline && refreshed.data.user) {
        // Offline but we know who they are: let them in and label the UI stale.
        set({ status: 'signed-in', user: refreshed.data.user, stale: true });
        await loadCachedData(set, refreshed.data.user.id);
        return;
      }
      set({ status: 'signed-out' });
      return;
    }

    set({ status: 'signed-in', user: me.data.user, settings: me.data.settings, stale: false });
    applyPreferences(me.data.settings);
    const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
    if (me.data.settings.timeZone === 'UTC' && detectedTz && detectedTz !== 'UTC') {
      void get().updateSettings({ timeZone: detectedTz });
    }
    await get().refreshAll();
  },

  signIn: async (email, password) => {
    const result = await api.auth.login({ email, password });
    if (!result.ok) return { ok: false, error: result.error };

    setAccessToken(result.data.accessToken);
    const me = await api.auth.me();
    if (!me.ok) return { ok: false, error: me.error };

    set({ status: 'signed-in', user: me.data.user, settings: me.data.settings, stale: false });
    applyPreferences(me.data.settings);
    const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
    if (me.data.settings.timeZone === 'UTC' && detectedTz && detectedTz !== 'UTC') {
      void get().updateSettings({ timeZone: detectedTz });
    }
    await get().refreshAll();
    return { ok: true };
  },

  signUp: async (input) => {
    const result = await api.auth.register(input);
    if (!result.ok) return { ok: false, error: result.error };

    setAccessToken(result.data.accessToken);
    const me = await api.auth.me();
    if (!me.ok) return { ok: false, error: me.error };

    set({ status: 'signed-in', user: me.data.user, settings: me.data.settings, stale: false });
    applyPreferences(me.data.settings);
    const detectedTz = input.timeZone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : null);
    if (me.data.settings.timeZone === 'UTC' && detectedTz && detectedTz !== 'UTC') {
      void get().updateSettings({ timeZone: detectedTz });
    }
    return { ok: true };
  },

  signOut: async () => {
    const userId = get().user?.id;
    await api.auth.logout();
    setAccessToken(null);
    if (userId) await clearUserData(userId).catch(() => {});
    set({
      status: 'signed-out',
      user: null,
      settings: null,
      overview: null,
      subjects: [],
      tasks: [],
      goals: [],
      achievements: null,
      goalStatus: null,
      panel: 'none',
      focusMode: false,
    });
  },

  completeOnboarding: async (input) => {
    const result = await api.auth.onboarding(input);
    if (!result.ok) return { ok: false, error: result.error };

    set({
      settings: result.data.settings,
      subjects: result.data.subjects,
      user: get().user ? { ...get().user!, onboarded: true } : null,
    });
    applyPreferences(result.data.settings);
    await get().refreshAll();
    return { ok: true };
  },

  // --------------------------------------------------------------------- loads

  loadOverview: async (options = {}) => {
    set((state) => ({ loading: { ...state.loading, overview: options.quiet ? state.loading.overview : true } }));
    const result = await api.overview();

    if (result.ok) {
      set({ overview: result.data, stale: false, lastSyncedAt: Date.now() });
      const userId = get().user?.id;
      if (userId && isPersistenceAvailable()) await cacheSet(userId, 'overview', result.data).catch(() => {});
    } else if (result.error.isOffline) {
      // Keep whatever is on screen; the caching below already ran on load.
      set({ stale: true });
    }

    set((state) => ({ loading: { ...state.loading, overview: false } }));
  },

  loadSubjects: async () => {
    set((state) => ({ loading: { ...state.loading, subjects: true } }));
    const result = await api.subjects.list(true);
    if (result.ok) {
      set({ subjects: result.data.subjects });
      const userId = get().user?.id;
      if (userId) await cacheSet(userId, 'subjects', result.data.subjects).catch(() => {});
    }
    set((state) => ({ loading: { ...state.loading, subjects: false } }));
  },

  loadTasks: async (query = {}) => {
    set((state) => ({ loading: { ...state.loading, tasks: true } }));
    const result = await api.tasks.list({ limit: 200, ...query });
    if (result.ok) {
      set({ tasks: result.data.tasks });
      const userId = get().user?.id;
      if (userId) await cacheSet(userId, 'tasks', result.data.tasks).catch(() => {});
    }
    set((state) => ({ loading: { ...state.loading, tasks: false } }));
  },

  loadGoals: async () => {
    set((state) => ({ loading: { ...state.loading, goals: true } }));
    const result = await api.goals.list();
    if (result.ok) {
      set({ goals: result.data.goals, goalStatus: result.data.status });
      const userId = get().user?.id;
      if (userId) await cacheSet(userId, 'goals', result.data.goals).catch(() => {});
    }
    set((state) => ({ loading: { ...state.loading, goals: false } }));
  },

  loadAchievements: async () => {
    set((state) => ({ loading: { ...state.loading, achievements: true } }));
    const result = await api.analytics.achievements();
    if (result.ok) set({ achievements: result.data });
    set((state) => ({ loading: { ...state.loading, achievements: false } }));
  },

  refreshAll: async () => {
    await Promise.all([
      get().loadOverview({ quiet: true }),
      get().loadSubjects(),
      get().loadTasks(),
      get().loadGoals(),
    ]);
  },

  // ------------------------------------------------------------------ subjects

  createSubject: async (input) => {
    const result = await api.subjects.create(input as Record<string, unknown>);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ subjects: [...state.subjects, result.data.subject] }));
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  updateSubject: async (id, patch) => {
    const result = await api.subjects.update(id, patch as Record<string, unknown>);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ subjects: state.subjects.map((subject) => (subject._id === id ? result.data.subject : subject)) }));
    return { ok: true };
  },

  archiveSubject: async (id, archived) => {
    const result = await api.subjects.archive(id, archived);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ subjects: state.subjects.map((subject) => (subject._id === id ? result.data.subject : subject)) }));
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  deleteSubject: async (id, options = {}) => {
    const result = await api.subjects.remove(id, options);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ subjects: state.subjects.filter((subject) => subject._id !== id) }));
    void get().refreshAll();
    return { ok: true };
  },

  // --------------------------------------------------------------------- tasks

  createTask: async (input) => {
    const result = await api.tasks.create(input);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ tasks: [...state.tasks, result.data.task] }));
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  updateTask: async (id, patch) => {
    const result = await api.tasks.update(id, patch);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ tasks: state.tasks.map((task) => (task._id === id ? result.data.task : task)) }));
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  deleteTask: async (id) => {
    const result = await api.tasks.remove(id);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ tasks: state.tasks.filter((task) => task._id !== id) }));
    return { ok: true };
  },

  // --------------------------------------------------------------------- goals

  saveGoal: async (input) => {
    const existing = get().goals.find(
      (goal) => goal.period === input.period && (goal.subjectId ?? null) === (input.subjectId ?? null),
    );
    const result = existing ? await api.goals.update(existing.id, input) : await api.goals.create(input);
    if (!result.ok) return { ok: false, error: result.error };
    await get().loadGoals();
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  deleteGoal: async (id) => {
    const result = await api.goals.remove(id);
    if (!result.ok) return { ok: false, error: result.error };
    set((state) => ({ goals: state.goals.filter((goal) => goal.id !== id) }));
    void get().loadOverview({ quiet: true });
    return { ok: true };
  },

  // ------------------------------------------------------------------ settings

  updateSettings: async (patch) => {
    const result = await api.settings.update(patch);
    if (!result.ok) return { ok: false, error: result.error };
    set({ settings: result.data.settings });
    applyPreferences(result.data.settings);
    // A timezone or goal change re-buckets everything the cockpit shows.
    if (patch.timeZone || patch.dailyGoalSeconds || patch.successThresholdSeconds || patch.weekStart !== undefined) {
      void get().refreshAll();
    }
    return { ok: true };
  },

  markAchievementsSeen: async () => {
    const current = get().achievements;
    if (!current || current.unseenCount === 0) return;
    await api.analytics.markAchievementsSeen();
    set({ achievements: { ...current, unseenCount: 0, freshlyUnlocked: [] } });
  },

  // ----------------------------------------------------------------------- ui

  toast: (toast) => {
    toastSeq += 1;
    const entry: Toast = { ...toast, id: `toast-${toastSeq}`, createdAt: Date.now() };
    set((state) => ({ toasts: [...state.toasts.slice(-3), entry] }));
    // Errors persist until dismissed; everything else is transient.
    const ttl = toast.tone === 'error' ? 9000 : 4500;
    setTimeout(() => get().dismissToast(entry.id), ttl);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setPanel: (panel) => set((state) => ({ panel: state.panel === panel ? 'none' : panel })),
  setOnline: (online) => set({ online }),
  setPendingSync: (pendingSync) => set({ pendingSync }),
}));

/**
 * Apply the saved preferences to the document.
 *
 * Called on every settings load so a change made on one device is reflected the
 * moment the other device syncs, without a reload.
 */
export function applyPreferences(settings: SettingsDto): void {
  applyTheme(settings.theme === 'light' ? 'light' : 'dark');
  applyAccent(settings.accent);
  applyMotion(settings.reduceMotion);
}

/** Load the offline cache into the store so a cold start with no network renders. */
async function loadCachedData(set: (partial: Partial<AppState>) => void, userId: string): Promise<void> {
  const [overview, subjects, tasks, goals] = await Promise.all([
    cacheGet<OverviewDto>(userId, 'overview'),
    cacheGet<SubjectDto[]>(userId, 'subjects'),
    cacheGet<TaskDto[]>(userId, 'tasks'),
    cacheGet<GoalDto[]>(userId, 'goals'),
  ]);

  set({
    overview: overview?.value ?? null,
    subjects: subjects?.value ?? [],
    tasks: tasks?.value ?? [],
    goals: goals?.value ?? [],
    lastSyncedAt: overview?.storedAt ?? null,
  });
}

/** Redirect to sign-in when a refresh definitively fails mid-session. */
setUnauthenticatedHandler(() => {
  const state = useApp.getState();
  if (state.status === 'signed-in') {
    state.toast({ tone: 'warning', title: 'Your session ended', detail: 'Please sign in again to keep syncing.' });
  }
  useApp.setState({ status: 'signed-out' });
});

/** Exported for the rare call site that needs a raw request outside the store. */
export { request };

let lastSubjects: SubjectDto[] | undefined;
let cachedActiveSubjects: SubjectDto[] = [];

/** Convenience selectors, so components do not reach into the shape by hand. Cached against source array identity so getSnapshot satisfies React 18 useSyncExternalStore. */
export const selectActiveSubjects = (state: AppState): SubjectDto[] => {
  if (state.subjects === lastSubjects) {
    return cachedActiveSubjects;
  }
  lastSubjects = state.subjects;
  cachedActiveSubjects = state.subjects
    .filter((subject) => !subject.archivedAt)
    .sort((a, b) => a.order - b.order);
  return cachedActiveSubjects;
};

export const selectSubjectById = (id: string | null) => (state: AppState): SubjectDto | null =>
  (id && state.subjects.find((subject) => subject._id === id)) || null;

let lastTasks: TaskDto[] | undefined;
let cachedOpenTasks: TaskDto[] = [];

export const selectOpenTasks = (state: AppState): TaskDto[] => {
  if (state.tasks === lastTasks) {
    return cachedOpenTasks;
  }
  lastTasks = state.tasks;
  cachedOpenTasks = state.tasks.filter((task) => task.status === 'todo' || task.status === 'in-progress');
  return cachedOpenTasks;
};

export const selectNextAchievement = (state: AppState): AchievementDto | null => state.achievements?.inProgress[0] ?? null;
