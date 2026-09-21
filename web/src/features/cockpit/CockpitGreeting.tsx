/**
 * The line at the top of the cockpit.
 *
 * It is not a page title. It is a *situational read* — one sentence that tells you
 * where the day stands and what the instrument suggests next. Its whole reason to
 * exist is that a user who opens the app at 9pm and sees "you are 35 minutes from
 * your longest week yet" behaves differently from one who sees an empty frame.
 *
 * The rules it follows, which matter more than the wording:
 *   - Never a value judgement. No "you failed", no "you wasted".
 *   - Never fabricated. If there is not enough data, it says so and offers the
 *     action that fixes that.
 *   - One sentence, and it changes as the day progresses.
 */

import type { OverviewDto } from '../../lib/api';
import { duration } from '../../lib/format';
import { selectActiveSubjects, useApp } from '../../store/app';
import { useTimer } from '../../store/timer';
import { Link } from 'react-router-dom';

export function CockpitGreeting() {
  const overview = useApp((state) => state.overview);
  const user = useApp((state) => state.user);
  const subjects = useApp(selectActiveSubjects);
  const { phase } = useTimer();

  const greeting = greetingFor(new Date().getHours());
  const firstName = (user?.name || '').split(' ')[0];

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
      <p className="text-lead text-ink">
        {greeting}
        {firstName ? <span className="text-muted">, {firstName}</span> : null}
        <span className="text-muted">
          {' '}
          — {situation({ overview, subjects: subjects.length, phase })}
        </span>
      </p>

      {overview && !overview.today.goalMet && overview.today.goalSeconds > 0 && (
        <p className="font-mono text-micro uppercase tracking-[0.08em] text-faint">
          {duration(Math.max(0, overview.today.remainingSeconds))} to today's goal
        </p>
      )}
    </div>
  );
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Late one';
}

/**
 * Pick the most informative true statement available.
 *
 * The order is deliberate: a live session outranks everything (you do not need
 * encouragement mid-session), then a completed goal, then a streak in progress,
 * then the shape of the day, and finally the honest empty state.
 */
function situation({
  overview,
  subjects,
  phase,
}: {
  overview: OverviewDto | null;
  subjects: number;
  phase: string;
}): string {
  if (phase === 'focus') return 'the clock is running.';
  if (phase === 'break') return 'you are on a break.';
  if (phase === 'paused') return 'paused — the session is still open.';
  if (!overview) return 'loading your record.';

  if (subjects === 0) return 'start by naming what you are working on.';

  const { today, streak, week } = overview;

  if (today.sessionCount === 0) {
    return today.goalSeconds > 0
      ? `nothing recorded yet today. ${duration(today.goalSeconds)} is the target.`
      : 'nothing recorded yet today.';
  }

  if (today.goalMet) {
    return streak.daily.current > 1
      ? `today's goal is done and the run is at ${streak.daily.current} days.`
      : "today's goal is done. Anything further is a bonus.";
  }

  if (today.goalSeconds > 0) {
    const remaining = today.remainingSeconds;
    if (remaining <= 600) return `${duration(remaining)} short of today's goal — one short session would do it.`;
    return `${duration(today.focusedSeconds)} recorded, ${duration(remaining)} to go.`;
  }

  return `${duration(today.focusedSeconds)} recorded across ${today.sessionCount} session${today.sessionCount === 1 ? '' : 's'} so far today, and ${duration(week.focusedSeconds)} this week.`;
}

/** A quiet link into the review flow, used by the evening variant. */
export function ReviewNudge() {
  return (
    <Link to="/review/daily" className="text-tiny text-accent hover:underline">
      Review today →
    </Link>
  );
}
