/**
 * Insights.
 *
 * This is where the recorded time becomes a picture of a person's week. It is
 * deliberately *not* a dashboard: there is no grid of stat cards, no KPI strip, and
 * no chart placed because a dashboard is expected to have one. Each section exists
 * because it answers a question somebody actually asks — "am I improving?", "when
 * do I work best?", "where is my time going?", "what is getting in the way?".
 *
 * The order of the sections is the order of those questions.
 *
 * Two rules are enforced here rather than left to the backend:
 *   - An insight is never rendered as an assertion it cannot support. When the
 *     period is too thin, the room says so once, plainly, and offers the action
 *     that fixes it.
 *   - Comparisons are always *relative to the user's own past*, never to other
 *     people. There is no benchmark, because a benchmark would turn a measurement
 *     into a competition.
 */

import { useNavigate, useSearchParams } from 'react-router-dom';

import type { InsightDto } from '../../lib/api';
import { useHeatmap, usePeriodAnalytics } from '../../data/queries';
import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { Button, EmptyState, ErrorState, Segmented, SectionHeading, Skeleton, Spinner, cn } from '../../components/ui';
import { DaySheet } from './DaySheet';
import { ComparisonList, DayDial, FocusHeatmap, FocusLandscape, SubjectDistribution } from './charts';

type PeriodKind = 'week' | 'month' | 'year';

