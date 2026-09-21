/**
 * The completion moment.
 *
 * Two stages, because the session genuinely has two:
 *
 *   1. **The plan is reached but the session is still open.** The engine does not
 *      decide for you — maybe you want the last three minutes, maybe you want to
 *      stop. So this is a question with three honest answers: save it, extend it,
 *      or stop early.
 *   2. **It is closed.** Now there is something to show: the focus score, with its
 *      breakdown, plus what it moved (a goal, a streak, an achievement).
 *
 * The score is fetched as a *breakdown*, not a number. A user who is told they
 * scored 78 because they were interrupted twice and finished four minutes early
 * can act on that; a user who sees "78" learns nothing. And when the session has
 * not reached the server yet, the dialog says so rather than inventing a value.
 */

import { useEffect, useState } from 'react';

import { api, type SessionDto } from '../../lib/api';
import { duration } from '../../lib/format';
import { isPlanComplete } from '../../lib/timer';
import { useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { Button, ProgressBar, Spinner, StatRow, cn } from '../../components/ui';

export function SessionComplete({ onDismiss }: { onDismiss: () => void }) {
  const snapshot = useTimer();
  const subjects = useApp((state) => state.subjects);
  const overview = useApp((state) => state.overview);
  const toast = useApp((state) => state.toast);

  const [saved, setSaved] = useState<SessionDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const subject = subjects.find((item) => item._id === snapshot.subjectId) ?? null;
  const planReached = isPlanComplete(snapshot);

  // Await the score reveal a beat after closing, so it lands as a result.
  useEffect(() => {
    if (!saved) return;
    const handle = setTimeout(() => setRevealed(true), 260);
    return () => clearTimeout(handle);
  }, [saved]);

  /**
   * Close the session and pick up its score.
   *
   * The score only exists once the server has processed the event log, so this
   * re-reads the newest session rather than guessing. If the upload was queued
   * offline, the fetch fails and the dialog stays honest about it.
   */
  const close = async (status: 'completed' | 'interrupted') => {
    setSaving(true);
    await timerActions.finish({ status });

    if (!navigator.onLine) {
      setSaving(false);
      void timerActions.clear();
      onDismiss();
      toast({
        tone: 'info',
        title: 'Session recorded on this device',
        detail: 'It will be scored and uploaded automatically when you reconnect.',
      });
      return;
    }

    setFetching(true);
    const result = await api.sessions.list({ limit: 1 });
    setFetching(false);
    setSaving(false);

    if (result.ok && result.data.sessions[0]) {
      setSaved(result.data.sessions[0]);
    } else {
      void timerActions.clear();
      onDismiss();
    }

    void useApp.getState().refreshAll();
  };

  const score = saved?.focusScore ?? null;
  const breakdown = saved?.focusScoreBreakdown ?? null;
  const goalNowMet = overview?.today.goalMet ?? false;

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-void/80 backdrop-blur-md"
        onClick={() => {
          if (saved) void timerActions.clear();
          onDismiss();
        }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={saved ? 'Session recorded' : 'Session complete'}
        className="relative flex max-h-full w-full max-w-md animate-sweep flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-pane"
      >
        <div className="flex flex-col items-center gap-1 border-b border-line px-6 py-6 text-center">
          <CompletionMark progress={snapshot.progress} tone={planReached ? 'good' : 'accent'} />
          <p className="mt-2 font-mono text-micro uppercase tracking-[0.2em] text-faint">
            {saved ? 'Recorded' : planReached ? 'Plan reached' : 'Still running'}
          </p>
          <h2 className="font-mono text-head text-ink numeric-stable">{duration(snapshot.focusedSeconds)}</h2>
          <p className="hint">
            {subject?.name ?? 'Unfiled'}
            {snapshot.plannedSeconds > 0 && ` · planned ${duration(snapshot.plannedSeconds)}`}
          </p>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5 scroll-thin">
          {/* --------------------------------------------------- stage two: score */}
          {saved ? (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="label">Focus score</span>
                {score !== null ? (
                  <span className="font-mono text-lead text-ink numeric-stable">
                    {revealed ? score : '—'}
                    <span className="text-faint">/100</span>
                  </span>
                ) : (
                  <span className="font-mono text-tiny text-faint">not scored</span>
                )}
              </div>

              {breakdown && revealed ? (
                <>
                  <div className="mt-2">
                    <ProgressBar value={(score ?? 0) / 100} label="Focus score" />
                  </div>
                  <ul className="mt-3 divide-y divide-line/60">
                    {breakdown.factors.map((factor) => (
                      <li key={factor.key} className="py-2">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-small text-muted">{factor.label}</span>
                          <span className="font-mono text-micro text-faint">
                            {Math.round(factor.points)}/{Math.round(factor.maxPoints)} pts
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <ProgressBar value={factor.value} height={2} />
                        </div>
                        <p className="hint mt-1">{factor.note}</p>
                      </li>
                    ))}
                  </ul>
                  <p className="hint mt-2">{breakdown.summary}</p>
                </>
              ) : score === null ? (
                <p className="hint mt-2">
                  A session only earns a score once at least a few minutes of real focus are recorded — a cancelled start is stored,
                  but it is deliberately not judged.
                </p>
              ) : null}

              {goalNowMet && (
                <p className="mt-3 rounded-md border border-good/30 bg-good/[0.06] px-3 py-2 text-small text-muted">
                  Today's goal is met. Everything from here is ahead of plan.
                </p>
              )}
            </div>
          ) : (
            /* ---------------------------------------------- stage one: the question */
            <>
              <div className="rounded-lg border border-line bg-sunken px-3.5 py-2.5">
                <StatRow label="Focused" value={duration(snapshot.focusedSeconds)} />
                {snapshot.breakSeconds > 0 && <StatRow label="Break" value={duration(snapshot.breakSeconds)} />}
                {snapshot.pausedSeconds > 0 && <StatRow label="Paused" value={duration(snapshot.pausedSeconds)} />}
                <StatRow label="Interruptions" value={String(snapshot.pauseCount)} />
                <StatRow label="Distractions" value={String(snapshot.distractionCount)} />
              </div>

              {planReached ? (
                <p className="text-small text-muted">
                  You have reached the planned {duration(snapshot.plannedSeconds)}. Save it, or keep going — the clock will keep
                  counting either way.
                </p>
              ) : (
                <p className="text-small text-muted">
                  {duration(Math.max(0, snapshot.plannedSeconds - snapshot.focusedSeconds))} short of the planned{' '}
                  {duration(snapshot.plannedSeconds)}. Saving now records this as an interruption. It still counts, and it is still
                  useful data.
                </p>
              )}

              {snapshot.distractionCount > 0 && (
                <p className="hint">
                  You logged {snapshot.distractionCount} interruption{snapshot.distractionCount === 1 ? '' : 's'}. That is a
                  measurement, not a criticism — the pattern across a month is the useful part.
                </p>
              )}

              {!snapshot.synced && (
                <p className="rounded-md border border-pause/30 bg-pause/[0.06] px-3 py-2 text-tiny text-muted">
                  This session is running on this device only. It will be uploaded and scored automatically when you reconnect.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-6 py-4">
          {saved ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  void timerActions.clear();
                  onDismiss();
                }}
              >
                Close
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  void timerActions.clear();
                  onDismiss();
                }}
              >
                Start another
              </Button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={saving}
                  onClick={() => {
                    onDismiss();
                    void timerActions.extend(10);
                    void timerActions.resume();
                  }}
                >
                  +10 minutes
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  loading={saving || fetching}
                  onClick={() => void close(planReached ? 'completed' : 'interrupted')}
                >
                  {planReached ? 'Save session' : 'Save anyway'}
                </Button>
              </div>
              <Button variant="ghost" className="w-full" onClick={onDismiss} disabled={saving}>
                Keep focusing
              </Button>
              {(saving || fetching) && (
                <p className="flex items-center justify-center gap-2 text-tiny text-faint">
                  <Spinner /> {fetching ? 'Scoring the session…' : 'Recording…'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** A ring that draws itself closed. Uses the Core's geometry at a third of the size. */
function CompletionMark({ progress, tone }: { progress: number; tone: 'good' | 'accent' }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const handle = requestAnimationFrame(() => setDrawn(Math.min(1, progress)));
    return () => cancelAnimationFrame(handle);
  }, [progress]);

  const colour = tone === 'good' ? 'rgb(var(--state-good))' : 'rgb(var(--accent))';

  return (
    <span className="relative flex h-24 w-24 items-center justify-center">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgb(var(--line))" strokeWidth="4" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - drawn)}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <span className={cn('absolute font-mono text-lead', tone === 'good' ? 'text-good' : 'text-accent')} aria-hidden="true">
        {tone === 'good' ? '✓' : '+'}
      </span>
    </span>
  );
}
