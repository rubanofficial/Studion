/**
 * The visualisation library.
 *
 * These are not chart-library components with a theme applied. Each one is drawn
 * to answer a specific question about a person's week, and the interaction model
 * is "hover for the number" rather than "read the axis".
 *
 * Three deliberate departures from dashboard convention:
 *
 *   - **The day dial** is a 24-hour polar plot. A time-of-day distribution shown as
 *     a bar chart loses its shape; shown as a dial, "I work after dinner" is
 *     immediately obvious as a lobe on one side.
 *   - **The landscape** has no y-axis. Its target line is a hairline, and the days
 *     that met it are coloured differently. The question is "how many days did I
 *     show up", not "what was the exact value on Wednesday".
 *   - **The heatmap** is a contribution grid with a real intensity scale derived
 *     from the user's own maximum, not fixed thresholds — someone whose best day is
 *     45 minutes should not see a grid that is entirely the palest shade.
 *
 * Every component is keyboard reachable and announces its data in text, because a
 * visualisation that only exists as colour is not accessible.
 */

import { useMemo, useState } from 'react';

import { formatDuration, weekdayOfKey } from '@focusforge/core';

import type { AnalyticsDto, DailyCellDto, HeatmapDto } from '../../lib/api';
import { dayOfMonth, duration, shortDate, weekdayShort } from '../../lib/format';
import { cn } from '../../components/ui';

// ============================================================== the day dial

/**
 * A polar plot of focus time by hour of day.
 *
 * Each hour is a wedge whose radial extent is that hour's recorded minutes,
 * normalised against the period's busiest hour. Three rings mark 25%, 50% and 75%
 * of the maximum so the shape has a scale even though nothing is labelled in
 * degrees.
 */
export function DayDial({
  hourly,
  size = 260,
  label = 'Focus by hour of day',
}: {
  hourly: Array<{ hour: number; seconds: number; sessionStarts: number }>;
  size?: number;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...hourly.map((entry) => entry.seconds));
  const total = hourly.reduce((sum, entry) => sum + entry.seconds, 0);

  const centre = size / 2;
  const outer = centre - 18;
  const inner = centre * 0.34;

  /** Polar → cartesian, with 00:00 at the top and the day running clockwise. */
  const point = (hour: number, radius: number) => {
    const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    return [centre + Math.cos(angle) * radius, centre + Math.sin(angle) * radius] as const;
  };

  const busiest = hourly.reduce((top, entry) => (entry.seconds > top.seconds ? entry : top), hourly[0] ?? { hour: 0, seconds: 0, sessionStarts: 0 });

  return (
    <div className="flex flex-col items-center gap-3">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[19rem]"
        role="img"
        aria-label={`${label}. Busiest hour ${String(busiest.hour).padStart(2, '0')}:00 with ${formatDuration(busiest.seconds, { style: 'short' })} across the period.`}
      >
        {/* Guide rings. */}
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <circle
            key={ratio}
            cx={centre}
            cy={centre}
            r={inner + (outer - inner) * ratio}
            fill="none"
            stroke="rgb(var(--line))"
            strokeWidth={ratio === 1 ? 1 : 0.6}
            strokeDasharray={ratio === 1 ? undefined : '2 4'}
          />
        ))}

        {/* Hour wedges. */}
        {hourly.map((entry) => {
          const ratio = entry.seconds / max;
          const radius = inner + (outer - inner) * ratio;
          const active = hover === entry.hour;
          const [x1, y1] = point(entry.hour, inner);
          const [x2, y2] = point(entry.hour + 1, inner);
          const [x3, y3] = point(entry.hour + 1, radius);
          const [x4, y4] = point(entry.hour, radius);
          const hasData = entry.seconds > 0;

          return (
            <path
              key={entry.hour}
              d={`M ${x1} ${y1} A ${inner} ${inner} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${radius} ${radius} 0 0 0 ${x4} ${y4} Z`}
              fill={hasData ? 'rgb(var(--accent))' : 'rgb(var(--raised))'}
              fillOpacity={hasData ? (active ? 0.85 : 0.35 + ratio * 0.4) : 0.5}
              stroke={active ? 'rgb(var(--ink))' : 'rgb(var(--line))'}
              strokeWidth={active ? 1 : 0.5}
              onMouseEnter={() => setHover(entry.hour)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: 'fill-opacity var(--dur-quick) linear' }}
            />
          );
        })}

        {/* Clock-face numerals every three hours. */}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hour) => {
          const [x, y] = point(hour, outer + 13);
          return (
            <text
              key={hour}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-[rgb(var(--faint))] font-mono"
              style={{ fontSize: '9px' }}
            >
              {String(hour).padStart(2, '0')}
            </text>
          );
        })}

        {/* The centre readout: hovered hour, or the period's busiest window. */}
        <text x={centre} y={centre - 4} textAnchor="middle" className="fill-[rgb(var(--ink))] font-mono" style={{ fontSize: '15px' }}>
          {hover !== null ? `${String(hover).padStart(2, '0')}:00` : `${String(busiest.hour).padStart(2, '0')}:00`}
        </text>
        <text x={centre} y={centre + 12} textAnchor="middle" className="fill-[rgb(var(--faint))] font-mono" style={{ fontSize: '9px' }}>
          {hover !== null
            ? formatDuration(hourly[hover]?.seconds ?? 0, { style: 'short' })
            : `peak · ${formatDuration(busiest.seconds, { style: 'short' })}`}
        </text>
      </svg>

      <p className="hint max-w-[20rem] text-center">
        {total === 0
          ? 'No focus recorded in this period, so the dial is empty.'
          : 'Recorded focus by hour of day. The shape is what matters here — a lobe between 20:00 and 23:00 is an evening habit.'}
      </p>
    </div>
  );
}

