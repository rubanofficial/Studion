/**
 * Up next — the left instrument strip.
 *
 * Answers "what should I do when this session ends?" without a route change.
 * Three things only: the single next task, anything due soon, and the subjects
 * that are behind their target this week. It is deliberately a *short* list: a
 * cockpit that shows twenty tasks is a to-do app with a timer attached.
 *
 * Built from hairline-separated rows rather than cards. On a near-black canvas a
 * stack of bordered boxes reads as clutter; a divider and a label do the same job
 * with less furniture.
 */

import { formatDuration } from '@focusforge/core';
import { Link } from 'react-router-dom';

import { usePeriodAnalytics } from '../../data/queries';
import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { cn } from '../../components/ui';

export function UpNext() {
  const overview = useApp((state) => state.overview);
  const subjects = useApp(selectActiveSubjects);
  const settings = useApp((state) => state.settings);
  const setPanel = useApp((state) => state.setPanel);
  const tasks = useApp((state) => state.tasks);
  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { phase } = useTimer();
  // The per-subject weekly totals are not in the overview payload — a subject
  // strip needs the period summary, which already groups by subject server-side.
  const { data: week } = usePeriodAnalytics({ period: 'week' });

  const subjectName = (id: string | null) => subjects.find((item) => item._id === id)?.name ?? 'Unfiled';

  const nextTask = overview?.nextTask ?? null;
  const dueSoon = overview?.dueSoon ?? [];

  /** Subjects that are meaningfully behind their weekly target. */
  const earnedBySubject = new Map(
    (week?.summary.subjects ?? []).map((entry) => [entry.subjectId, entry.focusedSeconds] as const),
  );
  const behind = subjects
    .filter((subject) => subject.weeklyTargetSeconds > 0)
    .map((subject) => ({
      subject,
      weekly: subject.weeklyTargetSeconds,
      weekTotal: earnedBySubject.get(subject._id) ?? 0,
    }))
    .filter((entry) => entry.weekTotal < entry.weekly * 0.85)
    .sort((a, b) => a.weekTotal / a.weekly - b.weekTotal / b.weekly)
    .slice(0, 3);

  const busy = phase !== 'idle' && phase !== 'finished';

  return (
    <aside aria-label="Up next" className="flex flex-col gap-5">
      <div>
        <h2 className="label">Up next</h2>

        {nextTask ? (
          <div className="mt-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void timerActions.start({
                  subjectId: nextTask.subjectId,
                  taskId: nextTask.id,
                  plannedSeconds: nextTask.estimatedDuration > 0 ? nextTask.estimatedDuration : (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
                  timeZone,
                })
              }
              className={cn(
                'group w-full rounded-md border border-line bg-raised/60 px-3 py-2.5 text-left transition-colors duration-quick',
                busy ? 'opacity-50' : 'hover:border-accent/50',
              )}
            >
              <p className="text-small text-ink">{nextTask.title}</p>
              <p className="mt-1 flex items-center gap-2 font-mono text-micro uppercase tracking-[0.06em] text-faint">
                <span>{subjectName(nextTask.subjectId)}</span>
                {nextTask.estimatedDuration > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{formatDuration(nextTask.estimatedDuration, { style: 'short' })}</span>
                  </>
                )}
                <span className="ml-auto text-ghost group-hover:text-accent">{busy ? 'queued' : 'start →'}</span>
              </p>
            </button>
          </div>
        ) : (
          <div className="mt-2.5 rounded-md border border-dashed border-line px-3 py-3">
            <p className="text-small text-muted">Nothing queued.</p>
            <button type="button" onClick={() => setPanel('tasks')} className="mt-1 text-tiny text-accent hover:underline">
              Add the next piece of work →
            </button>
          </div>
        )}
      </div>

      {dueSoon.length > 0 && (
        <div>
          <h2 className="label">Due soon</h2>
          <ul className="mt-2 divide-y divide-line/70">
            {dueSoon.slice(0, 4).map((task) => (
              <li key={task.id} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-small text-muted" title={task.title}>
                  {task.title}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-micro uppercase',
                    isOverdue(task.dueAt) ? 'text-alert' : 'text-faint',
                  )}
                >
                  {relativeDue(task.dueAt, timeZone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {behind.length > 0 && (
        <div>
          <h2 className="label">Behind this week</h2>
          <ul className="mt-2 flex flex-col gap-2.5">
            {behind.map(({ subject, weekly, weekTotal }) => {
              const ratio = Math.min(1, weekTotal / weekly);
              return (
                <li key={subject._id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2 text-small text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: subject.color }} aria-hidden="true" />
                      {subject.name}
                    </span>
                    <span className="font-mono text-micro text-faint">
                      {duration(weekTotal)} / {duration(weekly)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-pill bg-sunken">
                    <div className="h-full rounded-pill" style={{ width: `${ratio * 100}%`, background: subject.color }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="hint mt-2">
            Based on this week's recorded time. Neutral information, not a verdict.
          </p>
        </div>
      )}

      <div>
        <h2 className="label">Open tasks</h2>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="font-mono text-lead text-ink numeric-stable">
            {tasks.filter((task) => task.status === 'todo' || task.status === 'in-progress').length}
          </span>
          <Link to="/tasks" className="text-tiny text-accent hover:underline">
            Manage →
          </Link>
        </div>
      </div>

      {overview?.subjects && overview.subjects.length === 0 && (
        <div className="rounded-md border border-line bg-raised/50 px-3 py-3">
          <p className="text-small text-muted">Your first focus session starts here.</p>
          <Link to="/subjects?new=1" className="mt-1 inline-block text-tiny text-accent hover:underline">
            Create a subject →
          </Link>
        </div>
      )}
    </aside>
  );
}

function isOverdue(dueAt: string | null): boolean {
  return dueAt !== null && Date.parse(dueAt) < Date.now();
}

function relativeDue(dueAt: string | null, timeZone: string): string {
  if (!dueAt) return '—';
  const target = Date.parse(dueAt);
  if (!Number.isFinite(target)) return '—';

  const diffMs = target - Date.now();
  const dayMs = 86_400_000;
  if (diffMs < 0) {
    const overdueDays = Math.floor(-diffMs / dayMs);
    return overdueDays === 0 ? 'today' : `${overdueDays}d over`;
  }
  if (diffMs < dayMs) {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(target));
  }
  const days = Math.round(diffMs / dayMs);
  if (days <= 6) return `${days}d`;
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(target));
}
