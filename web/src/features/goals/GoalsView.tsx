/**
 * Goals.
 *
 * A goal is a target for a period, optionally scoped to a subject. The screen is
 * built around the *pace* rather than the raw percentage, because 40% of a month
 * on the 8th is ahead and 40% of a week on a Friday is behind — the same number,
 * opposite meanings.
 *
 * The copy follows the product's rule: it states where you are and what remains,
 * and never scolds. "Two hours behind schedule" is information; "you are falling
 * behind" is a verdict.
 */

import { useEffect, useMemo, useState } from 'react';

import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { Button, EmptyState, Field, Modal, ProgressBar, SectionHeading, Skeleton, SelectField, StatRow, cn } from '../../components/ui';
import type { GoalDto } from '../../lib/api';

const PERIODS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

export function GoalsView() {
  const goals = useApp((state) => state.goals);
  const goalStatus = useApp((state) => state.goalStatus);
  const loading = useApp((state) => state.loading.goals);
  const loadGoals = useApp((state) => state.loadGoals);
  const saveGoal = useApp((state) => state.saveGoal);
  const deleteGoal = useApp((state) => state.deleteGoal);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);

  const [editing, setEditing] = useState<GoalDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<GoalDto | null>(null);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  const grouped = useMemo(() => {
    const map = new Map<string, GoalDto[]>();
    for (const goal of goals) {
      const bucket = map.get(goal.period) ?? [];
      bucket.push(goal);
      map.set(goal.period, bucket);
    }
    return map;
  }, [goals]);

  const hasDailyGoal = goals.some((goal) => goal.period === 'daily' && goal.subjectId === null);

  return (
    <>
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-head text-ink">Goals</h1>
            <p className="hint mt-1 max-w-2xl">
              Targets for the periods you actually think in. A goal with no subject applies to everything; a goal with a subject measures
              only that subject's recorded time.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New goal
          </Button>
        </div>

        {/* The overall state, stated once, factually. */}
        {goalStatus && goals.length > 0 && (
          <p
            className={cn(
              'rounded-lg border px-4 py-3 text-small',
              goalStatus.anyMet ? 'border-good/30 bg-good/[0.05] text-muted' : 'border-line bg-surface/50 text-muted',
            )}
          >
            {goalStatus.anyMet
              ? 'At least one goal is met for the current period. Everything past this point is ahead of plan.'
              : "No goal is met yet for the current period. That is the normal state for most of a period — the pace line below is the useful reading."}
          </p>
        )}

        {loading && goals.length === 0 ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : goals.length === 0 ? (
          <EmptyState
            title="No goals yet"
            detail={
              hasDailyGoal
                ? 'Set a target for a week or a subject.'
                : 'A daily goal is the most useful one to start with — the cockpit ring and the streak both use it. Make it something true on an ordinary day.'
            }
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Set your first goal
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-8">
            {PERIODS.map((period) => {
              const list = grouped.get(period.value) ?? [];
              if (list.length === 0) return null;
              return (
                <section key={period.value}>
                  <SectionHeading title={period.label} detail={`${list.length} goal${list.length === 1 ? '' : 's'} for the current period`} />
                  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                    {list.map((goal) => (
                      <GoalCard key={goal.id} goal={goal} onEdit={() => setEditing(goal)} onRemove={() => setRemoving(goal)} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {settings && (
          <section className="rounded-lg border border-line bg-surface/40 px-4 py-4">
            <SectionHeading
              title="How a day counts"
              detail="The streak threshold is separate from the daily goal on purpose: the goal measures a good day, the threshold measures showing up."
            />
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-sunken px-3.5 py-3">
                <p className="label">Daily goal</p>
                <p className="mt-1 font-mono text-lead text-ink">{duration(settings.dailyGoalSeconds)}</p>
                <p className="hint mt-1">Used by the cockpit ring and the effective daily goal.</p>
              </div>
              <div className="rounded-md border border-line bg-sunken px-3.5 py-3">
                <p className="label">Streak threshold</p>
                <p className="mt-1 font-mono text-lead text-ink">{duration(settings.successThresholdSeconds)}</p>
                <p className="hint mt-1">A day counts towards a run at this much recorded focus.</p>
              </div>
            </div>
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => void useApp.getState().loadGoals()}>
                Recalculate
              </Button>
            </div>
          </section>
        )}
      </div>

      <GoalForm
        open={creating || editing !== null}
        goal={editing}
        defaultDailySeconds={settings?.dailyGoalSeconds ?? 7200}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={async (values) => {
          const result = await saveGoal(values);
          if (!result.ok) {
            toast({
              tone: 'error',
              title: 'Could not save the goal',
              detail: result.error.fields ? Object.values(result.error.fields)[0] : result.error.message,
            });
            return false;
          }
          toast({ tone: 'success', title: 'Goal saved' });
          setCreating(false);
          setEditing(null);
          return true;
        }}
      />

      {removing && (
        <Modal
          open
          onClose={() => setRemoving(null)}
          title="Remove this goal?"
          size="sm"
          description="Removing a goal does not touch any recorded session — it only stops the progress bar being shown."
          footer={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const result = await deleteGoal(removing.id);
                  if (!result.ok) {
                    toast({ tone: 'error', title: 'Could not remove the goal', detail: result.error.message });
                    return;
                  }
                  toast({ tone: 'success', title: 'Goal removed' });
                  setRemoving(null);
                }}
              >
                Remove goal
              </Button>
            </>
          }
        >
          <p className="text-small text-muted">
            {removing.label} — {duration(removing.targetSeconds)} {removing.period}.
          </p>
        </Modal>
      )}
    </>
  );
}

/**
 * One goal.
 *
 * Shows the achieved figure, the pace figure, and the honest difference between
 * them. The pace line is what makes this more than a progress bar: it answers
 * "am I on schedule", which a percentage alone cannot.
 */
function GoalCard({ goal, onEdit, onRemove }: { goal: GoalDto; onEdit: () => void; onRemove: () => void }) {
  const behind = goal.expectedSeconds !== null && goal.focusedSeconds < goal.expectedSeconds;
  const paceRatio = goal.paceRatio;

  return (
    <li className="rounded-lg border border-line bg-surface/50 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lead text-ink">{goal.label}</h3>
          <p className="mt-0.5 font-mono text-micro uppercase tracking-[0.06em] text-faint">
            {goal.period} · {goal.periodFromKey}
            {goal.periodToKey !== goal.periodFromKey ? ` → ${goal.periodToKey}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <div className="relative mt-4">
        <ProgressBar value={goal.progress} />
        {/* The pace marker: where you would be if the time were spread evenly. */}
        {paceRatio !== null && (
          <span
            className="absolute -top-1 h-3 w-px bg-ink/50"
            style={{ left: `${Math.min(100, Math.round(paceRatio * 100))}%` }}
            title={`Even pace would be ${duration(goal.expectedSeconds ?? 0)}`}
            aria-hidden="true"
          />
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="font-mono text-small text-ink numeric-stable">
          {duration(goal.focusedSeconds)}
          <span className="text-faint"> / {duration(goal.targetSeconds)}</span>
        </span>
        <span className={cn('font-mono text-micro uppercase', goal.isMet ? 'text-good' : behind ? 'text-pause' : 'text-muted')}>
          {goal.isMet ? 'met' : behind ? 'behind pace' : 'on pace'}
        </span>
      </div>

      {goal.paceRatio !== null && goal.expectedSeconds !== null && (
        <div className="mt-1.5">
          <StatRow
            label={`Even pace at day ${goal.daysElapsed} of ${goal.daysTotal}`}
            value={duration(goal.expectedSeconds)}
            tone={behind ? 'negative' : 'positive'}
          />
          {goal.projectedSeconds !== null && (
            <StatRow label="Projected at this rate" value={duration(goal.projectedSeconds)} />
          )}
        </div>
      )}

      <p className="hint mt-2.5">{goal.message}</p>
    </li>
  );
}

// -------------------------------------------------------------------- the form

const DURATION_PRESETS = [
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
  { label: '2h', seconds: 7200 },
  { label: '4h', seconds: 14400 },
  { label: '8h', seconds: 28800 },
  { label: '10h', seconds: 36000 },
  { label: '20h', seconds: 72000 },
  { label: '40h', seconds: 144000 },
];

function GoalForm({
  open,
  goal,
  defaultDailySeconds,
  onClose,
  onSave,
}: {
  open: boolean;
  goal: GoalDto | null;
  defaultDailySeconds: number;
  onClose: () => void;
  onSave: (values: Record<string, unknown>) => Promise<boolean>;
}) {
  const subjects = useApp(selectActiveSubjects);

  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [subjectId, setSubjectId] = useState('');
  const [seconds, setSeconds] = useState(defaultDailySeconds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setPeriod(goal.period);
      setSubjectId(goal.subjectId ?? '');
      setSeconds(goal.targetSeconds);
      return;
    }
    setPeriod('weekly');
    setSubjectId('');
    // A weekly goal defaults to five times the daily one, because that is what most
    // people mean by "a normal week".
    setSeconds(defaultDailySeconds * 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, goal?.id]);

  const label = useMemo(() => {
    const subject = subjects.find((item) => item._id === subjectId);
    const scope = subject ? subject.name : 'Everything';
    return `${scope} · ${duration(seconds)} per ${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}`;
  }, [period, seconds, subjectId, subjects]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={goal ? 'Edit goal' : 'New goal'}
      description="One goal per period and subject. Saving over an existing combination updates it rather than creating a duplicate."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={seconds <= 0}
            onClick={async () => {
              setBusy(true);
              await onSave({ period, subjectId: subjectId || null, targetSeconds: seconds });
              setBusy(false);
            }}
          >
            {goal ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="label">Period</p>
          <div className="mt-2 flex gap-1.5">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={period === option.value}
                onClick={() => setPeriod(option.value)}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-small transition-colors duration-quick',
                  period === option.value ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-faint hover:border-faint hover:text-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <SelectField label="Scope" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
          <option value="">Everything</option>
          {subjects.map((subject) => (
            <option key={subject._id} value={subject._id}>
              {subject.name} only
            </option>
          ))}
        </SelectField>

        <div>
          <p className="label">Target</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DURATION_PRESETS.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                aria-pressed={seconds === preset.seconds}
                onClick={() => setSeconds(preset.seconds)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 font-mono text-tiny transition-colors duration-quick',
                  seconds === preset.seconds ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-faint hover:border-faint hover:text-muted',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field
              label="Hours"
              type="number"
              min={0}
              max={744}
              value={Math.floor(seconds / 3600)}
              onChange={(event) => setSeconds(Number(event.target.value) * 3600 + (seconds % 3600))}
            />
            <Field
              label="Minutes"
              type="number"
              min={0}
              max={59}
              value={Math.round((seconds % 3600) / 60)}
              onChange={(event) => setSeconds(Math.floor(seconds / 3600) * 3600 + Number(event.target.value) * 60)}
            />
          </div>
        </div>

        <p className="rounded-md border border-line bg-sunken px-3.5 py-2.5 text-small text-muted">{label}</p>
      </div>
    </Modal>
  );
}
