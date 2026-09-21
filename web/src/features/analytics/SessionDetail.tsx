/**
 * One session, in full.
 *
 * The most forensic screen in the product, and deliberately so: this is where a
 * user can check that the score they were given is the score they earned. Every
 * input is shown — the planned duration, the interruptions, the distractions, the
 * pause time, and the event log itself.
 *
 * That transparency is the whole point. A scoring system nobody can audit is a
 * scoring system nobody believes, and a focus score nobody believes is a focus
 * score nobody changes their behaviour for.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { SESSION_STATUS_LABELS } from '@focusforge/core';

import { api } from '../../lib/api';
import { useQuery } from '../../data/queries';
import { clockTime, duration, longDate } from '../../lib/format';
import { useApp } from '../../store/app';
import { Button, ErrorState, ProgressBar, SectionHeading, Skeleton, StatRow, cn } from '../../components/ui';

export function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const settings = useApp((state) => state.settings);
  const subjects = useApp((state) => state.subjects);
  const tasks = useApp((state) => state.tasks);
  const toast = useApp((state) => state.toast);

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, loading, error, reload } = useQuery(
    `session:${sessionId}`,
    () => api.sessions.get(sessionId as string),
    { enabled: Boolean(sessionId) },
  );

  const [reflection, setReflection] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!sessionId) return null;

  if (loading && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[60rem] flex-col gap-5 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-64" label="Loading the session" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[60rem] px-4 py-10 sm:px-6">
        <ErrorState error={error} onRetry={reload} />
        <Button variant="ghost" className="mt-4" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { session, record } = data;
  const subject = subjects.find((item) => item._id === session.subjectId) ?? null;
  const task = tasks.find((item) => item._id === session.taskId) ?? null;
  const breakdown = session.focusScoreBreakdown;
  const reflectionValue = reflection ?? session.reflection ?? '';

  const saveReflection = async () => {
    setBusy(true);
    const result = await api.sessions.update(session.id, { reflection: reflectionValue.trim() || null });
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', title: 'Could not save the note', detail: result.error.message });
      return;
    }
    setEditing(false);
    toast({ tone: 'success', title: 'Note saved' });
    reload();
  };

  return (
    <div className="mx-auto flex w-full max-w-[60rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label">{SESSION_STATUS_LABELS[session.status] ?? session.status}</p>
          <h1 className="mt-1 flex items-center gap-2.5 text-head text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: subject?.color ?? 'rgb(var(--faint))' }} aria-hidden="true" />
            {subject?.name ?? 'Unfiled'}
          </h1>
          <p className="hint mt-1">
            {longDate(session.dayKey)} · {clockTime(session.startTime, timeZone)}
            {session.endTime ? ` – ${clockTime(session.endTime, timeZone)}` : ' (still open)'}
            {task ? ` · ${task.title}` : ''}
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button variant="ghost" size="sm" onClick={reload}>
            Refresh
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------ headline */}
      <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div className="flex flex-col items-start gap-1">
          <span className="label">Focused</span>
          <span className="font-mono text-display text-ink numeric-stable">{duration(session.focusedSeconds)}</span>
          <span className="hint">of a planned {duration(session.plannedDuration)}</span>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="label">Plan adherence</span>
              <span className="font-mono text-small text-ink numeric-stable">
                {session.plannedDuration > 0 ? `${Math.round((session.focusedSeconds / session.plannedDuration) * 100)}%` : '—'}
              </span>
            </div>
            <div className="mt-1.5">
              <ProgressBar
                value={session.plannedDuration > 0 ? Math.min(1, session.focusedSeconds / session.plannedDuration) : 0}
                label="Plan adherence"
              />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <span className="label">Focus score</span>
              <span className="font-mono text-small text-ink numeric-stable">
                {session.focusScore === null ? 'not scored' : `${Math.round(session.focusScore)}/100`}
              </span>
            </div>
            <div className="mt-1.5">
              <ProgressBar value={(session.focusScore ?? 0) / 100} label="Focus score" />
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- ledger */}
      <section className="grid gap-8 md:grid-cols-2">
        <div>
          <SectionHeading title="What was recorded" />
          <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-3">
            <StatRow label="Wall clock time" value={duration(session.wallSeconds)} />
            <StatRow label="Focused" value={duration(session.focusedSeconds)} />
            <StatRow label="On breaks" value={duration(session.breakSeconds)} />
            <StatRow label="Paused" value={duration(session.pausedSeconds)} />
            <StatRow label="Idle (no heartbeat)" value={duration(session.idleSeconds)} />
            <StatRow label="Interruptions" value={String(session.pauseCount)} />
            <StatRow label="Break periods" value={String(session.breakCount)} />
            <StatRow label="Distractions" value={String(session.distractionCount)} />
          </div>
          <p className="hint mt-2">
            Every figure is derived from the event log below, not accumulated by a browser counter. That is why a page refresh, a
            sleeping laptop or a lost connection cannot change any of them.
          </p>
        </div>

        <div>
          <SectionHeading
            title="How the score was reached"
            detail={breakdown ? breakdown.summary : 'This session has no score.'}
          />
          {breakdown ? (
            <>
              <ul className="mt-3 divide-y divide-line/70">
                {breakdown.factors.map((factor) => (
                  <li key={factor.key} className="py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-small text-ink">{factor.label}</span>
                      <span className="font-mono text-micro text-faint">
                        weight {Math.round(factor.weight * 100)}% · {Math.round(factor.points)}/{Math.round(factor.maxPoints)} pts
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={factor.value} height={3} />
                    </div>
                    <p className="hint mt-1.5">{factor.note}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {breakdown.strongest && (
                  <p className="rounded-md border border-good/30 bg-good/[0.05] px-3 py-2 text-tiny text-muted">
                    Strongest: <span className="text-ink">{breakdown.strongest}</span>
                  </p>
                )}
                {breakdown.weakest && (
                  <p className="rounded-md border border-pause/30 bg-pause/[0.05] px-3 py-2 text-tiny text-muted">
                    Weakest: <span className="text-ink">{breakdown.weakest}</span>
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-4 text-small text-muted">
              A session shorter than a few minutes of real focus is stored but deliberately not scored — a cancelled start says
              nothing about your attention.
            </p>
          )}
        </div>
      </section>

      {/* ---------------------------------------------------- distractions */}
      {session.distractionCount > 0 && (
        <section>
          <SectionHeading title="Interruptions logged during this session" />
          <ul className="mt-3 flex flex-wrap gap-2">
            {Object.entries(session.distractionKinds).map(([kind, count]) => (
              <li key={kind} className="chip">
                <span className="text-muted">{titleise(kind)}</span>
                <span className="font-mono text-micro text-faint">{count}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-micro text-faint">
            {session.distractions.map((entry, index) => (
              <li key={`${entry.kind}-${index}`}>
                {clockTime(entry.at, timeZone)} {titleise(entry.kind)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------------- reflection */}
      <section>
        <SectionHeading
          title="Note to yourself"
          detail="Optional, private, and stored with the session so it comes back when you review the week."
          action={
            !editing ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {session.reflection ? 'Edit' : 'Add note'}
              </Button>
            ) : undefined
          }
        />

        {editing ? (
          <div className="mt-3 flex flex-col gap-3">
            <textarea
              value={reflectionValue}
              onChange={(event) => setReflection(event.target.value)}
              rows={3}
              maxLength={500}
              className="field min-h-[5rem] resize-y"
              placeholder="What you got through, what blocked you, what to change next time."
            />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" loading={busy} onClick={() => void saveReflection()}>
                Save note
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setReflection(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className={cn('mt-3 rounded-lg border border-line bg-surface/50 px-4 py-3 text-small', session.reflection ? 'text-muted' : 'hint')}>
            {session.reflection ?? 'No note on this session.'}
          </p>
        )}
      </section>

      {/* ----------------------------------------------------------- raw events */}
      <section>
        <SectionHeading
          title="The event log"
          detail="Every transition that was stored, in order. This is the source the block above is derived from."
        />
        <ol className="mt-3 flex flex-col gap-0">
          {(session.events ?? []).map((event, index) => (
            <li key={`${event.type}-${event.at}-${index}`} className="flex items-start gap-3">
              <span className="flex w-14 shrink-0 justify-end pt-2 font-mono text-micro text-faint numeric-stable">
                {clockTime(event.at, timeZone)}
              </span>
              <span className="relative flex flex-col items-center self-stretch">
                <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-accent/70" aria-hidden="true" />
                {index < (session.events?.length ?? 0) - 1 && <span className="w-px flex-1 bg-line" aria-hidden="true" />}
              </span>
              <span className="flex flex-wrap items-baseline gap-2 py-2 text-small text-muted">
                <span className="text-ink">{titleise(event.type)}</span>
                {event.kind && <span className="text-faint">{titleise(event.kind)}</span>}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-3 font-mono text-micro text-ghost">
          <span>device {session.device}</span>
          <span>timezone {session.timeZone}</span>
          <span>client id {session.clientId}</span>
          <span>recorded {clockTime(session.createdAt, timeZone)}</span>
          {record.idleSeconds > 0 && <span>{record.idleSeconds}s idle</span>}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button variant="secondary" size="sm" onClick={() => navigate(`/review/daily?day=${session.dayKey}`)}>
          Review that day
        </Button>
        <Button variant="secondary" size="sm" onClick={() => navigate(`/insights?day=${session.dayKey}`)}>
          Open in insights
        </Button>
        <Button
          variant="danger"
          size="sm"
          className="ml-auto"
          onClick={async () => {
            if (!window.confirm('Delete this session? Its recorded time will be removed from every total and streak.')) return;
            const result = await api.sessions.remove(session.id);
            if (!result.ok) {
              toast({ tone: 'error', title: 'Could not delete the session', detail: result.error.message });
              return;
            }
            toast({ tone: 'success', title: 'Session deleted' });
            await useApp.getState().refreshAll();
            navigate('/insights');
          }}
        >
          Delete session
        </Button>
      </div>

      <p className="hint">
        Deleting a session is permanent and recalculates your totals, streaks and achievements. Export your data first if you are not
        sure — Settings has JSON and CSV.
      </p>
    </div>
  );
}

function titleise(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/_/g, ' ');
}
