/**
 * Momentum — the right instrument strip.
 *
 * This is where the cockpit turns recorded time into a sense of build-up. It is
 * the antidote to the empty dashboard: even with four sessions recorded, the user
 * sees a shape forming — the week's landscape, the streak, the next achievement
 * within reach.
 *
 * The week landscape is deliberately *not* a bar chart with axes. It is a row of
 * vertical marks with a hairline target line, read left to right like a pulse
 * trace. You can tell whether today is ahead of yesterday without reading a
 * single number, and the numbers are one hover away if you want them.
 */

import { Link } from 'react-router-dom';

import { duration, weekdayShort } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { cn } from '../../components/ui';

export function Momentum() {
  const overview = useApp((state) => state.overview);
  const subjects = useApp(selectActiveSubjects);
  const achievements = useApp((state) => state.achievements);

  if (!overview) return null;

  const { today, week, streak } = overview;
  const goalRatio = today.goalSeconds > 0 ? Math.min(1, today.focusedSeconds / today.goalSeconds) : 0;
  const weekMax = Math.max(
    today.goalSeconds || 0,
    ...week.series.map((cell) => cell.focusedSeconds),
    1,
  );

  const nextAchievement = achievements?.inProgress?.[0] ?? null;

  return (
    <aside aria-label="Momentum" className="flex flex-col gap-5">
      {/* ------------------------------------------------------------- today */}
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="label">Today</h2>
          <span className={cn('font-mono text-micro uppercase', today.goalMet ? 'text-good' : 'text-faint')}>
            {today.goalMet ? 'goal met' : today.goalSeconds > 0 ? `${duration(today.remainingSeconds)} left` : 'no goal set'}
          </span>
        </div>

        <div className="mt-2.5 flex items-center gap-3.5">
          <SmallRing ratio={goalRatio} size={56} />
          <div className="min-w-0">
            <p className="font-mono text-lead text-ink numeric-stable">{duration(today.focusedSeconds)}</p>
            <p className="hint">
              {today.goalSeconds > 0 ? `of ${duration(today.goalSeconds)}` : 'set a daily goal in settings'}
            </p>
            <p className="hint mt-0.5">
              {today.sessionCount} session{today.sessionCount === 1 ? '' : 's'}
              {today.breakSeconds > 0 ? ` · ${duration(today.breakSeconds)} paused` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------- the landscape */}
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="label">This week</h2>
          <Link to="/insights" className="text-tiny text-accent hover:underline">
            Open →
          </Link>
        </div>

        <div className="mt-3 flex items-end justify-between gap-1.5" role="img" aria-label={describeWeek(week.series)}>
          {week.series.map((cell) => {
            const height = Math.max(2, Math.round((cell.focusedSeconds / weekMax) * 64));
            const isToday = cell.dayKey === today.dayKey;
            return (
              <div key={cell.dayKey} className="flex flex-1 flex-col items-center gap-1.5" title={`${cell.dayKey}: ${duration(cell.focusedSeconds)} across ${cell.sessionCount} session(s)`}>
                <div className="relative flex h-16 w-full items-end justify-center">
                  {/* The hairline target line is what turns a bar into a measurement. */}
                  {today.goalSeconds > 0 && (
                    <span
                      className="absolute inset-x-0 border-t border-dashed border-ghost/60"
                      style={{ bottom: `${Math.round((today.goalSeconds / weekMax) * 64)}px` }}
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className={cn('w-full rounded-xs transition-[height] duration-calm ease-forge', cell.goalMet ? 'bg-good/70' : 'bg-accent/70')}
                    style={{ height: `${height}px`, opacity: cell.focusedSeconds === 0 ? 0.25 : 1 }}
                  />
                </div>
                <span className={cn('font-mono text-micro uppercase', isToday ? 'text-ink' : 'text-ghost')}>
                  {weekdayShort(cell.dayKey).slice(0, 2)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-2.5 flex items-baseline justify-between font-mono text-micro text-faint">
          <span>{duration(week.focusedSeconds)} this week</span>
          {week.goalSeconds > 0 && <span>target {duration(week.goalSeconds)}</span>}
        </div>
      </div>

      {/* ------------------------------------------------------------- streak */}
      <div>
        <h2 className="label">Streak</h2>
        <div className="mt-2 flex items-end gap-4">
          <div>
            <p className="font-mono text-head text-ink numeric-stable">
              {streak.daily.current}
              <span className="ml-1 text-lead text-faint">day{streak.daily.current === 1 ? '' : 's'}</span>
            </p>
            <p className="hint mt-0.5">
              {streak.daily.isTodayMet
                ? 'Today already counts.'
                : streak.daily.current === 0
                  ? `Reach ${duration(streak.daily.thresholdSeconds)} today to start one.`
                  : `${duration(streak.daily.thresholdSeconds)} today keeps it alive.`}
            </p>
          </div>
          <div className="ml-auto text-right">
            <p className="font-mono text-small text-muted numeric-stable">{streak.daily.longest}d</p>
            <p className="text-micro uppercase tracking-[0.06em] text-ghost">longest</p>
            <p className="mt-1.5 font-mono text-small text-muted numeric-stable">{streak.weekly.current}w</p>
            <p className="text-micro uppercase tracking-[0.06em] text-ghost">weekly run</p>
          </div>
        </div>

        {!streak.daily.isTodayMet && streak.daily.current > 0 && today.goalSeconds > 0 && (
          <p className="mt-2 rounded-md border border-pause/25 bg-pause/[0.05] px-2.5 py-2 text-tiny text-muted">
            {duration(Math.max(0, streak.daily.thresholdSeconds - today.focusedSeconds))} of recorded focus is all it takes to keep the
            run going.
          </p>
        )}
      </div>

      {/* -------------------------------------------------- next achievement */}
      {nextAchievement && (
        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="label">Within reach</h2>
            <Link to="/achievements" className="text-tiny text-accent hover:underline">
              All →
            </Link>
          </div>
          <p className="mt-2 text-small text-ink">{nextAchievement.name}</p>
          <p className="hint mt-0.5">{nextAchievement.remainingLabel}</p>
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-pill bg-sunken">
            <div
              className="h-full rounded-pill bg-accent transition-[width] duration-calm ease-forge"
              style={{ width: `${Math.round(nextAchievement.progress * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 font-mono text-micro text-faint">{nextAchievement.progressLabel}</p>
        </div>
      )}

      {/* ---------------------------------------------------- recent sessions */}
      <div>
        <h2 className="label">Recorded</h2>
        {overview.recentSessions.length === 0 ? (
          <p className="hint mt-2">Nothing yet. The first completed session appears here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line/70">
            {overview.recentSessions.slice(0, 5).map((session) => {
              const subject = session.subjectId ? subjects.find((item) => item._id === session.subjectId) : null;
              return (
                <li key={session.id} className="flex items-center gap-2.5 py-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: session.subjectColor ?? subject?.color ?? 'rgb(var(--faint))' }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-small text-muted">
                    {session.subjectName ?? subject?.name ?? 'Unfiled'}
                  </span>
                  <span className="shrink-0 font-mono text-micro text-faint numeric-stable">
                    {duration(session.focusedSeconds)}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 font-mono text-micro uppercase',
                      session.status === 'completed' ? 'text-good' : session.status === 'interrupted' ? 'text-pause' : 'text-ghost',
                    )}
                  >
                    {statusGlyph(session.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

function statusGlyph(status: string): string {
  if (status === 'completed') return 'done';
  if (status === 'interrupted') return 'cut';
  if (status === 'cancelled') return 'void';
  return status.slice(0, 4);
}

/** A small progress ring. Shares its geometry with the Core, at 1/7 the size. */
export function SmallRing({ ratio, size = 56, tone = 'accent' }: { ratio: number; size?: number; tone?: 'accent' | 'good' }) {
  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const colour = tone === 'good' ? 'rgb(var(--state-good))' : 'rgb(var(--accent))';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgb(var(--line))" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={colour}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, ratio)))}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset var(--dur-calm) var(--ease-forge)' }}
      />
    </svg>
  );
}

function describeWeek(series: Array<{ dayKey: string; focusedSeconds: number }>): string {
  const total = series.reduce((sum, cell) => sum + cell.focusedSeconds, 0);
  const best = series.reduce((top, cell) => (cell.focusedSeconds > top.focusedSeconds ? cell : top), series[0] ?? { dayKey: '', focusedSeconds: 0 });
  return `This week: ${duration(total)} recorded. Best day ${best.dayKey ? weekdayShort(best.dayKey) : 'n/a'} with ${duration(best.focusedSeconds)}.`;
}
