/**
 * View-level data fetching.
 *
 * Analytics live *outside* the global store on purpose. The store holds the
 * slow-moving things (who am I, my subjects, my tasks); a period summary changes
 * whenever the user scrubs to another week and is thrown away when they leave the
 * screen. Putting it in the store would mean keeping six mutually exclusive
 * payloads alive at once.
 *
 * Every hook returns `{ data, loading, error, reload }` and — importantly — keeps
 * the previous `data` while a new request is in flight. Refetching a chart should
 * not blank it out and re-animate; that reads as a bug to the user.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type ApiError } from '../lib/api';
import { useApp } from '../store/app';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** True while a refresh is in flight and stale data is still on screen. */
  refreshing: boolean;
  reload: () => void;
}

export interface QueryOptions {
  /** Skip the request entirely (e.g. a subject filter with no subjects yet). */
  enabled?: boolean;
  /** Refresh when the tab regains focus. Used by live-ish screens only. */
  refreshOnFocus?: boolean;
  /** Bump to force a refetch — wired to the store's sync generation. */
  deps?: unknown[];
}

/**
 * Fetch on mount and whenever `key` changes.
 *
 * The request is guarded against out-of-order responses: if the user scrubs from
 * week 1 to week 3 quickly, week 1's response arriving late must not overwrite
 * week 3. That is the single most common bug in chart-heavy interfaces.
 */
export function useQuery<T>(
  key: string,
  fetcher: () => Promise<{ ok: true; data: T } | { ok: false; error: ApiError }>,
  options: QueryOptions = {},
): QueryState<T> {
  const { enabled = true, refreshOnFocus = false, deps = [] } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  const requestRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (!enabled) return;
    const requestId = ++requestRef.current;

    setError(null);
    setLoading((previous) => previous || true);
    setRefreshing(true);

    const result = await fetcherRef.current();
    if (requestId !== requestRef.current) return; // A newer request has superseded us.

    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
    setRefreshing(false);
  }, [enabled]);

  useEffect(() => {
    void run();
    // `key` is the identity of the request; the deps array lets a caller add
    // invalidation triggers (a completed session, a settings change) without
    // changing the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run, nonce, ...deps]);

  useEffect(() => {
    if (!refreshOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') void run();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshOnFocus, run]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, loading, error, refreshing, reload };
}

/**
 * A generation counter that increments whenever the user's own data changes.
 *
 * Views pass it into `useQuery`'s `deps` so finishing a session refreshes the
 * charts that are currently open, without any cross-component wiring.
 */
export function useDataGeneration(): number {
  return useApp((state) => state.lastSyncedAt ?? 0);
}

export function usePeriodAnalytics(query: {
  period: 'week' | 'month' | 'year';
  anchor?: string;
  subjectId?: string;
}) {
  const generation = useDataGeneration();
  const key = `analytics:${query.period}:${query.anchor ?? 'now'}:${query.subjectId ?? 'all'}:${generation}`;
  return useQuery(key, () => api.analytics.period({ ...query }), { deps: [generation] });
}

export function useHeatmap(days: number, subjectId?: string) {
  const generation = useDataGeneration();
  const key = `heatmap:${days}:${subjectId ?? 'all'}:${generation}`;
  return useQuery(key, () => api.analytics.heatmap(days, subjectId), { deps: [generation] });
}

export function useCalendar(month: string | undefined, subjectId?: string) {
  const generation = useDataGeneration();
  const key = `calendar:${month ?? 'current'}:${subjectId ?? 'all'}:${generation}`;
  return useQuery(key, () => api.analytics.calendar(month, subjectId), { deps: [generation] });
}

export function useDayDetail(day: string | undefined) {
  const generation = useDataGeneration();
  const key = `day:${day ?? 'today'}:${generation}`;
  return useQuery(key, () => api.analytics.day(day), { enabled: true, deps: [generation] });
}

export function useDailyReview(day: string | undefined) {
  const generation = useDataGeneration();
  const key = `review:daily:${day ?? 'today'}:${generation}`;
  return useQuery(key, () => api.analytics.dailyReview(day), { deps: [generation] });
}

export function useWeeklyReview() {
  const generation = useDataGeneration();
  return useQuery(`review:weekly:${generation}`, () => api.analytics.weeklyReview(), { deps: [generation] });
}

export function useAchievements() {
  const generation = useDataGeneration();
  return useQuery(`achievements:${generation}`, () => api.analytics.achievements(), { deps: [generation] });
}

export function useFocusScoreMeta() {
  // The formula is static for a given deployment, so it is fetched once and never
  // invalidated — a cached explanation of the score is better than a spinner.
  return useQuery('meta:focus-score', () => api.meta.focusScore());
}

export function useAchievementCatalog() {
  return useQuery('meta:achievements', () => api.meta.achievements());
}

export function usePrivacyStatement() {
  return useQuery('meta:privacy', () => api.meta.privacy());
}

export function useCapabilities() {
  return useQuery('meta:capabilities', () => api.meta.capabilities());
}
