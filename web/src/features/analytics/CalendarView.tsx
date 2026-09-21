/**
 * The calendar.
 *
 * A month at a time, each day carrying its own intensity, with a subject filter
 * that recolours the whole grid. It exists because the landscape answers "is this
 * week on track?" and the calendar answers "what did March look like?" — different
 * zoom levels on the same record.
 *
 * Days are cells you can click, keyboard through, and read out. The intensity is
 * relative to the month's own best day, so a quiet month still shows its own shape
 * rather than a uniformly pale grid.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { dayKey as dayKeyOf } from '@focusforge/core';

import { useCalendar } from '../../data/queries';
import { duration, monthLabel, todayLabel, weekdayShort } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { Button, ErrorState, Segmented, Skeleton, cn } from '../../components/ui';
import { DaySheet } from './DaySheet';

export function CalendarView() {
  const [params, setParams] = useSearchParams();
  const settings = useApp((state) => state.settings);
  const subjects = useApp(selectActiveSubjects);
  const overview = useApp((state) => state.overview);

  const month = params.get('month') ?? undefined;
  const subjectId = params.get('subject') ?? undefined;
  const selectedDay = params.get('day') ?? null;

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayKey = overview?.today.dayKey ?? dayKeyOf(Date.now(), timeZone);

  const { data, loading, error, reload } = useCalendar(month, subjectId);
  const [view, setView] = useState<'month' | 'agenda'>('month');

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
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-6 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-56" label="Loading the calendar" />
        <Skeleton className="h-[26rem]" />
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

  const max = Math.max(1, ...data.days.map((day) => day.focusedSeconds));
  const activeDays = data.days.filter((day) => day.focusedSeconds > 0).length;
  const subject = subjectId ? subjects.find((item) => item._id === subjectId) ?? null : null;

  // The server tells us how many blank cells to leave so the 1st lands on the right
  // weekday for the user's configured week start.
  const weekdayLabels = buildWeekdayLabels(data.weekStart);

  return (
    <>
      <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-head text-ink">{monthLabel(data.month)}</h1>
            <p className="hint mt-1">
              {duration(data.totalSeconds)} recorded across {activeDays} active day{activeDays === 1 ? '' : 's'}
              {subject ? ` in ${subject.name}` : ''}
              {todayKey.startsWith(data.month) ? ` · ${todayLabel(timeZone)}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {subjects.length > 1 && (
              <select
                aria-label="Filter by subject"
                value={subjectId ?? ''}
                onChange={(event) => patch({ subject: event.target.value || null })}
                className="field w-auto py-1.5 text-tiny"
              >
                <option value="">All subjects</option>
                {subjects.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}

            <Segmented
              ariaLabel="Calendar layout"
              value={view}
              onChange={setView}
              options={[
                { value: 'month', label: 'Grid' },
                { value: 'agenda', label: 'Agenda' },
              ]}
            />

            <div className="flex items-center gap-1.5 rounded-md border border-line bg-sunken p-0.5">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => patch({ month: data.previousMonth })}
                className="rounded-sm px-2 py-1 text-tiny text-faint hover:text-ink"
              >
                ←
              </button>
              {month && (
                <button type="button" onClick={() => patch({ month: null })} className="rounded-sm px-2 py-1 text-micro uppercase text-accent">
                  this month
                </button>
              )}
              <button
                type="button"
                aria-label="Next month"
                onClick={() => patch({ month: data.nextMonth })}
                className="rounded-sm px-2 py-1 text-tiny text-faint hover:text-ink"
              >
                →
              </button>
            </div>
          </div>
        </div>

        {view === 'month' ? (
          <div className="rounded-lg border border-line bg-surface/40 p-3 sm:p-5">
            <div className="grid grid-cols-7 gap-1.5" role="row">
              {weekdayLabels.map((label) => (
                <span key={label} className="pb-1 text-center font-mono text-micro uppercase text-ghost">
                  {label}
                </span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1.5">
              {Array.from({ length: data.lead }).map((_, index) => (
                <span key={`lead-${index}`} className="rounded-md border border-transparent" aria-hidden="true" />
              ))}

              {data.days.map((day) => {
                const ratio = day.focusedSeconds / max;
                const isToday = day.dayKey === todayKey;
                const isSelected = day.dayKey === selectedDay;
                const accent = subject?.color ?? null;

                return (
                  <button
                    key={day.dayKey}
                    type="button"
                    onClick={() => patch({ day: day.dayKey })}
                    aria-label={`${day.dayKey}: ${duration(day.focusedSeconds)}, ${day.sessionCount} sessions${day.goalMet ? ', goal met' : ''}`}
                    className={cn(
                      'group relative flex min-h-[4.5rem] flex-col items-start justify-between rounded-md border p-2 text-left transition-colors duration-quick sm:min-h-[5.5rem]',
                      isSelected ? 'border-accent' : isToday ? 'border-faint' : 'border-line hover:border-faint',
                    )}
                    style={{
                      background:
                        day.focusedSeconds === 0
                          ? 'rgb(var(--sunken) / 0.5)'
                          : accent
                            ? `color-mix(in srgb, ${accent} ${10 + ratio * 35}%, transparent)`
                            : `rgb(var(--accent) / ${(0.06 + ratio * 0.26).toFixed(3)})`,
                    }}
                  >
                    <span className="flex w-full items-baseline justify-between">
                      <span className={cn('font-mono text-micro', isToday ? 'text-ink' : 'text-muted')}>
                        {Number(day.dayKey.slice(8, 10))}
                      </span>
                      {day.goalMet && (
                        <span className="h-1.5 w-1.5 rounded-full bg-good" title="Daily goal met" aria-hidden="true" />
                      )}
                    </span>

                    {day.focusedSeconds > 0 ? (
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-tiny text-ink numeric-stable">{duration(day.focusedSeconds)}</span>
                        <span className="font-mono text-micro text-muted opacity-70">
                          {day.sessionCount} session{day.sessionCount === 1 ? '' : 's'}
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-micro text-ghost opacity-60">—</span>
                    )}

                    {/* Subject split as a thin bar, so a filtered grid still shows
                        which subject dominated each day. */}
                    {day.subjects.length > 0 && (
                      <span className="absolute inset-x-2 bottom-1.5 flex h-[3px] overflow-hidden rounded-pill" aria-hidden="true">
                        {day.subjects.slice(0, 4).map((entry) => (
                          <span
                            key={entry.subjectId}
                            className="h-full"
                            style={{
                              width: `${(entry.seconds / Math.max(1, day.focusedSeconds)) * 100}%`,
                              background: subjects.find((item) => item._id === entry.subjectId)?.color ?? 'rgb(var(--faint))',
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
              <p className="hint">Click any day for its sessions, subjects and timeline.</p>
              <div className="flex items-center gap-2 font-mono text-micro text-faint">
                <span>quiet</span>
                {[0, 0.25, 0.5, 0.75, 1].map((step) => (
                  <span
                    key={step}
                    className="h-3 w-3 rounded-xs"
                    style={{ background: step === 0 ? 'rgb(var(--sunken))' : `rgb(var(--accent) / ${(0.06 + step * 0.26).toFixed(3)})` }}
                    aria-hidden="true"
                  />
                ))}
                <span>intense</span>
              </div>
            </div>
          </div>
        ) : (
          <AgendaView days={data.days} onSelect={(key) => patch({ day: key })} todayKey={todayKey} />
        )}

        {activeDays === 0 && (
          <p className="hint">
            Nothing was recorded in {monthLabel(data.month)}. Days with no sessions are not a failure state — the calendar simply has
            nothing to draw.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => patch({ month: null, subject: null, day: null })}>
            Reset filters
          </Button>
          <Button variant="ghost" size="sm" onClick={reload}>
            Refresh
          </Button>
        </div>
      </div>

      {selectedDay && <DaySheet dayKey={selectedDay} onClose={() => patch({ day: null })} onSelectDay={(key) => patch({ day: key })} />}
    </>
  );
}

/**
 * The agenda.
 *
 * The same data listed rather than drawn, for the case the grid cannot serve: a
 * month with one long session, or a phone at 320px. It is not a fallback — it is
 * the readable rendering of the same record.
 */
function AgendaView({
  days,
  onSelect,
  todayKey,
}: {
  days: Array<{ dayKey: string; focusedSeconds: number; sessionCount: number; completedCount: number; distractionCount: number; goalMet: boolean; subjects: Array<{ subjectId: string; seconds: number }> }>;
  onSelect: (dayKey: string) => void;
  todayKey: string;
}) {
  const subjects = useApp(selectActiveSubjects);
  const active = days.filter((day) => day.focusedSeconds > 0);

  if (active.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
        <p className="text-small text-muted">No recorded days this month.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line/70 rounded-lg border border-line bg-surface/40 px-4 sm:px-6">
      {active.map((day) => (
        <li key={day.dayKey}>
          <button
            type="button"
            onClick={() => onSelect(day.dayKey)}
            className="flex w-full items-center gap-4 py-3 text-left transition-colors duration-quick hover:bg-raised/40"
          >
            <span className="w-20 shrink-0">
              <span className="block font-mono text-small text-ink">{day.dayKey.slice(8, 10)}</span>
              <span className={cn('block font-mono text-micro uppercase', day.dayKey === todayKey ? 'text-accent' : 'text-ghost')}>
                {weekdayShort(day.dayKey)}
              </span>
            </span>

            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-micro text-faint">
                <span className="text-ink">{duration(day.focusedSeconds)}</span>
                <span>{day.sessionCount} sessions</span>
                <span>{day.completedCount} completed</span>
                {day.distractionCount > 0 && <span className="text-pause">{day.distractionCount} interruptions</span>}
                {day.goalMet && <span className="text-good">goal met</span>}
              </span>
              <span className="flex h-1 overflow-hidden rounded-pill" aria-hidden="true">
                {day.subjects.slice(0, 4).map((entry) => (
                  <span
                    key={entry.subjectId}
                    className="h-full"
                    style={{
                      width: `${(entry.seconds / Math.max(1, day.focusedSeconds)) * 100}%`,
                      background: subjects.find((item) => item._id === entry.subjectId)?.color ?? 'rgb(var(--faint))',
                    }}
                  />
                ))}
              </span>
            </span>

            <span className="shrink-0 text-tiny text-ghost">open →</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Weekday headers in the user's configured week order. */
function buildWeekdayLabels(weekStart: number): string[] {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return Array.from({ length: 7 }).map((_, index) => names[(weekStart + index) % 7]);
}
