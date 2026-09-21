/**
 * Achievements.
 *
 * Mature by construction, not by restraint applied afterwards. There are no
 * confetti animations, no mascots, no "you're on fire" copy. Each achievement is a
 * threshold on a metric the product already records, drawn as a defined instrument
 * marking: a tier, a target, and how far away it is.
 *
 * Two design rules that keep it from becoming a children's game:
 *   - **Progress is always exact and always visible.** "12 of 15 sessions" beats a
 *     badge that is either there or not.
 *   - **Nothing is hidden.** Locked achievements are listed alongside unlocked ones,
 *     because a visible distant goal is motivating and a mystery box is not.
 */

import { useEffect } from 'react';

import { duration } from '../../lib/format';
import { useAchievements } from '../../data/queries';
import { useApp } from '../../store/app';
import { Button, ErrorState, SectionHeading, Skeleton, cn } from '../../components/ui';
import type { AchievementDto } from '../../lib/api';

const TIER_LABEL: Record<AchievementDto['tier'], string> = {
  bronze: 'Milestone',
  silver: 'Consistent',
  gold: 'Deep work',
  platinum: 'Sustained',
};

export function AchievementsView() {
  const { data, loading, error, reload } = useAchievements();
  const markSeen = useApp((state) => state.markAchievementsSeen);
  const settings = useApp((state) => state.settings);

  // Opening this screen is the acknowledgement, so the "new" dot clears itself.
  useEffect(() => {
    if (data && data.unseenCount > 0) void markSeen();
  }, [data, markSeen]);

  if (loading && !data) {
    return (
      <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-5 px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-56" label="Loading achievements" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-10 sm:px-6">
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  if (!data) return null;

  const { achievements, unlocked, inProgress, stats, streaks } = data;

  return (
    <div className="mx-auto flex w-full max-w-[68rem] flex-col gap-9 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-head text-ink">Achievements</h1>
          <p className="hint mt-1 max-w-2xl">
            Thresholds on the time you have already recorded. Nothing here is earned by opening the app — every one of them requires
            sessions to exist.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={reload}>
          Recalculate
        </Button>
      </div>

      {/* --------------------------------------------------------- the totals */}
      <div className="grid gap-4 sm:grid-cols-4">
        <TotalCell label="Unlocked" value={`${data.unlockedCount}`} sub={`of ${data.totalCount}`} />
        <TotalCell label="Lifetime focus" value={duration(stats.totalFocusedSeconds ?? 0)} sub="all recorded sessions" />
        <TotalCell
          label="Sessions"
          value={String(stats.totalSessions ?? 0)}
          sub={`${stats.cleanSessionCount ?? 0} with no interruptions`}
        />
        <TotalCell
          label="Best streak"
          value={`${streaks.daily.longest}d`}
          sub={`currently ${streaks.daily.current} day${streaks.daily.current === 1 ? '' : 's'}`}
        />
      </div>

      {/* ----------------------------------------------------------- unlocked */}
      <section>
        <SectionHeading
          title="Unlocked"
          detail={unlocked.length === 0 ? 'Nothing unlocked yet — the first sessions will start the count.' : `${unlocked.length} earned`}
        />
        {unlocked.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-small text-muted">
            The first one is{' '}
            {achievements.find((achievement) => !achievement.unlocked)?.name ?? 'a completed session'}. Complete one session and it appears
            here.
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {unlocked.map((achievement) => (
              <AchievementCard key={achievement.id} achievement={achievement} />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------ within reach */}
      {inProgress.length > 0 && (
        <section>
          <SectionHeading title="Within reach" detail="Ordered by how close you are. No hidden progress." />
          <ul className="mt-3 flex flex-col gap-2.5">
            {inProgress.map((achievement) => (
              <li key={achievement.id} className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-small text-ink">{achievement.name}</p>
                    <p className="hint mt-0.5">{achievement.description}</p>
                  </div>
                  <span className="shrink-0 font-mono text-micro text-faint">{achievement.progressLabel}</span>
                </div>
                <div className="mt-3 h-[3px] w-full overflow-hidden rounded-pill bg-sunken">
                  <div
                    className="h-full rounded-pill bg-accent transition-[width] duration-calm ease-forge"
                    style={{ width: `${Math.round(achievement.progress * 100)}%` }}
                  />
                </div>
                <p className="hint mt-1.5">{achievement.remainingLabel}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------ all, including locked */}
      <section>
        <SectionHeading
          title="Everything, including what you have not reached"
          detail={`${achievements.length - data.unlockedCount} still locked. They are shown rather than hidden — a visible distant goal is more useful than a mystery.`}
        />
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {achievements.map((achievement) => (
            <AchievementCard key={achievement.id} achievement={achievement} />
          ))}
        </ul>
      </section>

      {settings && (
        <p className="hint border-t border-line pt-5">
          Achievement progress is computed from your session history each time this screen is opened. It is derived, never stored as a
          separate score — so deleting a session genuinely does take progress back.
        </p>
      )}
    </div>
  );
}

function TotalCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
      <p className="label">{label}</p>
      <p className="mt-1 font-mono text-title text-ink numeric-stable">{value}</p>
      <p className="hint mt-0.5">{sub}</p>
    </div>
  );
}

/**
 * One achievement.
 *
 * The tier is expressed as a border tint and a word, not as a colour-coded medal.
 * Colour alone would fail for a colour-blind user, and a medal graphic would push
 * the whole screen toward the toy aesthetic this product is avoiding.
 */
function AchievementCard({ achievement }: { achievement: AchievementDto }) {
  const tone =
    achievement.tier === 'platinum'
      ? 'border-ink/25'
      : achievement.tier === 'gold'
        ? 'border-accent/35'
        : achievement.tier === 'silver'
          ? 'border-edge'
          : 'border-line';

  return (
    <li
      className={cn(
        'rounded-lg border bg-surface/50 px-4 py-3.5 transition-colors duration-quick',
        tone,
        !achievement.unlocked && 'opacity-80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-small', achievement.unlocked ? 'text-ink' : 'text-muted')}>{achievement.name}</p>
        <span className={cn('shrink-0 font-mono text-micro uppercase tracking-[0.08em]', achievement.unlocked ? 'text-accent' : 'text-ghost')}>
          {achievement.unlocked ? 'earned' : TIER_LABEL[achievement.tier]}
        </span>
      </div>

      <p className="hint mt-1">{achievement.description}</p>

      {achievement.unlocked ? (
        <p className="mt-2.5 font-mono text-micro text-ghost">
          {achievement.unlockedAt ? `Reached ${new Date(achievement.unlockedAt).toISOString().slice(0, 10)}` : 'Reached'}
        </p>
      ) : (
        <>
          <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-pill bg-sunken">
            <div className="h-full rounded-pill bg-faint" style={{ width: `${Math.round(achievement.progress * 100)}%` }} />
          </div>
          <p className="mt-1.5 flex items-baseline justify-between font-mono text-micro text-faint">
            <span>{achievement.progressLabel}</span>
            <span>{achievement.remainingLabel}</span>
          </p>
        </>
      )}
    </li>
  );
}
