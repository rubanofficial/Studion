/**
 * Onboarding.
 *
 * Three screens, and it is three because each one changes what the product does
 * later rather than just collecting a field:
 *
 *   1. **Subjects.** Choosing buckets now means every session from minute one is
 *      filed, so the subject distribution chart is meaningful on the first
 *      evening instead of the first fortnight.
 *   2. **A daily goal and a "what counts as a day" threshold.** The threshold is
 *      the interesting one: it is what the streak measures, and letting the user
 *      set it themselves is the difference between a motivating streak and a
 *      guilt machine.
 *   3. **Start.** Not a finish line — a direct route into the first session.
 *
 * The whole flow is skippable with one click, because a user who wants to just
 * start the timer should be able to.
 */

import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { duration } from '../lib/format';
import { useApp } from '../store/app';
import { Button, Field, cn } from '../components/ui';

interface SubjectOption {
  name: string;
  icon: string;
  color: string;
}

const GOAL_CHOICES = [30, 60, 90, 120, 180, 240];
const THRESHOLD_CHOICES = [10, 20, 30, 45];

export function OnboardingPage() {
  const user = useApp((state) => state.user);
  const completeOnboarding = useApp((state) => state.completeOnboarding);
  const signOut = useApp((state) => state.signOut);
  const toast = useApp((state) => state.toast);

  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<SubjectOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState('');
  const [goalMinutes, setGoalMinutes] = useState(120);
  const [thresholdMinutes, setThresholdMinutes] = useState(20);
  const [busy, setBusy] = useState(false);

  /**
   * The catalogue comes from the server so the icons and colours are consistent
   * with what the seeded/demo accounts use, rather than a second list that drifts.
   */
  useEffect(() => {
    void api.auth.onboardingOptions().then((result) => {
      if (result.ok) setOptions(result.data.options);
      else
        setOptions([
          { name: 'DSA', icon: 'braces', color: '#5eead4' },
          { name: 'Java', icon: 'coffee', color: '#fdba74' },
          { name: 'PostgreSQL', icon: 'database', color: '#93c5fd' },
          { name: 'System Design', icon: 'network', color: '#c4b5fd' },
        ]);
    });
  }, []);

  const toggle = (name: string) =>
    setSelected((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));

  const subjectNames = [...selected, ...(customSubject.trim() ? [customSubject.trim()] : [])];

  const finish = async (startNow: boolean) => {
    setBusy(true);
    const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const result = await completeOnboarding({
      subjectNames: subjectNames.length > 0 ? subjectNames : ['Focus'],
      dailyGoalSeconds: goalMinutes * 60,
      successThresholdSeconds: thresholdMinutes * 60,
      timeZone: detectedTz,
    });
    setBusy(false);

    if (!result.ok) {
      toast({
        tone: 'error',
        title: 'Could not save your setup',
        detail: result.error?.message ?? 'The server rejected the setup. Nothing was lost — try again.',
      });
      return;
    }

    if (startNow) {
      toast({
        tone: 'success',
        title: 'You are set up',
        detail: 'Press F, or use the centre button in the dock, to begin your first session.',
      });
    }
  };

  const steps = ['Subjects', 'Rhythm', 'Start'];

  return (
    <div className="relative flex min-h-screen flex-col items-center px-5 py-10 sm:py-16">
      <div className="ambient absolute inset-0 -z-10" aria-hidden="true" />
      <div className="gridlines absolute inset-0 -z-10 opacity-50" aria-hidden="true" />

      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between">
          <p className="font-mono text-micro uppercase tracking-[0.18em] text-faint">
            Step {step + 1} of {steps.length}
          </p>
          <button type="button" onClick={() => void signOut()} className="text-tiny text-ghost hover:text-muted">
            Sign out
          </button>
        </div>

        <ol className="mt-3 flex gap-1.5" aria-label="Setup progress">
          {steps.map((label, index) => (
            <li key={label} className="flex-1">
              <span
                className={cn('block h-[2px] rounded-pill transition-colors duration-calm', index <= step ? 'bg-accent' : 'bg-line')}
              />
              <span className={cn('mt-1.5 block text-micro uppercase tracking-[0.08em]', index <= step ? 'text-muted' : 'text-ghost')}>
                {label}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 animate-rise">
          {step === 0 && (
            <section>
              <h1 className="text-head text-ink">
                What are you working on{user?.name ? `, ${user.name.split(' ')[0]}` : ''}?
              </h1>
              <p className="mt-2 text-small text-muted">
                Pick a few. Each one becomes a bucket your recorded time lands in, and the ring takes its colour from whichever you
                choose. You can rename, recolour, archive or delete any of them later.
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {options.map((option) => {
                  const active = selected.includes(option.name);
                  return (
                    <button
                      key={option.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggle(option.name)}
                      className={cn(
                        'flex items-center gap-2 rounded-pill border px-3.5 py-2 text-small transition-colors duration-quick',
                        active ? 'border-transparent text-ink' : 'border-line text-muted hover:border-faint hover:text-ink',
                      )}
                      style={active ? { background: `${option.color}22`, borderColor: `${option.color}88` } : undefined}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: option.color }} aria-hidden="true" />
                      {option.name}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 max-w-sm">
                <Field
                  label="Something else"
                  value={customSubject}
                  onChange={(event) => setCustomSubject(event.target.value)}
                  placeholder="Aptitude, Thesis, Interview prep…"
                  maxLength={60}
                  hint="Press Next and it will be created alongside your selections."
                />
              </div>

              <div className="mt-8 flex items-center justify-between">
                <button type="button" onClick={() => void finish(false)} className="text-tiny text-ghost hover:text-muted">
                  Skip setup
                </button>
                <Button variant="primary" onClick={() => setStep(1)} disabled={subjectNames.length === 0}>
                  Next
                </Button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="text-head text-ink">What does a good day look like?</h1>
              <p className="mt-2 text-small text-muted">
                Be honest rather than ambitious. A goal you hit four days out of five teaches you more than one you hit once, and the
                progress ring is only useful if it is usually closing.
              </p>

              <div className="mt-6">
                <p className="label">Daily focus goal</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {GOAL_CHOICES.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={goalMinutes === minutes}
                      onClick={() => setGoalMinutes(minutes)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 font-mono text-tiny transition-colors duration-quick',
                        goalMinutes === minutes ? 'border-accent/60 bg-accent/10 text-ink' : 'border-line text-faint hover:border-faint hover:text-muted',
                      )}
                    >
                      {duration(minutes * 60)}
                    </button>
                  ))}
                </div>
                <p className="hint mt-2">
                  Currently {duration(goalMinutes * 60)} a day. At that pace a {duration(goalMinutes * 60 * 5)} week is normal, not
                  heroic.
                </p>
              </div>

              <div className="mt-7">
                <p className="label">A day counts towards your streak at</p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {THRESHOLD_CHOICES.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={thresholdMinutes === minutes}
                      onClick={() => setThresholdMinutes(minutes)}
                      className={cn(
                        'rounded-md border px-3 py-1.5 font-mono text-tiny transition-colors duration-quick',
                        thresholdMinutes === minutes
                          ? 'border-accent/60 bg-accent/10 text-ink'
                          : 'border-line text-faint hover:border-faint hover:text-muted',
                      )}
                    >
                      {duration(minutes * 60)}
                    </button>
                  ))}
                </div>
                <p className="hint mt-2">
                  This is deliberately lower than the goal. The streak measures showing up; the goal measures a good day. Setting it low
                  is the point.
                </p>
              </div>

              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button variant="primary" onClick={() => setStep(2)}>
                  Next
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="text-head text-ink">That is everything.</h1>
              <p className="mt-2 text-small text-muted">
                {subjectNames.length} subject{subjectNames.length === 1 ? '' : 's'} ready, a {duration(goalMinutes * 60)} daily goal, and
                a streak that counts at {duration(thresholdMinutes * 60)}.
              </p>

              <div className="mt-6 rounded-lg border border-line bg-surface/60 px-4 py-4">
                <p className="label">What happens on your first session</p>
                <ul className="mt-2.5 flex flex-col gap-2 text-small text-muted">
                  <li>The clock runs from a start timestamp, so closing the tab does not stop it.</li>
                  <li>
                    A plan is only credited at {duration(thresholdMinutes * 60)} or more — anything shorter is recorded but not scored.
                  </li>
                  <li>You can log an interruption at any time with D. It counts, and it is not held against you.</li>
                </ul>
              </div>

              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <Button variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" loading={busy} onClick={() => void finish(false)}>
                    Just take me in
                  </Button>
                  <Button variant="primary" loading={busy} onClick={() => void finish(true)}>
                    Start my first session
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
