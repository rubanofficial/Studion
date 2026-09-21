/**
 * The root component.
 *
 * Responsibilities, in order:
 *
 *   1. Resolve the session (one silent refresh, then `/auth/me`). Until that
 *      finishes nothing else may render — a cockpit that appears and then
 *      disappears is worse than a half-second of nothing.
 *   2. Gate on onboarding for a genuinely new account.
 *   3. Mount the shell and the routes.
 *
 * Routes are code-split. The cockpit and the shell load in the initial bundle
 * because that is what 90% of visits are; the analytics rooms, the reviews and
 * settings are fetched on demand, which keeps the first paint small on the phone
 * where it matters most.
 */

import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { AppShell } from './components/shell/AppShell';
import { Button, Spinner, ToastHost } from './components/ui';
import { useConnectivity, useVisibilityRefresh } from './hooks';
import { useApp } from './store/app';
import { timerActions } from './store/timer';
import { Cockpit } from './features/cockpit/Cockpit';

const InsightsView = lazy(() => import('./features/analytics/InsightsView').then((module) => ({ default: module.InsightsView })));
const CalendarView = lazy(() => import('./features/analytics/CalendarView').then((module) => ({ default: module.CalendarView })));
const SubjectsView = lazy(() => import('./features/subjects/SubjectsView').then((module) => ({ default: module.SubjectsView })));
const TasksView = lazy(() => import('./features/tasks/TasksView').then((module) => ({ default: module.TasksView })));
const GoalsView = lazy(() => import('./features/goals/GoalsView').then((module) => ({ default: module.GoalsView })));
const AchievementsView = lazy(() =>
  import('./features/achievements/AchievementsView').then((module) => ({ default: module.AchievementsView })),
);
const SettingsView = lazy(() => import('./features/settings/SettingsView').then((module) => ({ default: module.SettingsView })));
const DailyReview = lazy(() => import('./features/reviews/DailyReview').then((module) => ({ default: module.DailyReview })));
const WeeklyReview = lazy(() => import('./features/reviews/WeeklyReview').then((module) => ({ default: module.WeeklyReview })));
const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })));
const SessionDetail = lazy(() => import('./features/analytics/SessionDetail').then((module) => ({ default: module.SessionDetail })));

export function App() {
  const status = useApp((state) => state.status);
  const onboarded = useApp((state) => state.user?.onboarded ?? false);
  const bootstrap = useApp((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Connectivity, the offline outbox flush, and re-deriving the clock when the tab
  // wakes up. All three are shell-level concerns, not per-screen ones.
  useConnectivity();
  useVisibilityRefresh(() => void timerActions.flush());

  return (
    <BrowserRouter>
      <ToastHost />
      {status === 'booting' ? (
        <BootSplash />
      ) : status === 'signed-out' ? (
        <Suspense fallback={<BootSplash />}>
          <AuthPage />
        </Suspense>
      ) : !onboarded ? (
        <Suspense fallback={<BootSplash />}>
          <OnboardingPage />
        </Suspense>
      ) : (
        <AppShell>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Cockpit />} />
              <Route path="/insights" element={<InsightsView />} />
              <Route path="/calendar" element={<CalendarView />} />
              <Route path="/sessions/:sessionId" element={<SessionDetail />} />
              <Route path="/subjects" element={<SubjectsView />} />
              <Route path="/tasks" element={<TasksView />} />
              <Route path="/goals" element={<GoalsView />} />
              <Route path="/achievements" element={<AchievementsView />} />
              <Route path="/review/daily" element={<DailyReview />} />
              <Route path="/review/weekly" element={<WeeklyReview />} />
              <Route path="/settings" element={<SettingsView />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </AppShell>
      )}
    </BrowserRouter>
  );
}

/**
 * The boot screen.
 *
 * Not a spinner on a blank page. It shows the mark and says what is happening,
 * because the very first request is a network round trip and on a cold phone it
 * is not instant.
 */
function BootSplash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-void">
      <svg viewBox="0 0 24 24" className="h-9 w-9 animate-breathe" aria-hidden="true">
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="rgb(var(--edge))" strokeWidth="1.3" />
        <path d="M12 2.8a9.2 9.2 0 0 1 9.2 9.2" fill="none" stroke="rgb(var(--accent))" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2.2" fill="rgb(var(--accent))" />
      </svg>
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-faint">Restoring your instrument</p>
      <p className="sr-only" role="status">
        Loading Studion
      </p>
    </div>
  );
}

/** A route-level loading state that keeps the shell's geometry stable. */
function RouteFallback() {
  return (
    <div className="mx-auto flex w-full max-w-[76rem] flex-1 items-center justify-center gap-2 px-6 py-20 text-faint">
      <Spinner />
      <span className="font-mono text-micro uppercase tracking-[0.14em]">Loading</span>
    </div>
  );
}

/**
 * A 404 that is honest about the state of the product.
 *
 * Some rooms are named in the navigation but are still being built. Rather than a
 * dead end, this says which of the two situations you are in.
 */
function NotFound() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex w-full max-w-[36rem] flex-1 flex-col items-start justify-center gap-4 px-6 py-20">
      <p className="label">Not found</p>
      <h1 className="text-head text-ink">That room does not exist yet</h1>
      <p className="text-small text-muted">
        Nothing lives at <code className="rounded-sm bg-raised px-1.5 py-0.5 font-mono text-tiny text-muted">{location.pathname}</code>. It
        is not a permission problem — the address simply does not match anything in this build.
      </p>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => navigate('/')}>
          Back to the cockpit
        </Button>
        <Button variant="secondary" onClick={() => navigate('/insights')}>
          Open insights
        </Button>
      </div>
    </div>
  );
}
