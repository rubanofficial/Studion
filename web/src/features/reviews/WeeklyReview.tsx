/**
 * The weekly review.
 *
 * The one place in the product where looking backwards is the whole point. It is
 * built around a comparison table this-week-versus-last, then the factual
 * observations that follow from it, then what to carry into next week.
 *
 * Two things keep it from becoming a scolding:
 *   - A fall is reported the same way a rise is: as a number with a direction. The
 *     word "down" never appears next to the word "only".
 *   - When there is not enough data for a comparison, the screen says so once and
 *     shows the current week on its own rather than rendering an empty column of
 *     dashes.
 */

import { useNavigate } from 'react-router-dom';

import { duration } from '../../lib/format';
import { useWeeklyReview } from '../../data/queries';
import { useApp } from '../../store/app';
import { Button, ErrorState, SectionHeading, Skeleton, StatRow, cn } from '../../components/ui';
import { ComparisonList, FocusLandscape, SubjectDistribution } from '../analytics/charts';

export function WeeklyReview() {
  const navigate = useNavigate();
  const overview = useApp((state) => state.overview);
  const settings = useApp((state) => state.settings);
  const { data, loading, error, reload } = useWeeklyReview();

  if (loading && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-5 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-64" label="Loading the weekly review" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
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

  const { summary, previous, comparison, observations, insights, carryForward, streak } = data;

  return (
    <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-9 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Weekly review</p>
          <h1 className="mt-1 text-head text-ink">{data.period.label}</h1>
          <p className="hint mt-1">
            Compared against {data.previousPeriod.label}. Every figure below comes from recorded sessions — nothing is projected.
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => void navigate('/review/daily')}>
            Daily review
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void navigate('/insights?period=week')}>
            Insights
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------------- headline */}
      <div className="grid gap-6 rounded-lg border border-line bg-surface/50 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
        <div>
          <p className="label">This week</p>
          <p className="mt-1 font-mono text-display text-ink numeric-stable">{duration(summary.focusedSeconds)}</p>
          <p className="hint mt-1">
            {duration(summary.averageDailySeconds)} a day across {summary.activeDays} active day
            {summary.activeDays === 1 ? '' : 's'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          <MiniStat label="Sessions" value={String(summary.sessionCount)} previous={previous?.sessionCount} />
          <MiniStat label="Average session" value={duration(summary.averageSessionSeconds)} previous={previous?.averageSessionSeconds} format="duration" />
          <MiniStat label="Longest" value={duration(summary.longestSessionSeconds)} previous={previous?.longestSessionSeconds} format="duration" />
          <MiniStat
            label="Completion"
            value={summary.completionRate === null ? '—' : `${Math.round(summary.completionRate * 100)}%`}
            previous={previous?.completionRate ?? undefined}
            format="rate"
          />
          <MiniStat
            label="Average score"
            value={summary.averageFocusScore === null ? '—' : String(Math.round(summary.averageFocusScore))}
            previous={previous?.averageFocusScore ?? undefined}
          />
          <MiniStat label="Streak" value={`${streak.daily.current}d`} previous={undefined} />
        </div>
      </div>

      {/* --------------------------------------------------------- the comparison */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div>
          <SectionHeading
            title="Week against week"
            detail="Both columns are shown, so the change can always be checked rather than taken on trust."
          />
          <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-2 sm:px-6">
            <ComparisonList rows={comparison} />
          </div>
        </div>

        <div>
          <SectionHeading title="The shape of the week" />
          <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-4">
            <StatRow label="Active days" value={`${summary.activeDays} of ${summary.dailySeries.length}`} />
            <StatRow label="Break time" value={duration(summary.breakSeconds)} />
            <StatRow
              label="Focus to break"
              value={summary.breakToFocusRatio === null ? '—' : `${Math.round(summary.breakToFocusRatio * 100)}%`}
            />
            <StatRow label="Distractions" value={String(summary.distractions.total)} />
            <StatRow
              label="Per focused hour"
              value={summary.distractions.perHour > 0 ? summary.distractions.perHour.toFixed(1) : '0.0'}
            />
          </div>

          {streak.daily.longest > 0 && (
            <p className="hint mt-3">
              Longest run so far: {streak.daily.longest} day{streak.daily.longest === 1 ? '' : 's'} at or above{' '}
              {duration(streak.daily.thresholdSeconds)}. A day at that threshold counts — it does not have to reach the daily goal.
            </p>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- the landscape */}
      {summary.dailySeries.length > 0 && (
        <section>
          <SectionHeading title="Day by day" detail="Solid marks met the daily goal. A stub is a day with nothing recorded." />
          <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-5 sm:px-6">
            <FocusLandscape
              series={summary.dailySeries}
              goalSeconds={overview?.today.goalSeconds ?? 0}
            />
          </div>
        </section>
      )}

      {/* ---------------------------------------------------------- observations */}
      {observations.length > 0 && (
        <section>
          <SectionHeading
            title="What changed"
            detail="Only differences large enough to be worth naming. Where the sample is too small, nothing is claimed."
          />
          <ul className="mt-3 flex flex-col gap-2">
            {observations.map((observation) => (
              <li
                key={observation.key}
                className="flex items-baseline justify-between gap-4 rounded-md border border-line bg-surface/40 px-4 py-3"
              >
                <span className="text-small text-muted">{observation.label}</span>
                <span className="flex shrink-0 items-baseline gap-3 font-mono text-small numeric-stable">
                  <span className="text-ink">{formatValue(observation.current, observation.format)}</span>
                  {observation.previous !== null && (
                    <span className="text-ghost">{formatValue(observation.previous, observation.format)}</span>
                  )}
                  <span className={cn(observation.delta && observation.delta > 0 ? 'text-good' : observation.delta ? 'text-pause' : 'text-ghost')}>
                    {observation.delta === null || observation.delta === 0
                      ? 'no change'
                      : `${observation.delta > 0 ? '+' : '−'}${formatValue(Math.abs(observation.delta), observation.format)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------- insights */}
      {insights.length > 0 && (
        <section>
          <SectionHeading title="What the record says" detail="Generated from your own sessions. Nothing compared against other people." />
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {insights.map((insight) => (
              <li
                key={insight.id}
                className={cn(
                  'rounded-lg border bg-surface/50 px-4 py-3.5',
                  insight.tone === 'positive' ? 'border-good/25' : insight.tone === 'nudge' ? 'border-pause/25' : 'border-line',
                )}
              >
                <p className="text-small text-ink">{insight.title}</p>
                <p className="mt-1 text-small text-muted">{insight.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------------- subject split */}
      <section>
        <SectionHeading title="Where the week went" detail="Every recorded minute, by subject." />
        <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-4 sm:px-6">
          <SubjectDistribution subjects={summary.subjects} totalSeconds={summary.focusedSeconds} />
        </div>
      </section>

      {/* --------------------------------------------------------- carry forward */}
      <section>
        <SectionHeading
          title="Into next week"
          detail={
            carryForward.length === 0
              ? 'Nothing specific to carry — the record is consistent enough that there is no obvious lever.'
              : 'One or two things the data points at. Suggestions, not instructions.'
          }
        />
        {carryForward.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {carryForward.map((insight) => (
              <li key={insight.id} className="rounded-md border border-line bg-surface/40 px-4 py-3">
                <p className="text-small text-ink">{insight.title}</p>
                <p className="mt-1 text-small text-muted">{insight.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 hint">
            Come back after another week of sessions and the comparison will have more to say. Until then, this section stays quiet
            rather than inventing advice.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-5">
        <Button variant="primary" size="sm" onClick={() => void navigate('/')}>
          Back to the cockpit
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void navigate('/insights?period=week')}>
          Full weekly insights
        </Button>
        <Button variant="ghost" size="sm" onClick={reload}>
          Recalculate
        </Button>
        {settings && <span className="hint self-center">Generated {new Date(data.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</span>}
      </div>
    </div>
  );
}

/**
 * A weekly figure with its previous value underneath.
 *
 * The delta is computed against the *previous week*, which is the only comparison
 * that means anything here. A missing previous week renders as no comparison
 * rather than as a zero, which would read as a catastrophic drop.
 */
function MiniStat({
  label,
  value,
  previous,
  format = 'number',
}: {
  label: string;
  value: string;
  previous?: number;
  format?: 'number' | 'duration' | 'rate';
}) {
  const current = format === 'rate' ? Number.parseFloat(value) / 100 : Number.parseFloat(value);
  const delta = previous === undefined || Number.isNaN(current) || Number.isNaN(previous) ? null : current - previous;

  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-1 font-mono text-small text-ink numeric-stable">{value}</p>
      <p className="mt-0.5 font-mono text-micro text-ghost">
        {delta === null || delta === 0
          ? 'no change'
          : format === 'duration'
            ? `${delta > 0 ? '+' : '−'}${duration(Math.abs(delta) * 60)}`
            : format === 'rate'
              ? `${delta > 0 ? '+' : '−'}${Math.abs(delta * 100).toFixed(1)}%`
              : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`}
      </p>
    </div>
  );
}

function formatValue(value: number, format: 'duration' | 'count' | 'percent' | 'score'): string {
  if (format === 'duration') return duration(value);
  if (format === 'percent') return `${Math.round(value)}%`;
  return String(Math.round(value));
}
