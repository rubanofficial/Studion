/**
 * The day detail.
 *
 * Clicking any day anywhere in the product lands here: focus time, sessions,
 * subjects, distractions and the day's spine, in one place. It is shared by the
 * insights room and the calendar so a day looks identical whichever door you came
 * through — which is what makes the calendar feel like a way into the data rather
 * than a separate report.
 *
 * It is a slide-over rather than a route, because the question "what happened on
 * the 14th?" is almost always asked *while looking at the month*.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useDayDetail } from '../../data/queries';
import { duration, longDate } from '../../lib/format';
import { useApp } from '../../store/app';
import { Button, ErrorState, IconButton, Skeleton, StatRow, cn } from '../../components/ui';
import { TimeSpine } from '../timeline/TimeSpine';
import { HourHistogram } from './charts';

export function DaySheet({
  dayKey,
  onClose,
  onSelectDay,
}: {
  dayKey: string;
  onClose: () => void;
  /** Stepping to another day is the parent's decision — it owns the selection. */
  onSelectDay?: (dayKey: string) => void;
}) {
  const navigate = useNavigate();
  const settings = useApp((state) => state.settings);
  const subjects = useApp((state) => state.subjects);
  const achievements = useApp((state) => state.achievements);
  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data, loading, error, reload } = useDayDetail(dayKey);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (!onSelectDay || !data) return;
      if (event.key === 'ArrowLeft') onSelectDay(data.previousDay);
      if (event.key === 'ArrowRight') onSelectDay(data.nextDay);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, onSelectDay, data]);

  return (
    <div className="fixed inset-0 z-45 flex items-end justify-end">
      <button
        type="button"
        aria-label="Close day detail"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-void/50"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Detail for ${longDate(dayKey)}`}
        className="relative flex max-h-[88vh] w-full animate-rise flex-col overflow-hidden rounded-t-xl border border-line bg-surface shadow-pane sm:h-full sm:max-h-none sm:w-[34rem] sm:animate-none sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="label">{data?.goalMet ? 'Goal met' : 'Recorded day'}</p>
            <h2 className="mt-1 text-title text-ink">{longDate(dayKey)}</h2>
            {data && (
              <p className="hint mt-1">
                {duration(data.focusedSeconds)} focused · {data.sessionCount} session{data.sessionCount === 1 ? '' : 's'}
                {data.breakSeconds > 0 ? ` · ${duration(data.breakSeconds)} on breaks` : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label="Previous day"
              onClick={() => data && onSelectDay?.(data.previousDay)}
              disabled={!data || !onSelectDay}
            >
              <Chevron direction="left" />
            </IconButton>
            <IconButton label="Next day" onClick={() => data && onSelectDay?.(data.nextDay)} disabled={!data || !onSelectDay}>
              <Chevron direction="right" />
            </IconButton>
            <IconButton label="Close" onClick={onClose}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              </svg>
            </IconButton>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 scroll-thin">
          {loading && !data && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-24" />
              <Skeleton className="h-32" />
            </div>
          )}

          {error && !data && <ErrorState error={error} onRetry={reload} />}

          {data && (
            <div className="flex flex-col gap-6">
              {/* -------------------------------------------------------- numbers */}
              <div className="rounded-lg border border-line bg-sunken px-4 py-3">
                <StatRow label="Focused" value={duration(data.focusedSeconds)} />
                <StatRow label="Break" value={duration(data.breakSeconds)} />
                <StatRow label="Longest session" value={duration(data.longestSessionSeconds)} />
                <StatRow label="Completed" value={`${data.completedCount} of ${data.sessionCount}`} />
                {data.interruptedCount > 0 && <StatRow label="Interrupted" value={String(data.interruptedCount)} tone="negative" />}
                {data.averageFocusScore !== null && <StatRow label="Average score" value={String(Math.round(data.averageFocusScore))} />}
                <StatRow
                  label="Distractions"
                  value={`${data.distractionCount}${data.distractions.perHour > 0 ? ` (${data.distractions.perHour.toFixed(1)}/h)` : ''}`}
                  tone={data.distractionCount > 0 ? 'negative' : 'default'}
                />
              </div>

              {/* ------------------------------------------------------- spine */}
              <TimeSpine dayKey={dayKey} timeline={data.timeline} timeZone={timeZone} />

              {/* ------------------------------------------------------ hourly */}
              {data.sessionCount > 0 && (
                <div>
                  <h3 className="label mb-2.5">Shape of the day</h3>
                  <HourHistogram hourly={data.hourly} />
                </div>
              )}

              {/* ---------------------------------------------------- subjects */}
              {data.subjects.length > 0 && (
                <div>
                  <h3 className="label mb-2.5">Where the time went</h3>
                  <ul className="divide-y divide-line/70">
                    {data.subjects.map((entry) => (
                      <li key={entry.subjectId} className="flex items-center gap-3 py-2.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: entry.color ?? subjects.find((subject) => subject._id === entry.subjectId)?.color ?? 'rgb(var(--faint))' }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate text-small text-muted">{entry.name}</span>
                        <span className="shrink-0 font-mono text-micro text-faint">{Math.round(entry.share * 100)}%</span>
                        <span className="shrink-0 font-mono text-small text-ink numeric-stable">{duration(entry.focusedSeconds)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ------------------------------------------------ distractions */}
              {data.distractions.total > 0 && (
                <div>
                  <h3 className="label mb-2.5">What pulled you away</h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {data.distractions.byKind.map((entry) => (
                      <li key={entry.kind} className="chip">
                        <span className="text-muted">{titleise(entry.kind)}</span>
                        <span className="font-mono text-micro text-faint">{entry.count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint mt-2">
                    {data.distractions.perHour.toFixed(1)} interruptions per focused hour. Reported without judgement — the count is only
                    useful as a trend.
                  </p>
                </div>
              )}

              {/* ---------------------------------------------------- sessions */}
              {data.sessionCount > 0 && (
                <div>
                  <h3 className="label mb-2.5">Sessions</h3>
                  <ul className="flex flex-col gap-1.5">
                    {(data.sessions as Array<Record<string, unknown>>).map((session) => {
                      const id = String(session.id ?? session._id ?? '');
                      const subjectId = (session.subjectId as string | null) ?? null;
                      const subject = subjects.find((item) => item._id === subjectId);
                      return (
                        <li key={id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/sessions/${id}`)}
                            className="flex w-full items-center gap-3 rounded-md border border-line bg-raised/60 px-3 py-2 text-left transition-colors duration-quick hover:border-accent/50"
                          >
                            <span
                              className="h-6 w-0.5 shrink-0 rounded-pill"
                              style={{ background: subject?.color ?? 'rgb(var(--faint))' }}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-small text-ink">{subject?.name ?? 'Unfiled'}</span>
                              <span className="mt-0.5 block font-mono text-micro uppercase tracking-[0.06em] text-faint">
                                {String(session.status ?? '')}
                                {Number(session.distractionCount ?? 0) > 0 ? ` · ${session.distractionCount} interruptions` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-mono text-small text-ink numeric-stable">
                                {duration(Number(session.focusedSeconds ?? 0))}
                              </span>
                              {session.focusScore !== null && session.focusScore !== undefined && (
                                <span className="block font-mono text-micro text-faint">score {Math.round(Number(session.focusScore))}</span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {data.sessionCount === 0 && (
                <p className="hint">
                  Nothing was recorded on this day. That is a fact about the day, not a judgement about you — the streak threshold is
                  deliberately low so a rest day does not erase progress.
                </p>
              )}

              {achievements && achievements.streaks.daily.current > 0 && (
                <p className={cn('hint')}>
                  Current run: {achievements.streaks.daily.current} consecutive day
                  {achievements.streaks.daily.current === 1 ? '' : 's'} at or above {duration(achievements.streaks.daily.thresholdSeconds)}.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(`/review/daily?day=${dayKey}`)}>
            Open the review
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </footer>
      </section>
    </div>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      {direction === 'left' ? <path d="M10 3.5L5.5 8l4.5 4.5" /> : <path d="M6 3.5L10.5 8 6 12.5" />}
    </svg>
  );
}

function titleise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2');
}
