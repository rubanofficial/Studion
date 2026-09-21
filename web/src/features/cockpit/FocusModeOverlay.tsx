/**
 * Focus mode.
 *
 * Everything the product offers that is not the clock, removed. The chrome, the
 * queue, the week, the dock — all gone. What is left is the remaining time, the
 * planned duration as a hairline across the top, and four controls that fade in
 * when the pointer moves and fade out when it stops.
 *
 * This exists because the single biggest source of lost focus is the tool you are
 * focusing with. The mode is entered with `m` and left with `esc`, and it is a
 * *view* — the timer keeps running exactly as it was, in the same engine, with no
 * transition between the two.
 */

import { useEffect, useState } from 'react';

import { formatDuration } from '@focusforge/core';

import { useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { formatClock } from './FocusCore';
import { cn } from '../../components/ui';

const IDLE_HIDE_MS = 3200;

export function FocusModeOverlay() {
  const focusMode = useApp((state) => state.focusMode);
  const setFocusMode = useApp((state) => state.setFocusMode);
  const setPanel = useApp((state) => state.setPanel);
  const subjects = useApp((state) => state.subjects);
  const snapshot = useTimer();

  const [chromeVisible, setChromeVisible] = useState(true);

  // Hide the controls after a few seconds of stillness, so the screen becomes a
  // clock rather than a control panel. Any pointer or key activity brings them back.
  useEffect(() => {
    if (!focusMode) return;
    let handle = window.setTimeout(() => setChromeVisible(false), IDLE_HIDE_MS);

    const wake = () => {
      setChromeVisible(true);
      window.clearTimeout(handle);
      handle = window.setTimeout(() => setChromeVisible(false), IDLE_HIDE_MS);
    };

    window.addEventListener('pointermove', wake);
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      window.clearTimeout(handle);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [focusMode]);

  useEffect(() => {
    if (!focusMode) return;
    // Focus mode is a modal experience: nothing behind it should scroll.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [focusMode]);

  if (!focusMode) return null;

  const subject = subjects.find((item) => item._id === snapshot.subjectId) ?? null;
  const progress = snapshot.plannedSeconds > 0 ? Math.min(1, snapshot.focusedSeconds / snapshot.plannedSeconds) : 0;
  const isBreak = snapshot.phase === 'break';
  const remaining = snapshot.remainingSeconds;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
      className="fixed inset-0 z-[55] flex flex-col bg-void"
      onDoubleClick={() => setFocusMode(false)}
    >
      {/* The planned session as one hairline across the very top. The only
          progress indicator in the mode, and it is deliberately peripheral. */}
      <div className="h-[2px] w-full bg-line" aria-hidden="true">
        <div
          className={cn('h-full transition-[width] duration-calm linear', isBreak ? 'bg-rest' : 'bg-accent')}
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <p className="font-mono text-micro uppercase tracking-[0.28em] text-faint">{subject?.name ?? 'Focus'}</p>

        <p
          className={cn(
            'mt-3 font-mono text-[clamp(4.5rem,22vw,14rem)] leading-[0.9] tracking-[-0.05em] numeric-stable',
            isBreak ? 'text-rest' : snapshot.phase === 'paused' ? 'text-pause' : 'text-ink',
          )}
        >
          {formatClock(isBreak ? snapshot.breakSeconds : snapshot.focusedSeconds)}
        </p>

        <p className="mt-4 font-mono text-tiny uppercase tracking-[0.16em] text-faint">
          {snapshot.plannedSeconds > 0
            ? `${formatDuration(snapshot.plannedSeconds, { style: 'short' })} planned · ${
                remaining > 0 ? `${formatDuration(remaining, { style: 'short' })} left` : 'plan reached'
              }`
            : 'open session'}
        </p>

        <p className="sr-only" aria-live="polite">
          {snapshot.phase === 'paused' ? 'Paused.' : isBreak ? 'On a break.' : 'Focus running.'}
        </p>

        {/* Controls fade rather than unmount, so they keep their place in the tab
            order and a keyboard user is never stranded. */}
        <div
          className={cn(
            'mt-12 flex flex-wrap items-center justify-center gap-2.5 transition-opacity duration-calm ease-forge',
            chromeVisible ? 'opacity-100' : 'opacity-0 hover:opacity-100 focus-within:opacity-100',
          )}
        >
          <button
            type="button"
            onClick={() => (snapshot.phase === 'focus' ? void timerActions.pause() : void timerActions.resume())}
            className="rounded-pill border border-edge bg-raised px-6 py-3 text-small text-ink transition-colors duration-quick hover:border-faint"
          >
            {snapshot.phase === 'paused' || snapshot.phase === 'break' ? 'Resume' : 'Pause'}
          </button>

          {snapshot.phase === 'focus' && (
            <button
              type="button"
              onClick={() => void timerActions.startBreak()}
              className="rounded-pill border border-line px-5 py-3 text-small text-muted transition-colors duration-quick hover:border-rest/50 hover:text-rest"
            >
              Break
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setFocusMode(false);
              setPanel('distractions');
            }}
            className="rounded-pill border border-line px-5 py-3 text-small text-muted transition-colors duration-quick hover:border-faint hover:text-ink"
          >
            Interruption
            {snapshot.distractionCount > 0 && <span className="ml-2 font-mono text-tiny text-faint">{snapshot.distractionCount}</span>}
          </button>

          <button
            type="button"
            onClick={() => {
              setFocusMode(false);
              setPanel('session');
            }}
            className="rounded-pill border border-line px-5 py-3 text-small text-muted transition-colors duration-quick hover:border-alert/40 hover:text-alert"
          >
            End
          </button>

          <button
            type="button"
            onClick={() => setFocusMode(false)}
            className="rounded-pill px-4 py-3 text-small text-faint transition-colors duration-quick hover:text-ink"
          >
            Exit focus mode
          </button>
        </div>
      </div>

      <p className="pb-6 text-center font-mono text-micro uppercase tracking-[0.1em] text-ghost">
        {snapshot.synced ? 'saved' : 'saving locally'} · esc to exit
      </p>
    </div>
  );
}
