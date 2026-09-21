/**
 * The daily review.
 *
 * Deliberately a *reflection*, not a report. Everything the product already knows
 * is summarised, then the last thing on the page is a question rather than a
 * number — "what went well?" — because the value of a review is in the sentence the
 * user writes, not the chart above it.
 *
 * The copy is written to the product's rule: state what happened, offer what it
 * might mean, never assign a moral. A short day is reported as a short day.
 */

import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { dayKey as dayKeyOf } from '@focusforge/core';

import { useDailyReview } from '../../data/queries';
import { duration, longDate } from '../../lib/format';
import { useApp } from '../../store/app';
import { Button, ErrorState, ProgressBar, Skeleton, StatRow, cn } from '../../components/ui';
import { TimeSpine } from '../timeline/TimeSpine';
import { HourHistogram } from '../analytics/charts';

export function DailyReview() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const settings = useApp((state) => state.settings);
  const overview = useApp((state) => state.overview);

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayKey = overview?.today.dayKey ?? dayKeyOf(Date.now(), timeZone);
  const day = params.get('day') ?? undefined;

  const { data, loading, error, reload } = useDailyReview(day);

  /** The standard three prompts, plus context-aware ones from the server. */
  const prompts = useMemo(() => {
    if (!data) return [];
    const merged = [...data.prompts];
    if (data.interruptedCount > 0 && !merged.some((prompt) => /interrupt/i.test(prompt))) {
      merged.push(`${data.interruptedCount} session${data.interruptedCount === 1 ? '' : 's'} ended early today — was there a reason worth naming?`);
    }
    if (data.distractionCount > 3) {
      merged.push('Several interruptions today. Was there one source that accounted for most of them?');
    }
    return merged.slice(0, 4);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-5 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-64" label="Loading the review" />
        <Skeleton className="h-36" />
        <Skeleton className="h-52" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[64rem] px-4 py-10 sm:px-6">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">{data.goalMet ? 'Goal met' : 'Daily review'}</p>
          <h1 className="mt-1 text-head text-ink">{longDate(data.dayKey)}</h1>
          <p className="hint mt-1">
            {data.dayKey === todayKey ? 'Today, summarised from what was actually recorded.' : 'A past day, read from the record.'}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setParams({ day: data.previousDay }, { replace: true })}>
            ← Previous
          </Button>
          {day && (
            <Button variant="ghost" size="sm" onClick={() => setParams({}, { replace: true })}>
              Today
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={data.nextDay > todayKey}
            onClick={() => setParams({ day: data.nextDay }, { replace: true })}
          >
            Next →
          </Button>
        </div>
      </div>

      {/* ----------------------------------------------------------- the headline */}
      <div className="grid gap-6 rounded-lg border border-line bg-surface/50 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div>
          <p className="label">Focused</p>
          <p className="mt-1 font-mono text-display text-ink numeric-stable">{duration(data.focusedSeconds)}</p>
          {data.dailyGoal && (
            <p className="hint mt-1">
              {data.goalMet
                ? `Target of ${duration(data.dailyGoal.targetSeconds)} reached.`
                : `${duration(data.dailyGoal.remainingSeconds)} short of ${duration(data.dailyGoal.targetSeconds)}.`}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {data.dailyGoal && (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="label">Daily goal</span>
                <span className="font-mono text-micro text-faint">{Math.round(data.dailyGoal.progress * 100)}%</span>
              </div>
              <div className="mt-1.5">
                <ProgressBar value={data.dailyGoal.progress} tone={data.goalMet ? 'accent' : 'accent'} />
              </div>
              <p className="hint mt-1.5">{data.dailyGoal.message}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-micro text-faint">
            <span>
              streak {data.streak.current} day{data.streak.current === 1 ? '' : 's'}
            </span>
            <span>a day counts at {duration(data.streak.thresholdSeconds)}</span>
            <span>{data.sessionCount} session{data.sessionCount === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- ledger */}
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-title text-ink">What was recorded</h2>
          <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-3">
            <StatRow label="Focused" value={duration(data.focusedSeconds)} />
            <StatRow label="Break time" value={duration(data.breakSeconds)} />
            <StatRow label="Sessions" value={`${data.completedCount} of ${data.sessionCount} completed`} />
            {data.interruptedCount > 0 && <StatRow label="Interrupted" value={String(data.interruptedCount)} tone="negative" />}
            <StatRow label="Longest session" value={duration(data.longestSessionSeconds)} />
            {data.averageFocusScore !== null && (
              <StatRow label="Average focus score" value={String(Math.round(data.averageFocusScore))} />
            )}
            <StatRow
              label="Distractions"
              value={`${data.distractionCount}${data.distractions.perHour > 0 ? ` (${data.distractions.perHour.toFixed(1)}/h)` : ''}`}
              tone={data.distractionCount > 0 ? 'negative' : 'default'}
            />
          </div>
        </section>

        <section>
          <h2 className="text-title text-ink">Subjects studied</h2>
          {data.subjects.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-small text-muted">
              No sessions were filed today.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line/70 rounded-lg border border-line bg-surface/50 px-4">
              {data.subjects.map((entry) => (
                <li key={entry.subjectId} className="flex items-center gap-3 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color ?? 'rgb(var(--faint))' }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-small text-muted">{entry.name}</span>
                  <span className="shrink-0 font-mono text-micro text-faint">{Math.round(entry.share * 100)}%</span>
                  <span className="shrink-0 font-mono text-small text-ink numeric-stable">{duration(entry.focusedSeconds)}</span>
                </li>
              ))}
            </ul>
          )}

          {data.distractions.byKind.length > 0 && (
            <div className="mt-4">
              <p className="label mb-2">Interruptions by source</p>
              <ul className="flex flex-wrap gap-1.5">
                {data.distractions.byKind.map((entry) => (
                  <li key={entry.kind} className="chip">
                    <span className="text-muted">{titleise(entry.kind)}</span>
                    <span className="font-mono text-micro text-faint">{entry.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------------------------------------ the shape */}
      {data.sessionCount > 0 && (
        <section className="rounded-lg border border-line bg-surface/50 px-4 py-5 sm:px-5">
          <TimeSpine dayKey={data.dayKey} timeline={data.timeline} timeZone={timeZone} nowKey={todayKey} />
          <div className="mt-6 border-t border-line pt-4">
            <p className="label mb-2.5">When the time went</p>
            <HourHistogram hourly={data.hourly} />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ observations */}
      {data.observations.length > 0 && (
        <section>
          <h2 className="text-title text-ink">What the record says</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.observations.map((observation) => (
              <li
                key={observation.id}
                className={cn(
                  'rounded-md border px-4 py-3 text-small text-muted',
                  observation.tone === 'positive' ? 'border-good/25 bg-good/[0.04]' : 'border-line bg-surface/40',
                )}
              >
                {observation.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------------- the question */}
      <section className="rounded-lg border border-line bg-surface/50 px-5 py-5">
        <h2 className="text-title text-ink">What went well?</h2>
        <p className="hint mt-1">
          Optional, and private. Writing one line a day is the single cheapest thing that makes a weekly review useful.
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {prompts.length === 0 ? (
            <li className="hint">Not enough recorded today for a specific prompt — that is fine.</li>
          ) : (
            prompts.map((prompt) => (
              <li key={prompt} className="flex gap-2.5 text-small text-muted">
                <span className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {prompt}
              </li>
            ))
          )}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void navigate(`/sessions/${data.sessions[0]?.id ?? ''}`)} disabled={data.sessions.length === 0}>
            Open the longest session
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void navigate(`/review/weekly`)}>
            See the weekly review
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void navigate('/')}>
            Back to the cockpit
          </Button>
        </div>
      </section>
    </div>
  );
}

function titleise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
