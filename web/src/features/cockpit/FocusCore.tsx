/**
 * The Core — the focus instrument.
 *
 * This is the object the product is built around. Everything else in the app
 * exists to feed it or to read what it recorded.
 *
 * Design decisions worth naming, because they are what stop it becoming a
 * generic Pomodoro dial:
 *
 *   - **Two rings, two meanings.** The outer ring is the *planned* session; the
 *     inner arc is *today's* goal against the daily target. They answer different
 *     questions, so they are never merged into one ambiguous percentage.
 *   - **Orbit, not a dropdown.** When idle, subjects are placed on the ring
 *     itself and the ring takes on the colour of whichever is selected. Picking
 *     what to work on is a spatial act — one click, no menu.
 *   - **Minute ticks.** Sixty hairlines. At a glance you can see a quarter of the
 *     session without reading a number, which is the whole point of a dial.
 *   - **The digits are the readout, not a label.** Sized in viewport units so the
 *     clock is legible from a metre away on a laptop and from arm's length on a
 *     phone. Planned time sits underneath at a fraction of the size.
 *
 * The geometry is computed, not hand-authored, so the instrument scales without
 * a separate mobile variant.
 */

import { useEffect, useState } from 'react';

import { formatDuration } from '@focusforge/core';

import { applyState } from '../../lib/theme';
import { selectActiveSubjects, useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { Button, cn } from '../../components/ui';

const TICKS = 60;

export function FocusCore() {
  const snapshot = useTimer();
  const subjects = useApp(selectActiveSubjects);
  const settings = useApp((state) => state.settings);
  const overview = useApp((state) => state.overview);
  const setPanel = useApp((state) => state.setPanel);
  const toast = useApp((state) => state.toast);
  const openSession = useApp((state) => state.overview?.openSession ?? null);

  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [plannedMinutes, setPlannedMinutes] = useState<number | null>(null);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const presets = settings?.focusPresets ?? [
    { minutes: 15, label: '15' },
    { minutes: 25, label: '25' },
    { minutes: 45, label: '45' },
    { minutes: 60, label: '60' },
    { minutes: 90, label: '90' },
  ];

  // Default to the user's preferred subject, then the first one.
  const activeSubjectId = snapshot.subjectId ?? selectedSubjectId ?? settings?.defaultSubject ?? subjects[0]?._id ?? null;
  const subject = subjects.find((item) => item._id === activeSubjectId) ?? null;
  const minutes = plannedMinutes ?? presets[1]?.minutes ?? 25;

  const isIdle = snapshot.phase === 'idle' || snapshot.phase === 'finished';

  /**
   * Paint the ambient wash from the timer state.
   *
   * Done here rather than in the theme module's callers so there is exactly one
   * place that decides what colour the app is right now, and it always agrees
   * with the dial the user is looking at.
   */
  useEffect(() => {
    applyState(snapshot.phase, subject?.color ?? settings?.accent ?? '#5eead4', {
      ambient: settings?.ambientBackground !== false,
    });
  }, [snapshot.phase, subject?.color, settings?.accent, settings?.ambientBackground]);

  const todayGoal = overview?.today.goalSeconds ?? 0;
  const todayProgress = todayGoal > 0 ? Math.min(1, (overview?.today.focusedSeconds ?? 0) / todayGoal) : 0;

  const plannedProgress = snapshot.plannedSeconds > 0 ? Math.min(1, snapshot.focusedSeconds / snapshot.plannedSeconds) : 0;
  const ringTone =
    snapshot.phase === 'break' ? 'rgb(var(--state-rest))' : snapshot.phase === 'paused' ? 'rgb(var(--state-pause))' : 'rgb(var(--accent))';

  const start = () => {
    if (!subject) {
      toast({ tone: 'info', title: 'Create a subject first', detail: 'Sessions are filed by subject so the analytics can compare them.' });
      return;
    }
    void timerActions.start({
      subjectId: subject._id,
      taskId: null,
      plannedSeconds: minutes * 60,
      timeZone,
    });
  };

  /**
   * Primary action. Space, the dock's centre button and this all resolve to the
   * same thing, which is what makes the instrument feel like one object.
   */
  const primary = () => {
    if (snapshot.phase === 'focus') void timerActions.pause();
    else if (snapshot.phase === 'paused' || snapshot.phase === 'break') void timerActions.resume();
    else if (snapshot.phase === 'finished') {
      void timerActions.flush().finally(() => {
        void timerActions.clear();
        void useApp.getState().refreshAll();
      });
    } else {
      start();
    }
  };

  const primaryLabel =
    snapshot.phase === 'focus' ? 'Pause' : snapshot.phase === 'paused' ? 'Resume' : snapshot.phase === 'break' ? 'Back to focus' : snapshot.phase === 'finished' ? 'Finish up' : 'Begin';

  return (
    <section
      aria-label="Focus instrument"
      className="relative flex flex-col items-center gap-6 px-4 pt-2 sm:px-6"
    >
      {/* ------------------------------------------------------------ the dial */}
      <div className="relative w-full max-w-[34rem]">
        <svg
          viewBox="0 0 400 400"
          className="aspect-square w-full"
          role="img"
          aria-label={describeDial(snapshot, subject?.name ?? null)}
        >
          {/* Outer today ring — the daily goal, always visible, always ambient. */}
          <circle cx="200" cy="200" r="186" fill="none" stroke="rgb(var(--line))" strokeWidth="1" />
          <circle
            cx="200"
            cy="200"
            r="186"
            fill="none"
            stroke="rgb(var(--accent))"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 186}
            strokeDashoffset={2 * Math.PI * 186 * (1 - todayProgress)}
            transform="rotate(-90 200 200)"
            opacity={isIdle ? 0.85 : 0.3}
            style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-forge)' }}
          />

          {/* Minute ticks. Every fifth is drawn longer and slightly stronger, so
              the dial reads as a clock face rather than a decorative sunburst. */}
          <g>
            {Array.from({ length: TICKS }).map((_, index) => {
              const angle = (index / TICKS) * Math.PI * 2 - Math.PI / 2;
              const major = index % 5 === 0;
              const inner = major ? 150 : 157;
              const outer = 168;
              const elapsed = snapshot.plannedSeconds > 0 && index / TICKS <= plannedProgress;
              return (
                <line
                  key={index}
                  x1={200 + Math.cos(angle) * inner}
                  y1={200 + Math.sin(angle) * inner}
                  x2={200 + Math.cos(angle) * outer}
                  y2={200 + Math.sin(angle) * outer}
                  stroke={elapsed ? 'rgb(var(--accent))' : 'rgb(var(--edge))'}
                  strokeWidth={major ? 1.4 : 0.8}
                  opacity={elapsed ? 0.9 : major ? 0.8 : 0.45}
                  style={{ transition: 'stroke var(--dur-calm) linear, opacity var(--dur-calm) linear' }}
                />
              );
            })}
          </g>

          {/* Session arc — the planned session itself. */}
          <circle cx="200" cy="200" r="140" fill="none" stroke="rgb(var(--line))" strokeWidth="6" />
          <circle
            cx="200"
            cy="200"
            r="140"
            fill="none"
            stroke={ringTone}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 140}
            strokeDashoffset={2 * Math.PI * 140 * (1 - plannedProgress)}
            transform="rotate(-90 200 200)"
            style={{ transition: 'stroke-dashoffset var(--dur-slow) linear, stroke var(--dur-calm) var(--ease-forge)' }}
          />

          {/* Break overlay: a second, inset arc so a break is drawn *inside* the
              session rather than replacing it. */}
          {snapshot.breakSeconds > 0 && (
            <circle
              cx="200"
              cy="200"
              r="126"
              fill="none"
              stroke="rgb(var(--state-rest))"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.6"
              strokeDasharray={2 * Math.PI * 126}
              strokeDashoffset={2 * Math.PI * 126 * (1 - Math.min(1, snapshot.breakSeconds / Math.max(1, snapshot.plannedSeconds * 0.4)))}
              transform="rotate(-90 200 200)"
            />
          )}

          {/* The orbital subject selector, shown only when idle. */}
          {isIdle && subjects.length > 1 && (
            <g>
              {subjects.slice(0, 8).map((item, index, list) => {
                const angle = (index / list.length) * Math.PI * 2 - Math.PI / 2;
                const x = 200 + Math.cos(angle) * 200;
                const y = 200 + Math.sin(angle) * 200;
                const isActive = item._id === activeSubjectId;
                return (
                  <g key={item._id} transform={`translate(${x} ${y})`} className="cursor-pointer" onClick={() => setSelectedSubjectId(item._id)}>
                    <circle r="15" fill="rgb(var(--surface))" stroke={isActive ? item.color : 'rgb(var(--edge))'} strokeWidth={isActive ? 2 : 1} />
                    <circle r="4" fill={item.color} opacity={isActive ? 1 : 0.5} />
                    <text
                      textAnchor="middle"
                      y="30"
                      className="fill-[rgb(var(--faint))] font-mono"
                      style={{ fontSize: '10px' }}
                    >
                      {item.name.length > 11 ? `${item.name.slice(0, 10)}…` : item.name}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* ------------------------------------------------------ the readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-[22%] text-center">
          <p className="truncate font-mono text-micro uppercase tracking-[0.22em] text-faint" title={subject?.name ?? undefined}>
            {subject?.name ?? 'No subject'}
          </p>

          {snapshot.phase === 'break' ? (
            <p className="max-w-full truncate text-small text-rest">Break — the work is still on the clock</p>
          ) : (
            <p className="max-w-full truncate text-small text-muted">
              {taskTitleFor(snapshot.taskId) ?? subject?.description ?? 'Ready when you are'}
            </p>
          )}

          <p
            className="font-mono text-instrument text-ink numeric-stable"
            aria-live="off"
            /* The clock is not announced every second — that would make the app
               unusable with a screen reader. The status line below is the live
               region instead. */
          >
            {formatClock(snapshot.phase === 'break' ? snapshot.breakSeconds : snapshot.focusedSeconds)}
          </p>

          <p className="font-mono text-tiny uppercase tracking-[0.14em] text-faint">
            {snapshot.plannedSeconds > 0
              ? `${formatDuration(snapshot.plannedSeconds, { style: 'short' })} session`
              : 'no session running'}
            {snapshot.isOverrun && <span className="ml-2 text-accent">+{formatDuration(snapshot.focusedSeconds - snapshot.plannedSeconds, { style: 'short' })} over</span>}
          </p>
        </div>
      </div>

      {/* The screen-reader live region. Deliberately terse and rate-limited. */}
      <p className="sr-only" aria-live="polite">
        {statusAnnouncement(snapshot.phase, snapshot.remainingSeconds)}
      </p>

      {/* --------------------------------------------------------- the controls */}
      {isIdle ? (
        <div className="flex w-full max-w-[34rem] flex-col items-center gap-4">
          {subjects.length === 0 ? (
            <p className="hint text-center">
              Add your first subject and this ring becomes the shortest path to starting work.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Session length">
            {presets.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                aria-pressed={minutes === preset.minutes && !isCustomDuration}
                onClick={() => {
                  setIsCustomDuration(false);
                  setPlannedMinutes(preset.minutes);
                }}
                className={cn(
                  'rounded-pill border px-3 py-1.5 font-mono text-tiny transition-colors duration-quick',
                  minutes === preset.minutes && !isCustomDuration
                    ? 'border-accent/60 bg-accent/10 text-ink'
                    : 'border-line text-faint hover:border-faint hover:text-muted',
                )}
              >
                {preset.minutes}m
              </button>
            ))}

            {isCustomDuration ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = parseInt(customInput, 10);
                  if (parsed > 0 && parsed <= 360) {
                    setPlannedMinutes(parsed);
                  }
                  setIsCustomDuration(false);
                }}
                className="inline-flex items-center"
              >
                <input
                  type="number"
                  min={1}
                  max={360}
                  autoFocus
                  placeholder="min"
                  aria-label="Custom duration in minutes"
                  value={customInput}
                  onChange={(event) => setCustomInput(event.target.value)}
                  onBlur={() => {
                    const parsed = parseInt(customInput, 10);
                    if (parsed > 0 && parsed <= 360) {
                      setPlannedMinutes(parsed);
                    }
                    setIsCustomDuration(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setIsCustomDuration(false);
                    }
                  }}
                  className="w-16 rounded-pill border border-accent/60 bg-surface px-2.5 py-1 text-center font-mono text-tiny text-ink outline-none"
                />
              </form>
            ) : (
              <button
                type="button"
                aria-pressed={!presets.some((p) => p.minutes === minutes)}
                onClick={() => {
                  setCustomInput(String(minutes));
                  setIsCustomDuration(true);
                }}
                className={cn(
                  'rounded-pill border px-3 py-1.5 font-mono text-tiny transition-colors duration-quick',
                  !presets.some((p) => p.minutes === minutes)
                    ? 'border-accent/60 bg-accent/10 text-ink'
                    : 'border-line text-faint hover:border-faint hover:text-muted',
                )}
              >
                {!presets.some((p) => p.minutes === minutes) ? `${minutes}m` : 'Custom'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <Button variant="instrument" className="btn-primary" onClick={primary} disabled={!subject}>
              <PlayGlyph />
              {primaryLabel}
            </Button>
            <button
              type="button"
              onClick={() => setPanel('tasks')}
              className="rounded-pill border border-line px-4 py-3 text-small text-muted transition-colors duration-quick hover:border-faint hover:text-ink"
            >
              Choose a task
            </button>
          </div>
        </div>
      ) : (
        <div className="flex w-full max-w-[34rem] flex-col items-center gap-3">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="instrument" className={cn('btn-primary')} onClick={primary}>
              {snapshot.phase === 'focus' ? <PauseGlyph /> : <PlayGlyph />}
              {primaryLabel}
            </Button>

            {snapshot.phase === 'focus' && (
              <button
                type="button"
                onClick={() => void timerActions.startBreak()}
                className="rounded-pill border border-line px-4 py-3 text-small text-muted transition-colors duration-quick hover:border-rest/50 hover:text-rest"
              >
                Break
              </button>
            )}

            <button
              type="button"
              onClick={() => setPanel('distractions')}
              className="rounded-pill border border-line px-4 py-3 text-small text-muted transition-colors duration-quick hover:border-faint hover:text-ink"
            >
              Interruption
              {snapshot.distractionCount > 0 && <span className="ml-2 font-mono text-tiny text-faint">{snapshot.distractionCount}</span>}
            </button>

            <button
              type="button"
              onClick={() => void timerActions.extend(10)}
              className="rounded-pill border border-line px-4 py-3 text-small text-muted transition-colors duration-quick hover:border-faint hover:text-ink"
              title="Add ten minutes to the planned duration"
            >
              +10m
            </button>

            <button
              type="button"
              onClick={() => setPanel('session')}
              className="rounded-pill border border-line px-4 py-3 text-small text-muted transition-colors duration-quick hover:border-alert/40 hover:text-alert"
            >
              End
            </button>
          </div>

          <div className="flex items-center gap-4 font-mono text-micro uppercase tracking-[0.12em] text-faint">
            <span>
              {snapshot.remainingSeconds > 0
                ? `${formatDuration(snapshot.remainingSeconds, { style: 'short' })} left`
                : 'plan reached'}
            </span>
            {snapshot.breakSeconds > 0 && <span className="text-rest">break {formatDuration(snapshot.breakSeconds, { style: 'clock' })}</span>}
            {snapshot.pausedSeconds > 0 && <span className="text-pause">paused {formatDuration(snapshot.pausedSeconds, { style: 'clock' })}</span>}
            <span className={snapshot.synced ? 'text-good' : 'text-rest'}>{snapshot.synced ? 'saved' : 'saving'}</span>
          </div>

          {openSession && openSession.id !== snapshot.serverId && (
            <p className="hint">
              Another device has a session open for this account. It keeps its own clock; this tab is working locally.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** Read the task title without subscribing the whole component to the task list. */
function taskTitleFor(taskId: string | null): string | null {
  if (!taskId) return null;
  return useApp.getState().tasks.find((task) => task._id === taskId)?.title ?? null;
}

/** `mm:ss`, or `h:mm:ss` once a session passes an hour. */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function describeDial(
  snapshot: { phase: string; focusedSeconds: number; plannedSeconds: number },
  subjectName: string | null,
): string {
  const state =
    snapshot.phase === 'idle'
      ? 'No session running'
      : snapshot.phase === 'break'
        ? 'On a break'
        : snapshot.phase === 'paused'
          ? 'Paused'
          : `Focusing${subjectName ? ` on ${subjectName}` : ''}`;
  return `${state}. ${formatDuration(snapshot.focusedSeconds, { style: 'short' })} of ${
    snapshot.plannedSeconds > 0 ? formatDuration(snapshot.plannedSeconds, { style: 'short' }) : 'no'
  } planned.`;
}

function statusAnnouncement(phase: string, remainingSeconds: number): string {
  if (phase === 'idle') return 'Timer idle.';
  if (phase === 'break') return 'Break started.';
  if (phase === 'paused') return `Paused with ${formatDuration(remainingSeconds, { style: 'short' })} remaining.`;
  if (phase === 'finished') return 'Session finished.';
  return 'Focus session running.';
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M4 2.8l9 5.2-9 5.2z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}
