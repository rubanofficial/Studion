/**
 * Tasks.
 *
 * A task exists for one reason: to give a focus session a name. So the list is
 * built around "start this now", and each row carries the total time already spent
 * on it — which is the single most useful thing to know about a task you have been
 * circling for a week.
 *
 * Grouped by status rather than sorted by date, because the question at a glance is
 * "what am I actually working on", not "what is chronologically next".
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { timerActions } from '../../store/timer';
import { Button, EmptyState, Field, Modal, SelectField, Skeleton, TextArea, cn } from '../../components/ui';
import type { TaskDto } from '../../lib/api';

type StatusFilter = 'open' | 'todo' | 'in-progress' | 'completed' | 'skipped' | 'all';

const STATUS_LABELS: Record<string, string> = {
  todo: 'Not started',
  'in-progress': 'In progress',
  completed: 'Completed',
  skipped: 'Skipped',
};

export function TasksView() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const tasks = useApp((state) => state.tasks);
  const subjects = useApp(selectActiveSubjects);
  const loading = useApp((state) => state.loading.tasks);
  const createTask = useApp((state) => state.createTask);
  const updateTask = useApp((state) => state.updateTask);
  const deleteTask = useApp((state) => state.deleteTask);
  const loadTasks = useApp((state) => state.loadTasks);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [status, setStatus] = useState<StatusFilter>('open');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<TaskDto | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (creating || params.get('new') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [creating, params, setParams]);

  const filtered = useMemo(() => {
    return tasks
      .filter((task) => {
        if (status === 'open') return task.status === 'todo' || task.status === 'in-progress';
        if (status === 'all') return true;
        return task.status === status;
      })
      .filter((task) => (subjectFilter ? task.subject === subjectFilter : true))
      .filter((task) => (query ? task.title.toLowerCase().includes(query.toLowerCase()) : true))
      .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
  }, [tasks, status, subjectFilter, query]);

  const grouped = useMemo(() => {
    const buckets = new Map<string, TaskDto[]>();
    for (const task of filtered) {
      const bucket = buckets.get(task.status) ?? [];
      bucket.push(task);
      buckets.set(task.status, bucket);
    }
    return buckets;
  }, [filtered]);

  const openCount = tasks.filter((task) => task.status === 'todo' || task.status === 'in-progress').length;

  const start = (task: TaskDto) => {
    void timerActions.start({
      subjectId: task.subject,
      taskId: task._id,
      plannedSeconds: task.estimatedDuration > 0 ? task.estimatedDuration : (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
      timeZone,
    });
    toast({ tone: 'info', title: `Focusing on ${task.title}`, detail: 'The cockpit is live. Press space to pause.' });
    void navigate('/');
  };

  return (
    <>
      <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-head text-ink">Tasks</h1>
            <p className="hint mt-1">
              {openCount} open. Each task carries the time already spent on it, because that is usually the surprising number.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)} disabled={subjects.length === 0}>
            New task
          </Button>
        </div>

        {subjects.length === 0 && (
          <p className="rounded-md border border-pause/30 bg-pause/[0.06] px-3.5 py-2.5 text-small text-muted">
            A task has to belong to a subject. Create one first and this screen becomes usable.{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => void navigate('/subjects?new=1')}>
              Create a subject →
            </button>
          </p>
        )}

        {/* ------------------------------------------------------------- filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {(['open', 'todo', 'in-progress', 'completed', 'skipped', 'all'] as StatusFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={status === value}
                onClick={() => setStatus(value)}
                className={cn(
                  'rounded-pill border px-3 py-1.5 text-tiny transition-colors duration-quick',
                  status === value ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-faint hover:border-faint hover:text-muted',
                )}
              >
                {value === 'open' ? 'Open' : value === 'all' ? 'All' : STATUS_LABELS[value]}
              </button>
            ))}
          </div>

          <div className="flex flex-1 items-center gap-2">
            {subjects.length > 1 && (
              <select
                aria-label="Filter by subject"
                value={subjectFilter}
                onChange={(event) => setSubjectFilter(event.target.value)}
                className="field w-auto py-1.5 text-tiny"
              >
                <option value="">All subjects</option>
                {subjects.map((subject) => (
                  <option key={subject._id} value={subject._id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            )}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles…"
              aria-label="Search tasks"
              className="field flex-1 py-1.5 text-tiny"
            />
          </div>
        </div>

        {/* --------------------------------------------------------------- list */}
        {loading && tasks.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={tasks.length === 0 ? 'No tasks yet' : 'Nothing matches these filters'}
            detail={
              tasks.length === 0
                ? 'A task is optional — you can start a session on a subject alone. But naming the work makes the analytics more useful later.'
                : 'Try a different status or clear the search.'
            }
            action={
              tasks.length === 0 ? (
                <Button variant="primary" onClick={() => setCreating(true)} disabled={subjects.length === 0}>
                  Add the first task
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStatus('open');
                    setSubjectFilter('');
                    setQuery('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <div className="flex flex-col gap-7">
            {[...grouped.entries()].map(([groupStatus, groupTasks]) => (
              <section key={groupStatus}>
                <h2 className="label mb-2.5">
                  {STATUS_LABELS[groupStatus] ?? groupStatus} · {groupTasks.length}
                </h2>
                <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface/40 px-4">
                  {groupTasks.map((task) => {
                    const subject = subjects.find((item) => item._id === task.subject);
                    return (
                      <li key={task._id} className="flex items-center gap-3 py-3">
                        <span className="h-7 w-0.5 shrink-0 rounded-pill" style={{ background: subject?.color ?? 'rgb(var(--faint))' }} aria-hidden="true" />

                        <div className="min-w-0 flex-1">
                          <p className={cn('truncate text-small', task.status === 'completed' ? 'text-faint line-through' : 'text-ink')}>
                            {task.title}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-micro uppercase tracking-[0.06em] text-faint">
                            <span>{subject?.name ?? 'Unfiled'}</span>
                            <span className={task.priority === 'high' ? 'text-alert' : undefined}>{task.priority}</span>
                            {task.estimatedDuration > 0 && <span>{duration(task.estimatedDuration)} away</span>}
                            {task.focusedSeconds > 0 && <span className="text-muted">{duration(task.focusedSeconds)} recorded</span>}
                            {task.sessionCount > 0 && <span>{task.sessionCount} sessions</span>}
                            {task.dueAt && <span>{formatDue(task.dueAt, timeZone)}</span>}
                          </p>
                        </div>

                        {task.status !== 'completed' && (
                          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => start(task)}>
                            Focus
                          </Button>
                        )}
                        <select
                          aria-label={`Change status for ${task.title}`}
                          value={task.status}
                          onChange={(event) => void updateTask(task._id, { status: event.target.value })}
                          className="field w-auto shrink-0 py-1 text-tiny"
                        >
                          {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setEditing(task)}>
                          Edit
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <TaskForm
        open={creating || editing !== null}
        task={editing}
        defaultSubjectId={subjects[0]?._id ?? ''}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={async (values, id) => {
          const result = id ? await updateTask(id, values) : await createTask(values);
          if (!result.ok) {
            toast({
              tone: 'error',
              title: id ? 'Could not save the task' : 'Could not create the task',
              detail: result.error.fields ? Object.values(result.error.fields)[0] : result.error.message,
            });
            return false;
          }
          toast({ tone: 'success', title: id ? 'Task updated' : 'Task added' });
          setCreating(false);
          setEditing(null);
          return true;
        }}
        onDelete={
          editing
            ? async () => {
                const result = await deleteTask(editing._id);
                if (!result.ok) {
                  toast({ tone: 'error', title: 'Could not delete the task', detail: result.error.message });
                  return;
                }
                toast({ tone: 'success', title: 'Task deleted' });
                setEditing(null);
              }
            : undefined
        }
      />
    </>
  );
}

function priorityRank(priority: string): number {
  return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
}

function formatDue(dueAt: string, timeZone: string): string {
  const ms = Date.parse(dueAt);
  if (!Number.isFinite(ms)) return '';
  const overdue = ms < Date.now();
  const formatted = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }).format(new Date(ms));
  return overdue ? `due ${formatted} (overdue)` : `due ${formatted}`;
}

// -------------------------------------------------------------------- the form

function TaskForm({
  open,
  task,
  defaultSubjectId,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  task: TaskDto | null;
  defaultSubjectId: string;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>, id?: string) => Promise<boolean>;
  onDelete?: () => Promise<void>;
}) {
  const subjects = useApp(selectActiveSubjects);
  const settings = useApp((state) => state.settings);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subjectId, setSubjectId] = useState(defaultSubjectId);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [minutes, setMinutes] = useState(settings?.focusPresets?.[1]?.minutes ?? 25);
  const [dueAt, setDueAt] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setSubjectId(task?.subject ?? defaultSubjectId);
    setPriority((task?.priority as 'low' | 'medium' | 'high') ?? 'medium');
    setMinutes(task && task.estimatedDuration > 0 ? Math.round(task.estimatedDuration / 60) : settings?.focusPresets?.[1]?.minutes ?? 25);
    setDueAt(task?.dueAt ? task.dueAt.slice(0, 10) : '');
    setTags((task?.tags ?? []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?._id]);

  const submit = async () => {
    setBusy(true);
    await onSubmit(
      {
        title: title.trim(),
        description: description.trim(),
        subjectId,
        subject: subjectId,
        priority,
        estimatedDuration: Math.max(0, Math.round(minutes * 60)),
        ...(dueAt ? { dueAt: new Date(`${dueAt}T23:59:00`).toISOString() } : {}),
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 10),
      },
      task?._id,
    );
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Edit task' : 'New task'}
      description={task ? undefined : 'Keep it small enough to finish in one sitting. You can always add another.'}
      footer={
        <>
          {onDelete && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                if (window.confirm('Delete this task? Sessions already recorded against it keep their time but lose the label.')) {
                  void onDelete();
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!title.trim() || !subjectId} onClick={() => void submit()}>
            {task ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Task"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Dynamic programming — 20 problems"
          maxLength={200}
          autoFocus
        />

        <TextArea
          label="Notes"
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="What exactly counts as done?"
          maxLength={800}
        />

        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Subject" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
            {subjects.map((subject) => (
              <option key={subject._id} value={subject._id}>
                {subject.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </SelectField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Session estimate (min)"
            type="number"
            min={0}
            max={600}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            hint="Used as the planned duration when you start from this task."
          />
          <Field
            label="Deadline"
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            hint="Optional. Only used for the due-soon list."
          />
        </div>

        <Field
          label="Tags"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="graphs, revision, interview"
          hint="Comma separated. Tags are searchable in the command palette."
        />
      </div>
    </Modal>
  );
}
