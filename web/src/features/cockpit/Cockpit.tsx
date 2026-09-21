/**
 * The cockpit.
 *
 * The first screen of the product, and the only one most users will look at on a
 * normal day. It answers three questions in one glance, in this order:
 *
 *   1. *What am I doing right now?* — the Core, centre stage, nothing competing
 *      with it.
 *   2. *What happens after this?* — the up-next strip on the left.
 *   3. *Is this adding up?* — the momentum strip on the right, and the day's
 *      spine along the bottom.
 *
 * Layout is a three-column instrument panel on desktop and a single intentional
 * column on mobile, where the Core comes first, the momentum strip second, and the
 * queue last — because on a phone you are more likely to be starting a session
 * than planning one.
 *
 * Note what is *not* here: a page title, a row of statistic cards, a chart, and a
 * recent-activity table. The Core is the page title.
 */

import { useEffect, useState } from 'react';

import { dayKey as dayKeyOf } from '@focusforge/core';

import { useApp } from '../../store/app';
import { useTimer } from '../../store/timer';
import { isPlanComplete } from '../../lib/timer';
import { useDayDetail } from '../../data/queries';
import { CockpitGreeting } from './CockpitGreeting';
import { FocusCore } from './FocusCore';
import { FocusModeOverlay } from './FocusModeOverlay';
import { Momentum } from './Momentum';
import { UpNext } from './UpNext';
import { TimeSpine } from '../timeline/TimeSpine';
import { SessionComplete } from './SessionComplete';
import { Skeleton } from '../../components/ui';

export function Cockpit() {
  const settings = useApp((state) => state.settings);
  const overview = useApp((state) => state.overview);
  const loading = useApp((state) => state.loading.overview);
  const setPanel = useApp((state) => state.setPanel);
  const focusMode = useApp((state) => state.focusMode);
  const subjectCount = useApp((state) => state.subjects.filter((subject) => !subject.archivedAt).length);
  const snapshot = useTimer();
  const { phase } = snapshot;

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nowKey = dayKeyOf(Date.now(), timeZone);
  const todayKey = overview?.today.dayKey ?? nowKey;

  const { data: today } = useDayDetail(todayKey);

  /**
   * The completion dialogue appears when the planned duration is reached and the
   * session is still open — the engine deliberately does not decide for the user.
   * It is dismissible, and dismissing it does not close the session; the timer
   * simply keeps counting until the user acts.
   */
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const planReached = phase !== 'idle' && phase !== 'finished' && isPlanComplete(snapshot);
  const showCompletion = planReached && !completionDismissed;

  // A new session re-arms the dialogue.
  useEffect(() => {
    if (phase === 'idle') setCompletionDismissed(false);
  }, [phase]);

  if (loading && !overview) {
    return (
      <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-6 px-4 py-8 sm:px-6">
        <Skeleton className="mx-auto h-6 w-56" label="Loading today's summary" />
        <Skeleton className="mx-auto aspect-square w-full max-w-[34rem] rounded-full" label="Loading the focus instrument" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-[84rem] flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <CockpitGreeting />

        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)_16rem] lg:gap-10 xl:grid-cols-[16rem_minmax(0,1fr)_17rem]">
          {/* Mobile order: Core, momentum, queue. Desktop: left strip, Core, right strip. */}
          <div className="order-3 lg:order-1">
            <UpNext />
          </div>

          <div className="order-1 flex flex-col gap-8 lg:order-2">
            <FocusCore />

            {today && today.sessionCount > 0 && (
              <div className="rounded-lg border border-line bg-surface/50 px-4 py-4 sm:px-5">
                <TimeSpine
                  dayKey={todayKey}
                  timeline={today.timeline}
                  timeZone={timeZone}
                  nowKey={nowKey}
                  onSelectSession={() => setPanel('session')}
                />
              </div>
            )}

            {today && today.sessionCount === 0 && <FirstSessionGuide subjectCount={subjectCount} />}
          </div>

          <div className="order-2 lg:order-3">
            <Momentum />
          </div>
        </div>
      </div>

      <FocusModeOverlay />
      {showCompletion && !focusMode && <SessionComplete onDismiss={() => setCompletionDismissed(true)} />}
    </>
  );
}

/**
 * The empty state for day one.
 *
 * It does not say "no data". It says what the product will do for you, and gives
 * exactly one action — because a new user with three suggested next steps picks
 * none of them.
 */
function FirstSessionGuide({ subjectCount }: { subjectCount: number }) {
  const steps = [
    {
      key: 'subject',
      done: subjectCount > 0,
      title: subjectCount > 0 ? `${subjectCount} subject${subjectCount === 1 ? '' : 's'} ready` : 'Name what you are working on',
      detail:
        subjectCount > 0
          ? 'Your recorded time is filed by subject, which is what makes the weekly comparison meaningful.'
          : 'DSA, Java, System Design — a subject is a bucket your hours land in, and the ring takes its colour from it.',
    },
    {
      key: 'goal',
      done: false,
      title: 'Set a daily goal you can actually hit',
      detail: 'Not an aspiration. Something true on a normal day, so the streak measures consistency rather than heroics.',
    },
    {
      key: 'session',
      done: false,
      title: 'Complete one session',
      detail: 'Twenty-five minutes is enough. The analytics need three or four sessions before a pattern is worth reporting.',
    },
  ];

  return (
    <div className="rounded-lg border border-line bg-surface/50 px-4 py-4 sm:px-5">
      <p className="text-small text-ink">Your first focus session starts here.</p>
      <p className="hint mt-1">
        Nothing to show yet — that is expected on day one. Here is what the instrument will do with your time.
      </p>
      <ol className="mt-3.5 flex flex-col divide-y divide-line/70">
        {steps.map((step, index) => (
          <li key={step.key} className="flex gap-3 py-2.5">
            <span
              className={
                step.done
                  ? 'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-good/60 font-mono text-micro text-good'
                  : 'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-edge font-mono text-micro text-ghost'
              }
              aria-hidden="true"
            >
              {step.done ? '✓' : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-small text-muted">{step.title}</span>
              <span className="mt-0.5 block text-tiny text-faint">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