// ========================================================= the focus landscape

/**
 * The period as a landscape.
 *
 * Not a bar chart: the baseline is the target, days that met it are filled solid,
 * days that did not are translucent, and empty days are a short stub rather than
 * nothing, so "I did not study Tuesday" is visible rather than absent.
 */
export function FocusLandscape({
  series,
  goalSeconds,
  onSelect,
  selectedKey,
  compact = false,
}: {
  series: DailyCellDto[];
  goalSeconds: number;
  onSelect?: (dayKey: string) => void;
  selectedKey?: string | null;
  compact?: boolean;
}) {
  const max = Math.max(goalSeconds, ...series.map((cell) => cell.focusedSeconds), 1);
  const height = compact ? 44 : 96;
  const [hover, setHover] = useState<string | null>(null);

  const goalLine = goalSeconds > 0 ? Math.round((goalSeconds / max) * height) : null;
  const activeKey = hover ?? selectedKey ?? null;
  const active = series.find((cell) => cell.dayKey === activeKey) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-[0.3rem]" role="img" aria-label={describeLandscape(series, goalSeconds)}>
        {series.map((cell) => {
          const ratio = cell.focusedSeconds / max;
          const barHeight = cell.focusedSeconds === 0 ? 2 : Math.max(4, Math.round(ratio * height));
          const isActive = cell.dayKey === activeKey;
          const clickable = Boolean(onSelect);

          return (
            <div
              key={cell.dayKey}
              className="group relative flex flex-1 flex-col items-center"
              onMouseEnter={() => setHover(cell.dayKey)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="relative w-full" style={{ height }}>
                {goalLine !== null && (
                  <span
                    className="absolute inset-x-0 z-10 border-t border-dashed border-ghost/70"
                    style={{ bottom: goalLine }}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    'absolute inset-x-0 bottom-0 rounded-t-xs transition-[height,background-color] duration-calm ease-forge',
                    cell.goalMet ? 'bg-good' : 'bg-accent',
                    isActive && 'ring-1 ring-ink/40',
                  )}
                  style={{ height: barHeight, opacity: cell.focusedSeconds === 0 ? 0.2 : cell.goalMet ? 0.9 : 0.55 }}
                />
              </div>

              {!compact && (
                <span className={cn('mt-2 font-mono text-micro uppercase', isActive ? 'text-ink' : 'text-ghost')}>
                  {weekdayShort(cell.dayKey).slice(0, 1)}
                  <span className="ml-0.5 opacity-60">{dayOfMonth(cell.dayKey)}</span>
                </span>
              )}

              {clickable && (
                <button
                  type="button"
                  onClick={() => onSelect?.(cell.dayKey)}
                  className="absolute inset-0 cursor-pointer"
                  aria-label={`${shortDate(cell.dayKey)}: ${formatDuration(cell.focusedSeconds, { style: 'short' })}, ${cell.sessionCount} sessions. Open the day.`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* The readout replaces a tooltip: it holds its space so nothing jumps. */}
      <div className="flex min-h-[1.5rem] items-baseline justify-between gap-3">
        <p className="text-small text-muted">
          {active ? (
            <>
              <span className="text-ink">{shortDate(active.dayKey)}</span>
              <span className="text-faint">
                {' '}
                · {duration(active.focusedSeconds)} · {active.sessionCount} session{active.sessionCount === 1 ? '' : 's'}
                {active.distractionCount > 0 ? ` · ${active.distractionCount} interruption${active.distractionCount === 1 ? '' : 's'}` : ''}
                {active.goalMet ? ' · goal met' : ''}
              </span>
            </>
          ) : (
            <span className="hint">
              {goalSeconds > 0 ? `Dashed line is the ${duration(goalSeconds)} daily target.` : 'Hover a day for its numbers.'}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function describeLandscape(series: DailyCellDto[], goalSeconds: number): string {
  const days = series.length;
  const met = series.filter((cell) => cell.goalMet).length;
  const total = series.reduce((sum, cell) => sum + cell.focusedSeconds, 0);
  const best = series.reduce((top, cell) => (cell.focusedSeconds > top.focusedSeconds ? cell : top), series[0] ?? { dayKey: '', focusedSeconds: 0 } as DailyCellDto);
  return `${days} days, ${formatDuration(total, { style: 'short' })} total, ${met} days at or above the ${formatDuration(goalSeconds, { style: 'short' })} target. Best day ${best.dayKey} with ${formatDuration(best.focusedSeconds, { style: 'short' })}.`;
}

// ============================================================ subject breakdown

/**
 * Subject distribution as a single stacked bar plus a ranked list.
 *
 * A pie chart would be the convention here and would be worse: with six subjects
 * the slices become unreadable, and comparing 42% to 31% by angle is guesswork.
 * A ranked list with an explicit percentage is exact, and the stacked bar above it
 * carries the "shape of my week" impression for free.
 */
export function SubjectDistribution({
  subjects,
  totalSeconds,
}: {
  subjects: AnalyticsDto['summary']['subjects'];
  totalSeconds: number;
}) {
  if (subjects.length === 0) {
    return (
      <p className="hint py-6 text-center">
        No subject has recorded time in this period yet. Subjects appear here once a session is filed against them.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-sunken" role="img" aria-label={describeDistribution(subjects)}>
        {subjects.map((entry) => (
          <span
            key={entry.subjectId}
            className="h-full transition-[width] duration-calm ease-forge"
            style={{ width: `${Math.max(0.5, entry.share * 100)}%`, background: entry.color ?? 'rgb(var(--faint))' }}
            title={`${entry.name}: ${duration(entry.focusedSeconds)} (${Math.round(entry.share * 100)}%)`}
          />
        ))}
      </div>

      <ul className="divide-y divide-line/70">
        {subjects.map((entry) => (
          <li key={entry.subjectId} className="flex items-center gap-3 py-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color ?? 'rgb(var(--faint))' }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-small text-ink">{entry.name}</span>
              <span className="mt-0.5 block font-mono text-micro text-faint">
                {entry.sessionCount} session{entry.sessionCount === 1 ? '' : 's'}
                {entry.averageScore !== null ? ` · avg score ${Math.round(entry.averageScore)}` : ''}
                {entry.avgSessionSeconds > 0 ? ` · avg ${duration(entry.avgSessionSeconds)}` : ''}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-small text-ink numeric-stable">{duration(entry.focusedSeconds)}</span>
              <span className="block font-mono text-micro text-faint">{Math.round(entry.share * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="hint">
        Every session in this period accounts for {totalSeconds > 0 ? '100%' : '0%'} of {duration(totalSeconds)} of recorded time.
      </p>
    </div>
  );
}

function describeDistribution(subjects: AnalyticsDto['summary']['subjects']): string {
  return subjects.map((entry) => `${entry.name} ${Math.round(entry.share * 100)} percent`).join(', ');
}

// ==================================================================== heatmap

/**
 * A year of focus intensity.
 *
 * Intensity is relative to the user's own busiest day, so a student whose best day
 * is forty minutes still gets a grid with contrast in it. Weeks run as columns,
 * Monday at the top, matching the calendar view.
 */
export function FocusHeatmap({
  heatmap,
  onSelectDay,
  selectedKey,
}: {
  heatmap: HeatmapDto;
  onSelectDay?: (dayKey: string) => void;
  selectedKey?: string | null;
}) {
  const [hover, setHover] = useState<{ cell: HeatmapDto['cells'][number]; x: number; y: number } | null>(null);

  const columns = useMemo(() => {
    // Group into weeks. The server returns whole days in order, so the first
    // column is padded to line up with the correct weekday.
    const padded: Array<HeatmapDto['cells'][number] | null> = [...heatmap.cells];
    const firstWeekday = padded[0] ? mondayIndex(padded[0].dayKey) : 0;
    for (let index = 0; index < firstWeekday; index += 1) padded.unshift(null);

    const weeks: Array<Array<HeatmapDto['cells'][number] | null>> = [];
    for (let index = 0; index < padded.length; index += 7) weeks.push(padded.slice(index, index + 7));
    return weeks;
  }, [heatmap.cells]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-micro uppercase tracking-[0.08em] text-faint">
          {shortDate(heatmap.fromKey)} → {shortDate(heatmap.toKey)}
        </p>
        <p className="font-mono text-micro text-faint">
          {heatmap.activeDays} active day{heatmap.activeDays === 1 ? '' : 's'} · {duration(heatmap.totalSeconds)}
        </p>
      </div>

      <div className="relative overflow-x-auto pb-2 scroll-thin">
        <div className="flex gap-[3px]">
          {columns.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-[3px]">
              {week.map((cell, dayIndex) => {
                if (!cell) return <span key={`pad-${weekIndex}-${dayIndex}`} className="h-[11px] w-[11px]" aria-hidden="true" />;
                const isSelected = cell.dayKey === selectedKey;
                const isHover = hover?.cell.dayKey === cell.dayKey;
                return (
                  <button
                    key={cell.dayKey}
                    type="button"
                    onMouseEnter={(event) => setHover({ cell, x: event.clientX, y: event.clientY })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ cell, x: 0, y: 0 })}
                    onBlur={() => setHover(null)}
                    onClick={() => onSelectDay?.(cell.dayKey)}
                    aria-label={`${cell.dayKey}: ${formatDuration(cell.focusedSeconds, { style: 'short' })}, ${cell.sessionCount} sessions`}
                    className={cn(
                      'h-[11px] w-[11px] rounded-xs border transition-transform duration-quick',
                      isSelected ? 'border-ink' : isHover ? 'border-faint' : 'border-transparent',
                    )}
                    style={{ background: heatColour(cell.intensity, cell.focusedSeconds > 0) }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 font-mono text-micro text-faint">
          <span>less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <span key={step} className="h-[11px] w-[11px] rounded-xs" style={{ background: heatColour(step, step > 0) }} aria-hidden="true" />
          ))}
          <span>more</span>
          {heatmap.maxSeconds > 0 && <span className="ml-2 text-ghost">peak {duration(heatmap.maxSeconds)}</span>}
        </div>
        {heatmap.peakDay && (
          <p className="hint">
            Best day: <span className="text-muted">{shortDate(heatmap.peakDay.dayKey)}</span> · {duration(heatmap.peakDay.focusedSeconds)}
          </p>
        )}
      </div>

      {/* A fixed-position readout rather than a chart tooltip: no layout shift and
          it works the same when reached by keyboard focus. */}
      <p className="min-h-[1.25rem] text-small text-muted" aria-live="polite">
        {hover ? (
          <>
            <span className="text-ink">{shortDate(hover.cell.dayKey)}</span>
            <span className="text-faint">
              {' '}
              · {duration(hover.cell.focusedSeconds)} · {hover.cell.sessionCount} session{hover.cell.sessionCount === 1 ? '' : 's'}
              {hover.cell.averageFocusScore !== null ? ` · avg score ${Math.round(hover.cell.averageFocusScore)}` : ''}
              {hover.cell.goalMet ? ' · goal met' : ''}
            </span>
          </>
        ) : (
          <span className="hint">Click a day to open it.</span>
        )}
      </p>
    </div>
  );
}

/** Intensity is normalised server-side against the user's own peak. */
function heatColour(intensity: number, hasData: boolean): string {
  if (!hasData) return 'rgb(var(--raised))';
  const alpha = 0.22 + Math.min(1, Math.max(0, intensity)) * 0.78;
  return `rgb(var(--accent) / ${alpha.toFixed(2)})`;
}

/** Day key → Monday-based weekday index. */
function mondayIndex(dayKey: string): number {
  const weekday = weekdayOfKey(dayKey) as number;
  return (weekday + 6) % 7;
}

// ============================================================= hourly density

/**
 * A single-day hour histogram.
 *
 * Distinct from the dial: at a day's scale the useful question is contiguous
 * blocks ("you worked 09:00–11:30 and then not again"), which a linear axis shows
 * better than a polar one.
 */
export function HourHistogram({ hourly, height = 56 }: { hourly: Array<{ hour: number; seconds: number }>; height?: number }) {
  const max = Math.max(1, ...hourly.map((entry) => entry.seconds));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label={densityDescription(hourly)}>
        {hourly.map((entry) => (
          <span
            key={entry.hour}
            className="flex-1 rounded-t-xs bg-accent/70 transition-[height] duration-calm ease-forge"
            style={{ height: entry.seconds === 0 ? 2 : Math.max(3, Math.round((entry.seconds / max) * height)) }}
            title={`${String(entry.hour).padStart(2, '0')}:00 — ${formatDuration(entry.seconds, { style: 'short' })}`}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-micro text-ghost">
        {[0, 6, 12, 18, 23].map((hour) => (
          <span key={hour}>{String(hour).padStart(2, '0')}</span>
        ))}
      </div>
    </div>
  );
}

function densityDescription(hourly: Array<{ hour: number; seconds: number }>): string {
  const active = hourly.filter((entry) => entry.seconds > 0);
  if (active.length === 0) return 'No focus recorded.';
  const first = active[0];
  const last = active[active.length - 1];
  return `Focus spread across ${active.length} hours, from ${String(first.hour).padStart(2, '0')}:00 to ${String(last.hour).padStart(2, '0')}:00.`;
}

// ================================================================ comparisons

/**
 * A comparison row list.
 *
 * The sign is always shown, and zero is shown as "no change" rather than "+0" —
 * small copy decisions, but this is the component a user reads to decide whether
 * the week went well, and ambiguity there is expensive.
 */
export function ComparisonList({
  rows,
  dense = false,
}: {
  rows: AnalyticsDto['comparison'];
  dense?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="hint py-4">No previous period to compare against yet.</p>;
  }

  return (
    <ul className={cn('divide-y divide-line/70', dense && 'text-small')}>
      {rows.map((row) => {
        const delta = row.delta;
        const hasDelta = delta !== null && row.previous !== null;
        const direction = !hasDelta || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
        return (
          <li key={row.key} className="flex items-baseline justify-between gap-4 py-2.5">
            <span className="text-small text-muted">{row.label}</span>
            <span className="flex items-baseline gap-3">
              <span className="font-mono text-small text-ink numeric-stable">{formatComparisonValue(row.current, row.format)}</span>
              {row.previous !== null && (
                <span className="font-mono text-micro text-ghost numeric-stable">{formatComparisonValue(row.previous, row.format)}</span>
              )}
              <span
                className={cn(
                  'w-[4.5rem] text-right font-mono text-micro numeric-stable',
                  direction === 'up' ? 'text-good' : direction === 'down' ? 'text-pause' : 'text-ghost',
                )}
              >
                {!hasDelta || delta === null
                  ? 'new'
                  : delta === 0
                    ? 'no change'
                    : `${delta > 0 ? '+' : '−'}${formatComparisonValue(Math.abs(delta), row.format)}`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function formatComparisonValue(value: number, format: AnalyticsDto['comparison'][number]['format']): string {
  if (format === 'duration') return formatDuration(Math.round(value), { style: 'short' });
  if (format === 'count') return String(Math.round(value));
  if (format === 'percent') return `${Math.round(value)}%`;
  return String(Math.round(value));
}
