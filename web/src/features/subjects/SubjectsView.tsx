/**
 * Subjects.
 *
 * A subject is not a folder — it is the unit the analytics compare against. Each
 * one carries a colour (which paints the Core and every chart), a weekly and
 * monthly target, and its own accumulated time. So this screen leads with what each
 * subject has actually earned, not with its settings.
 *
 * Destructive actions are handled properly: archiving is offered first, because
 * deleting a subject with three months of history behind it is the kind of
 * irreversible action a productivity tool should make you think about. If a delete
 * is genuinely wanted, the dialog offers to move the sessions to another subject
 * rather than silently orphaning them.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { usePeriodAnalytics } from '../../data/queries';
import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { Button, EmptyState, Field, Modal, ProgressBar, SectionHeading, Skeleton, Switch, cn } from '../../components/ui';
import type { SubjectDto } from '../../lib/api';

/**
 * The colour palette.
 *
 * Eight hues that survive being shown as a 2px dot, as a stacked bar, and as a
 * full-bleed ring behind the timer. They are deliberately distinct in *luminance*
 * as well as hue, because roughly one in twelve men cannot reliably separate the
 * greens from the reds.
 */
const SUBJECT_COLORS = ['#5eead4', '#818cf8', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24', '#34d399'];

/** Glyph icons rather than an icon font: they render identically everywhere. */
const SUBJECT_ICONS = ['◈', '{}', '◎', '⬡', '∑', '∿', '≡', '✦', '▤', '⌘', 'λ', '◇'];

export function SubjectsView() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const allSubjects = useApp((state) => state.subjects);
  const loading = useApp((state) => state.loading.subjects);
  const createSubject = useApp((state) => state.createSubject);
  const updateSubject = useApp((state) => state.updateSubject);
  const archiveSubject = useApp((state) => state.archiveSubject);
  const deleteSubject = useApp((state) => state.deleteSubject);
  const loadSubjects = useApp((state) => state.loadSubjects);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);

  const { data: week } = usePeriodAnalytics({ period: 'week' });
  const { data: month } = usePeriodAnalytics({ period: 'month' });

  const active = useApp(selectActiveSubjects);
  const archived = useMemo(() => allSubjects.filter((subject) => subject.archivedAt), [allSubjects]);

  const [editing, setEditing] = useState<SubjectDto | null>(null);
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [deleting, setDeleting] = useState<SubjectDto | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /**
   * Subject totals come from the period summaries rather than being recomputed
   * here, so the number on this screen is the same number the insights room shows.
   */
  const totals = useMemo(() => {
    const map = new Map<string, { week: number; month: number; weekSessions: number; monthSessions: number }>();
    for (const entry of week?.summary.subjects ?? []) {
      map.set(entry.subjectId, { week: entry.focusedSeconds, month: 0, weekSessions: entry.sessionCount, monthSessions: 0 });
    }
    for (const entry of month?.summary.subjects ?? []) {
      const existing = map.get(entry.subjectId) ?? { week: 0, month: 0, weekSessions: 0, monthSessions: 0 };
      map.set(entry.subjectId, { ...existing, month: entry.focusedSeconds, monthSessions: entry.sessionCount });
    }
    return map;
  }, [week, month]);

  // Close the "new subject" modal by cleaning the URL, so a reload does not
  // re-open it and the back button behaves.
  useEffect(() => {
    if (creating) return;
    if (params.get('new') === '1') {
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [creating, params, setParams]);

  return (
    <>
      <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-head text-ink">Subjects</h1>
            <p className="hint mt-1 max-w-2xl">
              The buckets your hours land in. A subject's colour paints the focus instrument and every chart, and its target is what the
              weekly comparison measures against.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New subject
          </Button>
        </div>

        {loading && allSubjects.length === 0 ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : active.length === 0 ? (
          <EmptyState
            title="No subjects yet"
            detail="Name the first thing you are trying to get good at. Everything else — the ring's colour, the weekly comparison, the subject distribution — follows from this one decision."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create a subject
                </Button>
                <Button variant="ghost" onClick={() => navigate('/')}>
                  Start a session anyway
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {active.map((subject) => {
              const stat = totals.get(subject._id);
              const weekRatio = subject.weeklyTargetSeconds > 0 ? Math.min(1, (stat?.week ?? 0) / subject.weeklyTargetSeconds) : null;

              return (
                <li key={subject._id} className="rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subject.color }} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-lead text-ink">{subject.name}</h2>
                      {subject.description && <p className="mt-0.5 text-small text-muted">{subject.description}</p>}
                      <p className="mt-1 font-mono text-micro uppercase tracking-[0.06em] text-faint">
                        this week {duration(stat?.week ?? 0)} · this month {duration(stat?.month ?? 0)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(subject)}>
                        Edit
                      </Button>
                    </div>
                  </div>

                  {weekRatio !== null && (
                    <div className="mt-3.5">
                      <div className="flex items-baseline justify-between">
                        <span className="label">Weekly target</span>
                        <span className="font-mono text-micro text-muted">
                          {duration(stat?.week ?? 0)} / {duration(subject.weeklyTargetSeconds)}
                        </span>
                      </div>
                      <div className="mt-1.5">
                        <ProgressBar value={weekRatio} />
                      </div>
                    </div>
                  )}

                  <div className="mt-3.5 flex items-center justify-between border-t border-line pt-3">
                    <span className="font-mono text-micro text-ghost">
                      {stat?.monthSessions ?? 0} session{stat?.monthSessions === 1 ? '' : 's'} this month
                    </span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => void archiveSubject(subject._id, true)}>
                        Archive
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleting(subject)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {archived.length > 0 && (
          <section>
            <SectionHeading
              title="Archived"
              detail="Archived subjects keep their history and disappear from the pickers, the ring and the active totals."
              action={
                <Switch
                  checked={showArchived}
                  onChange={(next) => {
                    setShowArchived(next);
                    if (!next) return;
                    void loadSubjects();
                  }}
                  label="Show archived subjects"
                />
              }
            />
            {(showArchived || archived.length <= 3) && (
              <ul className="mt-3 divide-y divide-line/70 rounded-lg border border-line bg-surface/40 px-4">
                {archived.map((subject) => (
                  <li key={subject._id} className="flex items-center gap-3 py-3">
                    <span className="h-2 w-2 shrink-0 rounded-full opacity-50" style={{ background: subject.color }} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-small text-muted">{subject.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => void archiveSubject(subject._id, false)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>

      <SubjectForm
        open={creating || editing !== null}
        subject={editing}
        existingNames={allSubjects.map((subject) => subject.name)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={async (values, id) => {
          const result = id ? await updateSubject(id, values) : await createSubject(values);
          if (!result.ok) {
            toast({
              tone: 'error',
              title: id ? 'Could not save the subject' : 'Could not create the subject',
              detail: result.error.fields ? Object.values(result.error.fields)[0] : result.error.message,
            });
            return false;
          }
          toast({ tone: 'success', title: id ? 'Subject updated' : `${values.name} is ready` });
          await useApp.getState().loadSubjects();
          setCreating(false);
          setEditing(null);
          return true;
        }}
        defaultColorIndex={active.length}
        defaultDailyTargetMinutes={Math.round((settings?.dailyGoalSeconds ?? 7200) / 60)}
      />

      <DeleteSubjectModal
        subject={deleting}
        others={active.filter((subject) => subject._id !== deleting?._id)}
        onClose={() => setDeleting(null)}
        onConfirm={async (options) => {
          if (!deleting) return;
          const result = await deleteSubject(deleting._id, options);
          if (!result.ok) {
            toast({ tone: 'error', title: 'Could not delete the subject', detail: result.error.message });
            return;
          }
          toast({ tone: 'success', title: `${deleting.name} deleted`, detail: options.reassignTo ? 'Its sessions were moved.' : 'Its sessions were removed.' });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ------------------------------------------------------------------ the form

function SubjectForm({
  open,
  subject,
  existingNames,
  onClose,
  onSubmit,
  defaultColorIndex,
  defaultDailyTargetMinutes,
}: {
  open: boolean;
  subject: SubjectDto | null;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>, id?: string) => Promise<boolean>;
  defaultColorIndex: number;
  defaultDailyTargetMinutes: number;
}) {
  const colors = SUBJECT_COLORS;
  const icons = SUBJECT_ICONS;

  const [name, setName] = useState(subject?.name ?? '');
  const [description, setDescription] = useState(subject?.description ?? '');
  const [color, setColor] = useState(subject?.color ?? colors[defaultColorIndex % colors.length]);
  const [icon, setIcon] = useState(subject?.icon ?? icons[0]);
  const [weeklyHours, setWeeklyHours] = useState(
    subject ? Math.round((subject.weeklyTargetSeconds / 3600) * 10) / 10 : Math.round((defaultDailyTargetMinutes * 5) / 60),
  );
  const [monthlyHours, setMonthlyHours] = useState(
    subject ? Math.round((subject.monthlyTargetSeconds / 3600) * 10) / 10 : Math.round((defaultDailyTargetMinutes * 21) / 60),
  );
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // Re-seed whenever a different subject is opened, so the dialog never shows the
  // previous subject's values.
  useEffect(() => {
    if (!open) return;
    setName(subject?.name ?? '');
    setDescription(subject?.description ?? '');
    setColor(subject?.color ?? colors[defaultColorIndex % colors.length]);
    setIcon(subject?.icon ?? icons[0]);
    setWeeklyHours(subject ? Math.round((subject.weeklyTargetSeconds / 3600) * 10) / 10 : Math.round((defaultDailyTargetMinutes * 5) / 60));
    setMonthlyHours(
      subject ? Math.round((subject.monthlyTargetSeconds / 3600) * 10) / 10 : Math.round((defaultDailyTargetMinutes * 21) / 60),
    );
    setNameError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject?._id]);

  const duplicate =
    name.trim().length > 0 &&
    existingNames.some((existing) => existing.toLowerCase() === name.trim().toLowerCase() && existing.toLowerCase() !== (subject?.name ?? '').toLowerCase());

  const submit = async () => {
    if (duplicate) {
      setNameError('You already have a subject with that name.');
      return;
    }
    setBusy(true);
    const ok = await onSubmit(
      {
        name: name.trim(),
        description: description.trim(),
        color,
        icon,
        weeklyTargetSeconds: Math.max(0, Math.round(weeklyHours * 3600)),
        monthlyTargetSeconds: Math.max(0, Math.round(monthlyHours * 3600)),
      },
      subject?._id,
    );
    setBusy(false);
    if (!ok) setNameError('The server rejected that. Check the name and try again.');
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject ? `Edit ${subject.name}` : 'New subject'}
      description={
        subject
          ? 'Changing the colour repaints the instrument on every device.'
          : 'A subject is the unit your analytics compare. Give it a colour you can recognise across a room.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={name.trim().length === 0} onClick={() => void submit()}>
            {subject ? 'Save changes' : 'Create subject'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          placeholder="DSA"
          maxLength={60}
          autoFocus
          error={nameError ?? (duplicate ? 'You already have a subject with that name.' : undefined)}
        />

        <Field
          label="Description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Graphs, trees, and the 200 problems I keep postponing"
          maxLength={200}
          hint="Optional. Appears under the subject name on the ring."
        />

        <div>
          <p className="label">Colour</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {colors.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use colour ${swatch}`}
                aria-pressed={color === swatch}
                onClick={() => setColor(swatch)}
                className={cn(
                  'h-7 w-7 rounded-md border transition-transform duration-quick',
                  color === swatch ? 'scale-110 border-ink' : 'border-transparent hover:scale-105',
                )}
                style={{ background: swatch }}
              />
            ))}
            <label className="flex h-7 items-center gap-2 rounded-md border border-line px-2 text-micro text-faint">
              custom
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                aria-label="Pick a custom colour"
              />
            </label>
          </div>
        </div>

        <div>
          <p className="label">Icon</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {icons.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={icon === option}
                onClick={() => setIcon(option)}
                className={cn(
                  'rounded-md border px-2.5 py-1 font-mono text-micro transition-colors duration-quick',
                  icon === option ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-faint hover:text-muted',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Weekly target (hours)"
            type="number"
            min={0}
            max={168}
            step={0.5}
            value={weeklyHours}
            onChange={(event) => setWeeklyHours(Number(event.target.value))}
          />
          <Field
            label="Monthly target (hours)"
            type="number"
            min={0}
            max={744}
            step={1}
            value={monthlyHours}
            onChange={(event) => setMonthlyHours(Number(event.target.value))}
          />
        </div>
        <p className="hint">
          Targets are used for the weekly comparison and the "behind this week" strip. Set zero to opt out — nothing else breaks.
        </p>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ deletion

/**
 * Deleting a subject is the one genuinely destructive action in the product, so
 * the dialog leads with the consequence and offers the safer path first.
 */
function DeleteSubjectModal({
  subject,
  others,
  onClose,
  onConfirm,
}: {
  subject: SubjectDto | null;
  others: SubjectDto[];
  onClose: () => void;
  onConfirm: (options: { reassignTo?: string; confirm: string }) => Promise<void>;
}) {
  const [reassignTo, setReassignTo] = useState<string>('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReassignTo('');
    setConfirm('');
  }, [subject?._id]);

  if (!subject) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete ${subject.name}?`}
      description="This cannot be undone. Archived instead is offered on the subject card if you simply want it out of the way."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={confirm.trim().toUpperCase() !== 'DELETE'}
            onClick={async () => {
              setBusy(true);
              await onConfirm({ ...(reassignTo ? { reassignTo } : {}), confirm: 'DELETE' });
              setBusy(false);
            }}
          >
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-small text-muted">
          Every session filed under {subject.name} will be removed from your totals, streaks and achievements. Your other subjects keep
          their history.
        </p>

        {others.length > 0 && (
          <div>
            <label htmlFor="reassign" className="label">
              Move its sessions to
            </label>
            <select
              id="reassign"
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
              className="field mt-1.5"
            >
              <option value="">Delete the sessions too</option>
              {others.map((option) => (
                <option key={option._id} value={option._id}>
                  {option.name}
                </option>
              ))}
            </select>
            <p className="hint mt-1.5">
              Moving them keeps your recorded hours and recomputes the distribution — the honest option if this is a rename rather than a
              change of plan.
            </p>
          </div>
        )}

        <Field
          label="Type DELETE to confirm"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />
      </div>
    </Modal>
  );
}

