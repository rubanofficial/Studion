/**
 * Side panels.
 *
 * The cockpit is deliberately a single screen, so everything that would otherwise
 * need a modal or a route change lives in a panel that slides in from the edge.
 * The advantage is that the instrument never disappears: you can log a
 * distraction, queue the next task, or end a session *while watching the clock*.
 *
 * On desktop the panel is a right-hand rail; on phones the same component becomes
 * a bottom sheet, because a right rail on a 390px viewport is a full-screen modal
 * with worse ergonomics.
 */

import { useEffect, useMemo, useState } from 'react';

import { DISTRACTION_KINDS, DISTRACTION_LABELS, formatDuration } from '@focusforge/core';

import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { Button, Field, IconButton, SelectField, Switch, TextArea, cn } from '../ui';

// ------------------------------------------------------------------- container

function PanelShell({
  title,
  detail,
  onClose,
  children,
  footer,
}: {
  title: string;
  detail?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end sm:items-stretch">
      <button
        type="button"
        aria-label="Close panel"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-void/50 sm:bg-void/40"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="false"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full animate-rise flex-col rounded-t-xl border border-line bg-surface shadow-pane sm:max-h-none sm:h-full sm:w-[26rem] sm:animate-none sm:rounded-none sm:border-y-0 sm:border-r-0"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-lead text-ink">{title}</h2>
            {detail && <p className="hint mt-0.5">{detail}</p>}
          </div>
          <IconButton label="Close panel" onClick={onClose}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 scroll-thin">{children}</div>
        {footer && <footer className="border-t border-line px-4 py-3">{footer}</footer>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ task panel

/**
 * Queue the next piece of work.
 *
 * Two ways in, because users arrive in two moods: "I know what I am doing next"
 * (pick from the list) and "I just thought of something" (create it here, which
 * also starts the session on it).
 */
export function TaskPanel() {
  const setPanel = useApp((state) => state.setPanel);
  const tasks = useApp((state) => state.tasks);
  const subjects = useApp(selectActiveSubjects);
  const createTask = useApp((state) => state.createTask);
  const updateTask = useApp((state) => state.updateTask);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);
  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [subjectId, setSubjectId] = useState(subjects[0]?._id ?? '');
  const [minutes, setMinutes] = useState(settings?.focusPresets?.[1]?.minutes ?? 25);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!subjectId && subjects[0]) setSubjectId(subjects[0]._id);
  }, [subjectId, subjects]);

  const open = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'todo' || task.status === 'in-progress')
        .filter((task) => (query ? task.title.toLowerCase().includes(query.toLowerCase()) : true))
        .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999')),
    [query, tasks],
  );

  const startOn = (taskId: string, taskSubject: string, estimated: number) => {
    setPanel('none');
    void timerActions.start({
      subjectId: taskSubject,
      taskId,
      plannedSeconds: estimated > 0 ? estimated : (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
      timeZone,
    });
  };

  return (
    <PanelShell
      title="Next up"
      detail="Pick something to work on, or add it here."
      onClose={() => setPanel('none')}
      footer={
        <Button variant={creating ? 'ghost' : 'secondary'} className="w-full" onClick={() => setCreating((value) => !value)}>
          {creating ? 'Cancel' : 'Add a task'}
        </Button>
      }
    >
      {creating ? (
        <div className="flex flex-col gap-3">
          <Field
            label="Task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Dynamic programming — 20 problems"
            autoFocus
            maxLength={200}
          />
          <SelectField label="Subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => (
              <option key={subject._id} value={subject._id}>
                {subject.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Estimate (min)"
              type="number"
              min={1}
              max={600}
              value={minutes}
              onChange={(event) => setMinutes(Number(event.target.value))}
            />
            <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </SelectField>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={!title.trim() || !subjectId}
              onClick={async () => {
                const result = await createTask({
                  title: title.trim(),
                  subjectId,
                  subject: subjectId,
                  priority,
                  estimatedDuration: Math.max(1, minutes) * 60,
                });
                if (!result.ok) {
                  toast({ tone: 'error', title: 'Could not save the task', detail: result.error.message });
                  return;
                }
                setTitle('');
                setCreating(false);
              }}
            >
              Save
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!title.trim() || !subjectId}
              onClick={async () => {
                const result = await createTask({
                  title: title.trim(),
                  subjectId,
                  subject: subjectId,
                  priority,
                  estimatedDuration: Math.max(1, minutes) * 60,
                });
                if (!result.ok) {
                  toast({ tone: 'error', title: 'Could not save the task', detail: result.error.message });
                  return;
                }
                const created = useApp.getState().tasks.find((task) => task.title === title.trim());
                setTitle('');
                setCreating(false);
                if (created) startOn(created._id, created.subject, created.estimatedDuration);
              }}
            >
              Save &amp; start
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter tasks…"
            aria-label="Filter tasks"
            className="field"
          />
          {open.length === 0 ? (
            <p className="hint py-6 text-center">
              {tasks.length === 0 ? 'No tasks yet. Add one to give the session a name.' : 'Nothing matches that filter.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {open.map((task) => {
                const subject = subjects.find((item) => item._id === task.subject);
                return (
                  <li key={task._id} className="flex items-stretch gap-1.5">
                    <button
                      type="button"
                      onClick={() => startOn(task._id, task.subject, task.estimatedDuration)}
                      className="group flex flex-1 items-center gap-3 rounded-md border border-line bg-raised px-3 py-2 text-left transition-colors duration-quick hover:border-accent/50"
                    >
                      <span
                        className="h-6 w-0.5 shrink-0 rounded-pill"
                        style={{ background: subject?.color ?? 'rgb(var(--faint))' }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-small text-ink">{task.title}</span>
                        <span className="mt-0.5 flex items-center gap-2 text-micro uppercase tracking-[0.06em] text-faint">
                          <span>{subject?.name ?? 'Unfiled'}</span>
                          <span aria-hidden="true">·</span>
                          <span className={task.priority === 'high' ? 'text-alert' : undefined}>{task.priority}</span>
                          {task.estimatedDuration > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{formatDuration(task.estimatedDuration, { style: 'short' })}</span>
                            </>
                          )}
                          {task.focusedSeconds > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-muted">{duration(task.focusedSeconds)} done</span>
                            </>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-micro text-ghost group-hover:text-accent">start</span>
                    </button>
                    <button
                      type="button"
                      title="Mark complete"
                      aria-label={`Mark ${task.title} complete`}
                      onClick={() => void updateTask(task._id, { status: 'completed' })}
                      className="flex w-9 items-center justify-center rounded-md border border-line text-ghost transition-colors hover:border-good/50 hover:text-good"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function priorityRank(priority: string): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
}

// ------------------------------------------------------------ distraction panel

export function DistractionPanel() {
  const setPanel = useApp((state) => state.setPanel);
  const record = timerActions.recordDistraction;
  const { phase, distractionCount } = useTimer();
  const [justLogged, setJustLogged] = useState<string | null>(null);

  const live = phase === 'focus' || phase === 'paused' || phase === 'break';

  return (
    <PanelShell
      title="Something pulled you away"
      detail={
        live
          ? 'Logging this is not a punishment — it is the measurement that makes the pattern visible.'
          : 'Start a session to log distractions against it.'
      }
      onClose={() => setPanel('none')}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-line bg-sunken px-3.5 py-3">
          <p className="label">This session</p>
          <p className="mt-1 font-mono text-lead text-ink numeric-stable">
            {distractionCount} interruption{distractionCount === 1 ? '' : 's'}
          </p>
          <p className="hint mt-1">
            {distractionCount === 0
              ? 'Nothing recorded yet. That is the ideal number.'
              : 'Counted against the focus score, weighted by how many happened per hour.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {DISTRACTION_KINDS.map((kind) => {
            const meta = DISTRACTION_LABELS[kind] ?? { label: kind, short: kind };
            const flashed = justLogged === kind;
            return (
              <button
                key={kind}
                type="button"
                disabled={!live}
                onClick={() => {
                  record(kind);
                  setJustLogged(kind);
                  setTimeout(() => setJustLogged((value) => (value === kind ? null : value)), 900);
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-all duration-quick',
                  flashed ? 'border-accent bg-accent/10' : 'border-line bg-raised hover:border-faint',
                  !live && 'opacity-40',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border font-mono text-micro',
                    flashed ? 'border-accent/60 text-accent' : 'border-edge text-faint',
                  )}
                  aria-hidden="true"
                >
                  {meta.short.slice(0, 3)}
                </span>
                <span className="truncate text-small text-muted">{meta.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </PanelShell>
  );
}

// -------------------------------------------------------------- session panel

/**
 * The end-of-session confirmation.
 *
 * This is the only place in the product that asks the user for input while
 * something is running, and the copy is careful about it: ending early is
 * recorded as an *interruption*, not a failure, because the analytics can only be
 * useful if people are honest with it.
 */
export function SessionPanel({ onStartNew }: { onStartNew: () => void }) {
  const setPanel = useApp((state) => state.setPanel);
  const settings = useApp((state) => state.settings);
  const subject = useApp((state) => state.subjects.find((item) => item._id === state.overview?.openRecord?.subjectId) ?? null);
  const tasks = useApp((state) => state.tasks);
  const snapshot = useTimer();

  const [reflection, setReflection] = useState('');
  const [endEarly, setEndEarly] = useState(false);
  const [busy, setBusy] = useState(false);

  const taskTitle = tasks.find((task) => task._id === snapshot.taskId)?.title ?? null;
  const reachedPlan = snapshot.plannedSeconds > 0 && snapshot.focusedSeconds >= snapshot.plannedSeconds;
  const live = snapshot.phase === 'focus' || snapshot.phase === 'paused' || snapshot.phase === 'break';

  const finish = async (status: 'completed' | 'interrupted' | 'cancelled') => {
    setBusy(true);
    await timerActions.finish({ status, reflection: reflection.trim() || null });
    await timerActions.clear();
    setBusy(false);
    setPanel('none');
    setReflection('');
    void useApp.getState().refreshAll();
  };

  return (
    <PanelShell
      title={live ? 'End this session?' : 'Session recorded'}
      detail={live ? 'Everything up to this moment is already saved.' : 'Here is what was captured.'}
      onClose={() => {
        if (!live) {
          void timerActions.clear();
          void useApp.getState().refreshAll();
        }
        setPanel('none');
      }}
      footer={
        live ? (
          <div className="flex flex-col gap-2">
            {endEarly ? (
              <>
                <Button variant="danger" loading={busy} onClick={() => void finish('cancelled')}>
                  Discard this session
                </Button>
                <Button variant="ghost" onClick={() => setEndEarly(false)}>
                  Keep going instead
                </Button>
              </>
            ) : (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={() => setPanel('none')} disabled={busy}>
                  Keep focusing
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  loading={busy}
                  onClick={() => void finish(reachedPlan ? 'completed' : 'interrupted')}
                >
                  {reachedPlan ? 'Complete session' : 'End session'}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                void timerActions.clear();
                setPanel('none');
                void useApp.getState().refreshAll();
              }}
            >
              Close
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                void timerActions.clear();
                setPanel('none');
                onStartNew();
              }}
            >
              Start another
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line bg-sunken px-3.5 py-3">
          <Stat label="Focused" value={formatDuration(snapshot.focusedSeconds, { style: 'clock' })} />
          <Stat label="Planned" value={snapshot.plannedSeconds > 0 ? formatDuration(snapshot.plannedSeconds, { style: 'clock' }) : '—'} />
          <Stat label="Break" value={formatDuration(snapshot.breakSeconds, { style: 'clock' })} />
          <Stat label="Paused" value={formatDuration(snapshot.pausedSeconds, { style: 'clock' })} />
          <Stat label="Interruptions" value={String(snapshot.pauseCount)} />
          <Stat label="Distractions" value={String(snapshot.distractionCount)} />
        </div>

        {(subject || taskTitle) && (
          <div className="flex flex-col gap-1">
            <p className="label">Filed under</p>
            <p className="text-small text-ink">
              {subject?.name ?? 'No subject'}
              {taskTitle ? ` · ${taskTitle}` : ''}
            </p>
          </div>
        )}

        {!reachedPlan && live && (
          <p className="rounded-md border border-pause/30 bg-pause/[0.06] px-3 py-2.5 text-small text-muted">
            You are {formatDuration(Math.max(0, snapshot.plannedSeconds - snapshot.focusedSeconds), { style: 'short' })} short of the
            planned {formatDuration(snapshot.plannedSeconds, { style: 'short' })}. Ending now records this as an interruption — it
            still counts, and it is still useful data.
          </p>
        )}

        {live && (
          <>
            <TextArea
              label="What happened? (optional)"
              rows={3}
              maxLength={500}
              value={reflection}
              onChange={(event) => setReflection(event.target.value)}
              placeholder="Short note to your future self — what you got through, what blocked you."
            />
            <div className="flex items-center justify-between">
              <p className="hint">Stored with the session, visible only to you.</p>
              <Button variant="ghost" size="sm" onClick={() => setEndEarly(true)}>
                Need to discard it?
              </Button>
            </div>
          </>
        )}

        {settings?.confirmEarlyEnd === false && live && (
          <Switch
            checked={false}
            onChange={() => {}}
            label="Early-end confirmation"
            description="You turned off the confirmation prompt in settings, so the buttons above act immediately."
            disabled
          />
        )}
      </div>
    </PanelShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-0.5 font-mono text-small text-ink numeric-stable">{value}</p>
    </div>
  );
}