export function InsightsView() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const subjects = useApp(selectActiveSubjects);
  const overview = useApp((state) => state.overview);

  const period = (params.get('period') as PeriodKind) ?? 'week';
  const anchor = params.get('anchor') ?? undefined;
  const subjectId = params.get('subject') ?? undefined;
  const selectedDay = params.get('day') ?? null;


  const { data, loading, error, reload } = usePeriodAnalytics({ period, anchor, subjectId });
  const { data: heatmap } = useHeatmap(365, subjectId);

  /** All period state is in the URL, so a view can be shared or reloaded intact. */
  const patch = (next: Record<string, string | null>) => {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null) updated.delete(key);
      else updated.set(key, value);
    }
    setParams(updated, { replace: true });
  };

  if (loading && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-8 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-72" label="Loading insights" />
        <Skeleton className="h-40" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[76rem] px-4 py-10 sm:px-6">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  if (!data) return null;

  const empty = data.summary.sessionCount === 0;

  return (
    <>
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-10 px-4 py-8 sm:px-6 sm:py-10">
        {/* ------------------------------------------------------------ controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            ariaLabel="Period"
            value={period}
            onChange={(value) => patch({ period: value, anchor: null, day: null })}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
          />

          <div className="flex flex-wrap items-center gap-2">
            {subjects.length > 1 && (
              <select
                aria-label="Filter by subject"
                value={subjectId ?? ''}
                onChange={(event) => patch({ subject: event.target.value || null, day: null })}
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

            <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken p-0.5">
              <button
                type="button"
                onClick={() => patch({ anchor: shiftAnchor(period, data.period.fromKey, -1), day: null })}
                className="rounded-sm px-2 py-1 text-tiny text-faint transition-colors hover:text-ink"
                aria-label="Previous period"
              >
                ←
              </button>
              <span className="min-w-[9rem] px-1 text-center font-mono text-tiny text-muted">{data.period.label}</span>
              <button
                type="button"
                onClick={() => patch({ anchor: shiftAnchor(period, data.period.fromKey, 1), day: null })}
                className="rounded-sm px-2 py-1 text-tiny text-faint transition-colors hover:text-ink"
                aria-label="Next period"
              >
                →
              </button>
              {anchor && (
                <button
                  type="button"
                  onClick={() => patch({ anchor: null, day: null })}
                  className="rounded-sm px-2 py-1 text-micro uppercase text-accent"
                >
                  now
                </button>
              )}
            </div>

            {loading && <Spinner className="text-faint" />}
          </div>
        </div>

        {/* ----------------------------------------------------- the headline */}
        {data.headline && !empty ? (
          <p className="max-w-3xl text-title text-ink">{data.headline.title}</p>
        ) : (
          <SectionHeading
            title={empty ? 'Not enough data yet' : periodTitle(period, data.period.label)}
            detail={
              empty
                ? 'Three or four completed sessions is the point at which patterns become worth reporting. Until then this room stays quiet rather than guessing.'
                : undefined
            }
          />
        )}

        {empty ? (
          <EmptyState
            title="Your first focus session starts here."
            detail="Record one session and the landscape, the dial and the comparison all become useful. There is nothing to configure first."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => navigate('/')}>
                  Go to the cockpit
                </Button>
                <Button variant="secondary" onClick={() => navigate('/subjects')}>
                  Manage subjects
                </Button>
              </div>
            }
          />
        ) : (
          <>
            {/* ------------------------------------------------- the landscape */}
            <section className="flex flex-col gap-4">
              <SectionHeading
                title="Your period, as a landscape"
                detail={
                  data.summary.dailySeries.length > 31
                    ? 'Every day in the period, with the months you recorded nothing left flat.'
                    : 'One mark per day. Solid means the daily target was met.'
                }
              />
              <div className="rounded-lg border border-line bg-surface/50 px-4 py-5 sm:px-6">
                <FocusLandscape
                  series={data.summary.dailySeries}
                  goalSeconds={overview?.today.goalSeconds ?? 0}
                  selectedKey={selectedDay}
                  onSelect={(key) => patch({ day: key })}
                  compact={data.summary.dailySeries.length > 31}
                />
              </div>
            </section>

            {/* -------------------------------------------------- the comparison */}
            <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
              <div className="flex flex-col gap-4">
                <SectionHeading
                  title="Against the last one"
                  detail={`${data.previousPeriod.label} is the comparison. Both numbers are shown so the change can be checked.`}
                />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-2 sm:px-6">
                  <ComparisonList rows={data.comparison} />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeading title="Consistency" />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <ConsistencyScore data={data} />
                </div>
              </div>
            </section>

            {/* -------------------------------------------------------- the dial */}
            <section className="grid gap-8 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <SectionHeading title="When you focus" detail="Focus accumulated by hour of day across the whole period." />
                <div className="flex flex-1 items-center justify-center rounded-lg border border-line bg-surface/50 px-4 py-5">
                  <DayDial hourly={data.summary.hourly} />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeading title="Which days are yours" detail="Recorded focus by weekday, summed over the period." />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <WeekdayBars byDayOfWeek={data.summary.byDayOfWeek} />
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------- where time went */}
            <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="flex flex-col gap-4">
                <SectionHeading title="Where the time went" detail="Every recorded minute, attributed to the subject it was filed under." />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-4 sm:px-6">
                  <SubjectDistribution subjects={data.summary.subjects} totalSeconds={data.summary.focusedSeconds} />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <SectionHeading title="The mechanics" detail="The numbers underneath everything above." />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-4 sm:px-6">
                  <ul className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                    <MetricCell label="Focused" value={duration(data.summary.focusedSeconds)} />
                    <MetricCell label="Break time" value={duration(data.summary.breakSeconds)} />
                    <MetricCell label="Sessions" value={String(data.summary.sessionCount)} />
                    <MetricCell
                      label="Completion rate"
                      value={data.summary.completionRate === null ? '—' : `${Math.round(data.summary.completionRate * 100)}%`}
                      detail={`${data.summary.completedCount} completed, ${data.summary.interruptedCount} interrupted`}
                    />
                    <MetricCell label="Average session" value={duration(data.summary.averageSessionSeconds)} />
                    <MetricCell label="Longest session" value={duration(data.summary.longestSessionSeconds)} />
                    <MetricCell label="Active days" value={`${data.summary.activeDays} of ${data.summary.dailySeries.length}`} />
                    <MetricCell
                      label="Average score"
                      value={data.summary.averageFocusScore === null ? '—' : String(Math.round(data.summary.averageFocusScore))}
                      detail="Explained in the session detail"
                    />
                    <MetricCell
                      label="Interruptions"
                      value={String(data.summary.distractions.total)}
                      detail={
                        data.summary.distractions.total > 0
                          ? `${data.summary.distractions.perHour.toFixed(1)} per focused hour`
                          : 'none logged'
                      }
                    />
                    <MetricCell
                      label="Focus to break"
                      value={
                        data.summary.breakToFocusRatio === null
                          ? '—'
                          : `${Math.round(data.summary.breakToFocusRatio * 100)}%`
                      }
                      detail="Break time as a share of focus time"
                    />
                  </ul>

                  {data.summary.distractions.byKind.length > 0 && (
                    <div className="mt-5 border-t border-line pt-4">
                      <p className="label mb-2">Interruptions by source</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {data.summary.distractions.byKind.map((entry) => (
                          <li key={entry.kind} className="chip">
                            <span className="text-muted">{titleise(entry.kind)}</span>
                            <span className="font-mono text-micro text-faint">{entry.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------- observations */}
            <section className="flex flex-col gap-4">
              <SectionHeading
                title="What the record says"
                detail="Generated from your own sessions only. Nothing here is estimated, sampled or compared against other people."
              />
              <div className="grid gap-3 md:grid-cols-2">
                {data.insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            </section>

            {/* ---------------------------------------------------------- heatmap */}
            {heatmap && (
              <section className="flex flex-col gap-4">
                <SectionHeading
                  title="A year in focus"
                  detail="Intensity is relative to your own busiest day, so the grid always has contrast in it."
                />
                <div className="rounded-lg border border-line bg-surface/50 px-4 py-5 sm:px-6">
                  <FocusHeatmap heatmap={heatmap} selectedKey={selectedDay} onSelectDay={(key) => patch({ day: key })} />
                </div>
              </section>
            )}

            {/* --------------------------------------------------------- sessions */}
            <section className="flex flex-col gap-4">
              <SectionHeading
                title="Every session"
                detail={`${data.sessions.length} recorded in ${data.period.label}. Open one to see its score breakdown and event log.`}
              />
              <SessionTable sessions={data.sessions} subjectFilter={subjectId} />
            </section>
          </>
        )}
      </div>

      {selectedDay && <DaySheet dayKey={selectedDay} onClose={() => patch({ day: null })} onSelectDay={(key) => patch({ day: key })} />}
    </>
  );
}

// ----------------------------------------------------------------- consistency

/**
 * The consistency score.
 *
 * A single number is only honest if its inputs are visible, so the three
 * components are listed underneath. `goalPace` is null when no daily goal is set —
 * shown as "not measured" rather than zero, because zero would read as failure.
 */
function ConsistencyScore({ data }: { data: NonNullable<ReturnType<typeof usePeriodAnalytics>['data']> }) {
  const { focusIndex } = data.summary;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="label">Focus index</span>
          <span className="font-mono text-head text-ink numeric-stable">
            {focusIndex.focusIndex === null ? '—' : Math.round(focusIndex.focusIndex)}
          </span>
        </div>
        <p className="hint mt-1">
          {focusIndex.focusIndex === null
            ? 'Not enough recorded days in this period to measure consistency.'
            : 'Days met, pace against your goal, and average session quality, weighted equally.'}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        <IndexRow
          label="Days at goal"
          value={`${focusIndex.daysMet} of ${focusIndex.daysElapsed}`}
          ratio={focusIndex.consistency}
        />
        <IndexRow
          label="Pace against target"
          value={focusIndex.goalPace === null ? 'no goal set' : `${Math.round(focusIndex.goalPace * 100)}%`}
          ratio={focusIndex.goalPace}
        />
        <IndexRow
          label="Session quality"
          value={focusIndex.scoreQuality === null ? 'no scored sessions' : `${Math.round(focusIndex.scoreQuality)}/100`}
          ratio={focusIndex.scoreQuality === null ? null : focusIndex.scoreQuality / 100}
        />
      </ul>

      <div className="border-t border-line pt-3">
        <p className="hint">
          Streak: <span className="text-muted">{data.streak.daily.current} day{data.streak.daily.current === 1 ? '' : 's'}</span>
          {' · '}
          longest <span className="text-muted">{data.streak.daily.longest}</span>
          {' · '}
          a day counts at {duration(data.streak.daily.thresholdSeconds)}
        </p>
      </div>
    </div>
  );
}

function IndexRow({ label, value, ratio }: { label: string; value: string; ratio: number | null }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-small text-muted">{label}</span>
        <span className="font-mono text-micro text-faint">{value}</span>
      </div>
      <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-pill bg-sunken">
        <div
          className={cn('h-full rounded-pill transition-[width] duration-calm ease-forge', ratio === null ? 'bg-ghost' : 'bg-accent')}
          style={{ width: ratio === null ? '0%' : `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` }}
        />
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ weekday

function WeekdayBars({ byDayOfWeek }: { byDayOfWeek: Array<{ weekday: number; focusedSeconds: number; sessionCount: number }> }) {
  const max = Math.max(1, ...byDayOfWeek.map((entry) => entry.focusedSeconds));
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sorted = [...byDayOfWeek].sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((entry) => (
        <div key={entry.weekday} className="flex items-center gap-3">
          <span className="w-9 shrink-0 font-mono text-micro uppercase text-faint">{names[entry.weekday]}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-pill bg-sunken">
            <span
              className="block h-full rounded-pill bg-accent/70"
              style={{ width: `${Math.round((entry.focusedSeconds / max) * 100)}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-micro text-muted numeric-stable">
            {duration(entry.focusedSeconds)}
          </span>
        </div>
      ))}
      <p className="hint">
        {sorted.every((entry) => entry.focusedSeconds === 0)
          ? 'Nothing recorded in this period.'
          : 'Weekday totals, not averages — an empty Sunday reads as an empty Sunday.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------- insight

/**
 * One observation.
 *
 * The tone drives the accent colour only — never the content. A `nudge` is
 * phrased as information ("your last three sessions ended early") rather than
 * instruction, and no card ever uses red.
 */
export function InsightCard({ insight }: { insight: InsightDto }) {
  const toneClass =
    insight.tone === 'positive'
      ? 'border-good/30'
      : insight.tone === 'nudge'
        ? 'border-pause/30'
        : insight.tone === 'info'
          ? 'border-edge'
          : 'border-line';

  return (
    <article className={cn('rounded-lg border bg-surface/50 px-4 py-3.5', toneClass)}>
      <p className="text-small text-ink">{insight.title}</p>
      <p className="mt-1 text-small text-muted">{insight.detail}</p>
      <p className="mt-2 font-mono text-micro uppercase tracking-[0.08em] text-ghost">{insight.category.replace(/-/g, ' ')}</p>
    </article>
  );
}

// --------------------------------------------------------------- session table

function SessionTable({ sessions, subjectFilter }: { sessions: Array<Record<string, unknown>>; subjectFilter?: string }) {
  const navigate = useNavigate();
  const subjects = useApp((state) => state.subjects);
  const settings = useApp((state) => state.settings);
  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const rows = subjectFilter ? sessions.filter((session) => session.subjectId === subjectFilter) : sessions;

  if (rows.length === 0) {
    return <p className="hint py-4">No sessions match this filter in the selected period.</p>;
  }

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[40rem] border-collapse text-small">
        <caption className="sr-only">Sessions recorded in the selected period</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="label py-2 pr-3 font-normal">Started</th>
            <th scope="col" className="label py-2 pr-3 font-normal">Subject</th>
            <th scope="col" className="label py-2 pr-3 font-normal">Status</th>
            <th scope="col" className="label py-2 pr-3 text-right font-normal">Focused</th>
            <th scope="col" className="label py-2 pr-3 text-right font-normal">Distractions</th>
            <th scope="col" className="label py-2 text-right font-normal">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((session) => {
            const id = String(session.id ?? session._id ?? '');
            const subjectId = (session.subjectId as string | null) ?? null;
            const subject = subjects.find((item) => item._id === subjectId);
            const started = session.startTime ? Date.parse(String(session.startTime)) : null;
            return (
              <tr
                key={id}
                onClick={() => navigate(`/sessions/${id}`)}
                className="cursor-pointer border-b border-line/60 transition-colors hover:bg-raised/60"
              >
                <td className="py-2.5 pr-3 font-mono text-tiny text-muted numeric-stable">
                  {started
                    ? new Intl.DateTimeFormat('en-GB', {
                        timeZone,
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      }).format(new Date(started))
                    : '—'}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: subject?.color ?? 'rgb(var(--faint))' }}
                      aria-hidden="true"
                    />
                    <span className="text-muted">{subject?.name ?? 'Unfiled'}</span>
                  </span>
                </td>
                <td className="py-2.5 pr-3 font-mono text-tiny uppercase text-faint">{String(session.status ?? '')}</td>
                <td className="py-2.5 pr-3 text-right font-mono text-ink numeric-stable">
                  {duration(Number(session.focusedSeconds ?? 0))}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-muted numeric-stable">
                  {String(session.distractionCount ?? 0)}
                </td>
                <td className="py-2.5 text-right font-mono text-muted numeric-stable">
                  {session.focusScore === null || session.focusScore === undefined ? '—' : Math.round(Number(session.focusScore))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------- helpers

function MetricCell({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <li>
      <p className="label">{label}</p>
      <p className="mt-1 font-mono text-lead text-ink numeric-stable">{value}</p>
      {detail && <p className="hint mt-0.5">{detail}</p>}
    </li>
  );
}

function titleise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function periodTitle(period: PeriodKind, label: string): string {
  if (period === 'year') return `The year — ${label}`;
  if (period === 'month') return label;
  return `The week — ${label}`;
}

/** Step the anchor one period back or forward, in day-key space. */
export function shiftAnchor(period: PeriodKind, fromKey: string, delta: number): string {
  const [year, month, day] = fromKey.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));

  if (period === 'week') base.setUTCDate(base.getUTCDate() + delta * 7);
  else if (period === 'month') base.setUTCMonth(base.getUTCMonth() + delta);
  else base.setUTCFullYear(base.getUTCFullYear() + delta);

  return base.toISOString().slice(0, 10);
}
