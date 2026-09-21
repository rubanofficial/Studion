/**
 * The timer, bridged to React.
 *
 * The engine is a module-level singleton created once, outside React. That is
 * deliberate: a timer whose identity is tied to a component tree would be
 * re-created by a re-render, a route change or a StrictMode double-invoke, and a
 * timer that can be re-created is a timer that can lose a session.
 *
 * React only *observes* it. The snapshot updates once a second, and because the
 * numbers are derived from timestamps rather than accumulated, a dropped or
 * delayed render cannot cause drift.
 */

import { useEffect, useState } from 'react';

import { FocusTimer, type TimerSnapshot } from '../lib/timer';
import { useApp } from './app';

export const timer = new FocusTimer({
  onError: (message) => {
    useApp.getState().toast({ tone: 'warning', title: 'Sync problem', detail: message });
  },
  onSessionCompleted: () => {
    // The completion celebration is driven by the caller; here we simply make sure
    // the aggregates reflect the session that just closed.
    void useApp.getState().refreshAll();
  },
});

/** Emit a snapshot whenever the engine has news. */
export function useTimer(): TimerSnapshot {
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() => timer.getSnapshot());

  useEffect(() => {
    const unsubscribe = timer.subscribe(setSnapshot);
    return () => {
      unsubscribe();
    };
  }, []);

  return snapshot;
}

/** Actions, stable across renders because they are bound to the singleton. */
export const timerActions = {
  start: (input: Parameters<FocusTimer['start']>[0]) => timer.start(input),
  pause: () => timer.pause(),
  resume: () => timer.resume(),
  startBreak: () => timer.startBreak(),
  endBreak: () => timer.endBreak(),
  recordDistraction: (kind: string) => timer.recordDistraction(kind),
  extend: (minutes: number) => timer.extend(minutes),
  finish: (options?: Parameters<FocusTimer['finish']>[0]) => timer.finish(options),
  clear: () => timer.clear(),
  flush: () => timer.flush({ force: true }),
  flushOutbox: () => timer.flushOutbox(),
};
