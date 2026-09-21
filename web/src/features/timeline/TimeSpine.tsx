/**
 * The time spine.
 *
 * A single continuous axis for one day, 00:00 to 24:00, with everything that
 * happened placed where it happened. This is the answer to "where did my day go?"
 * that a bar chart cannot give, because a bar chart throws away *when*.
 *
 * Three registers share the axis, which is what makes it readable at a glance:
 *
 *   - **Focus blocks**, coloured by subject, sitting on the axis. Width is real
 *     recorded time, not planned time.
 *   - **Breaks**, drawn as a thin band directly beneath, so a break is legibly
 *     part of its session rather than a gap.
 *   - **Interruptions**, drawn as small ticks below the axis. A cluster of ticks
 *     in a block is visibly a bad afternoon.
 *
 * The geometry is derived from timestamps in the user's timezone, so it stays
 * correct across DST and if the user changes timezone later.
 */

import { useMemo, useState } from 'react';

import { formatDuration, zonedParts } from '@focusforge/core';

import { clockTime, duration } from '../../lib/format';
import { cn } from '../../components/ui';

export interface TimelineBlock {
  sessionId: string;
  kind: string;
  from: string;
  to: string;
  seconds: number;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
  taskTitle: string | null;
}

export function TimeSpine({
  dayKey,
  timeline,
  timeZone,
  nowKey,
  className,
  onSelectSession,
  selectedSessionId,
}: {
  dayKey: string;
  timeline: TimelineBlock[];
  timeZone: string;
  /** The user's current day key; used to decide whether to draw the "now" line. */
  nowKey?: string;
  className?: string;
  onSelectSession?: (sessionId: string) => void;
  selectedSessionId?: string | null;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const blocks = useMemo(() => {
    return timeline
      .map((entry) => {
        const startMinutes = minuteOfDay(entry.from, timeZone, dayKey);
        const endMinutes = minuteOfDay(entry.to, timeZone, dayKey);
        return {
          ...entry,
          startMinutes,
          // A segment that ends exactly at midnight reads as 1440, and a segment
          // that started the previous day clamps to 0.
          endMinutes: Math.max(endMinutes, startMinutes + 1),
        };
      })
      .sort((a, b) => a.startMinutes - b.startMinutes);
  }, [dayKey, timeZone, timeline]);

  const nowMinutes = nowKey === dayKey ? minuteOfDay(new Date().toISOString(), timeZone, dayKey) : null;

  const focusSeconds = blocks.filter((block) => block.kind === 'focus').reduce((sum, block) => sum + block.seconds, 0);
  const breakSeconds = blocks.filter((block) => block.kind === 'break').reduce((sum, block) => sum + block.seconds, 0);

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label="Focus timeline">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label">The day, hour by hour</h2>
        <p className="font-mono text-micro text-faint">
          {duration(focusSeconds)} focused
          {breakSeconds > 0 && <span className="text-rest"> · {duration(breakSeconds)} on breaks</span>}
        </p>
      </div>

      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center">
          <p className="text-small text-muted">Nothing was recorded on this day.</p>
          <p className="hint mt-1">A day with no sessions is information too — the spine just stays empty.</p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-1 scroll-thin">
          <div className="min-w-[38rem]">
            {/* ----------------------------------------------------- the track */}
            <div className="relative h-[62px] rounded-md border border-line bg-sunken/60">
              {/* Hour grid, every third hour labelled. */}
              {Array.from({ length: 25 }).map((_, hour) => (
                <span
                  key={hour}
                  className={cn('absolute top-0 h-full border-l', hour % 3 === 0 ? 'border-edge/70' : 'border-line/50')}
                  style={{ left: `${(hour / 24) * 100}%` }}
                  aria-hidden="true"
                />
              ))}

              {blocks.map((block) => {
                const left = (block.startMinutes / 1440) * 100;
                const width = Math.max(0.35, ((block.endMinutes - block.startMinutes) / 1440) * 100);
                const isBreak = block.kind === 'break';
                const isActive = hovered === block.sessionId || selectedSessionId === block.sessionId;
                const colour = block.subjectColor ?? 'rgb(var(--accent))';

                return (
                  <button
                    key={`${block.sessionId}-${block.from}-${block.kind}`}
                    type="button"
                    onMouseEnter={() => setHovered(block.sessionId)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(block.sessionId)}
                    onBlur={() => setHovered(null)}
                    onClick={() => onSelectSession?.(block.sessionId)}
                    aria-label={`${isBreak ? 'Break' : 'Focus'} from ${clockTime(block.from, timeZone)} to ${clockTime(block.to, timeZone)}, ${formatDuration(block.seconds, { style: 'short' })}${block.subjectName ? `, ${block.subjectName}` : ''}`}
                    className={cn(
                      'absolute rounded-sm border transition-all duration-quick',
                      isBreak ? 'top-[42px] h-[14px] border-rest/40 bg-rest/25' : 'top-[14px] h-[24px] border-transparent',
                      isActive && 'z-10 ring-1 ring-ink/40',
                    )}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      // A solid block for focus, so subject colour is unmistakable;
                      // breaks stay translucent because they are context, not output.
                      ...(isBreak ? {} : { background: colour, opacity: isActive ? 1 : 0.82 }),
                    }}
                  />
                );
              })}

              {/* The now line. Only drawn for today, and only while it is today. */}
              {nowMinutes !== null && (
                <span
                  className="absolute top-0 z-20 h-full w-px bg-ink/70"
                  style={{ left: `${(nowMinutes / 1440) * 100}%` }}
                  aria-hidden="true"
                >
                  <span className="absolute -top-1 -left-[3px] h-1.5 w-1.5 rounded-full bg-ink" />
                </span>
              )}

              {/* Hour labels sit under the track so they never collide with blocks. */}
              <div className="absolute -bottom-5 left-0 right-0 flex justify-between font-mono text-micro text-ghost">
                {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
                  <span key={hour} className={hour === 24 ? '-mr-3' : ''}>
                    {String(hour).padStart(2, '0')}
                  </span>
                ))}
              </div>
            </div>

            {/* -------------------------------------------------- the tooltip */}
            <div className="mt-7 min-h-[2.25rem]">
              {(() => {
                const block = blocks.find((entry) => entry.sessionId === hovered);
                if (!block) {
                  return (
                    <p className="hint">
                      Hover or focus a block for its exact times. Breaks are the thin band underneath.
                    </p>
                  );
                }
                return (
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-small text-muted">
                    <span className="font-mono text-ink numeric-stable">
                      {clockTime(block.from, timeZone)} – {clockTime(block.to, timeZone)}
                    </span>
                    <span className="text-faint">{block.kind === 'break' ? 'Break' : block.subjectName ?? 'Unfiled'}</span>
                    <span className="font-mono text-faint">{formatDuration(block.seconds, { style: 'short' })}</span>
                    {block.taskTitle && <span className="truncate text-ghost">{block.taskTitle}</span>}
                  </p>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Minutes since local midnight for an instant, in a given zone.
 *
 * Derived through `Intl` rather than by subtracting a fixed offset, which is what
 * keeps a 23- or 25-hour DST day from silently shifting every block by an hour.
 */
export function minuteOfDay(iso: string, timeZone: string, forDayKey?: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 0;

  // Segments are already clipped to the day server-side; anything that appears to
  // start before the day (a clamp from the previous day) is pinned to 00:00.
  const parts = zonedParts(ms, timeZone) as { hour: number; minute: number; day: number; month: number; year: number };
  const minutes = parts.hour * 60 + parts.minute;

  if (forDayKey) {
    const [year, month, day] = forDayKey.split('-').map(Number);
    const isEarlierDay =
      parts.year < year || (parts.year === year && parts.month < month) || (parts.year === year && parts.month === month && parts.day < day);
    if (isEarlierDay) return 0;
  }

  return minutes;
}
