/**
 * Sign in / create account.
 *
 * A single page with two modes rather than two routes, because registration is a
 * two-field variation of signing in and a separate page would double the surface
 * area for no gain.
 *
 * Three things it handles properly:
 *   - **Error states that distinguish themselves.** "Wrong password", "the server
 *     is unreachable" and "you are offline" are three different problems and get
 *     three different messages with different next actions.
 *   - **The timezone is captured at registration from the browser**, so a user
 *     who never opens settings still gets their analytics bucketed correctly on
 *     day one.
 *   - **It never blocks on a slow network.** The submit button reports its own
 *     progress and the form stays editable.
 */

import { useEffect, useState } from 'react';

import type { ApiError } from '../lib/api';
import { useApp } from '../store/app';
import { Button, Field, cn } from '../components/ui';

type Mode = 'sign-in' | 'register';

export function AuthPage() {
  const signIn = useApp((state) => state.signIn);
  const signUp = useApp((state) => state.signUp);

  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [capsLock, setCapsLock] = useState(false);

  // Clear the error when the user starts fixing the problem — a stale red message
  // under a corrected field is its own small failure.
  useEffect(() => setError(null), [mode, email, password, name]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    const detectedTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';
    const result =
      mode === 'sign-in'
        ? await signIn(email.trim().toLowerCase(), password)
        : await signUp({
            name: name.trim() || email.split('@')[0] || 'You',
            email: email.trim().toLowerCase(),
            password,
            timeZone: detectedTz,
          });

    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
  };

  const passwordProblem = mode === 'register' ? describePasswordProblem(password) : null;
  const canSubmit =
    !busy &&
    email.includes('@') &&
    password.length > 0 &&
    (mode === 'sign-in' || (name.trim().length > 0 && passwordProblem === null));

  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      {/* ------------------------------------------------------- the instrument */}
      <div className="relative hidden flex-1 items-center justify-center overflow-hidden border-r border-line bg-surface/40 lg:flex">
        <div className="ambient absolute inset-0" aria-hidden="true" />
        <div className="gridlines absolute inset-0 opacity-60" aria-hidden="true" />

        <div className="relative max-w-sm px-10">
          <DemoDial />
          <h2 className="mt-8 text-title text-ink">Your hours, where they actually went.</h2>
          <p className="mt-2 text-small text-muted">
            Studion records every session from timestamps, not a browser counter — so refreshing the tab, closing the laptop or
            going offline cannot cost you a minute of credit.
          </p>
          <ul className="mt-6 flex flex-col gap-2.5">
            {[
              'Sessions survive refresh, sleep and network loss.',
              'Analytics bucket by *your* timezone, including DST.',
              'Works offline; syncs when you reconnect.',
              'No streak shaming. Measurements, not verdicts.',
            ].map((line) => (
              <li key={line} className="flex gap-2.5 text-small text-muted">
                <span className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* --------------------------------------------------------------- the form */}
      <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <circle cx="12" cy="12" r="9.2" fill="none" stroke="rgb(var(--edge))" strokeWidth="1.4" />
              <path d="M12 2.8a9.2 9.2 0 0 1 9.2 9.2" fill="none" stroke="rgb(var(--accent))" strokeWidth="1.8" strokeLinecap="round" />
              <circle cx="12" cy="12" r="2.3" fill="rgb(var(--accent))" />
            </svg>
            <span className="text-small font-medium text-ink">Studion</span>
          </div>

          <h1 className="mt-7 text-head text-ink">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="mt-1.5 text-small text-muted">
            {mode === 'sign-in'
              ? 'Your sessions, subjects and analytics are waiting on the other side.'
              : 'One account, both devices. Your recorded sessions stay yours.'}
          </p>

          <div className="mt-6 flex rounded-md border border-line bg-sunken p-0.5" role="tablist" aria-label="Authentication mode">
            {(['sign-in', 'register'] as Mode[]).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex-1 rounded-sm px-3 py-1.5 text-small transition-colors duration-quick',
                  mode === value ? 'bg-raised text-ink' : 'text-faint hover:text-muted',
                )}
              >
                {value === 'sign-in' ? 'Sign in' : 'Register'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
            {mode === 'register' && (
              <Field
                label="What should we call you?"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                maxLength={80}
                placeholder="Aditya"
                autoFocus
              />
            )}

            <Field
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              placeholder="you@example.com"
              autoFocus={mode === 'sign-in'}
            />

            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? 'At least 10 characters' : '••••••••••'}
              hint={mode === 'register' ? 'Ten characters or more. A passphrase of a few words is stronger than a short scramble.' : undefined}
              error={passwordProblem ?? undefined}
            />

            {capsLock && <p className="text-tiny text-pause">Caps Lock is on.</p>}

            {error && <AuthError error={error} mode={mode} />}

            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!canSubmit} className="mt-1 w-full">
              {mode === 'sign-in' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-tiny text-faint">
            {mode === 'sign-in' ? (
              <>
                No account yet?{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => setMode('register')}>
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have one?{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => setMode('sign-in')}>
                  Sign in instead
                </button>
              </>
            )}
          </p>

          <p className="mt-6 text-tiny text-ghost">
            We store your email, a hashed password, the sessions you record and the settings you choose. Nothing else, no third-party
            analytics. You can export everything as JSON or CSV, or delete the account outright, from Settings.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The error block.
 *
 * The copy is chosen by *kind*, because "something went wrong" is useless when
 * the real problem is a flat battery in the router.
 */
function AuthError({ error, mode }: { error: ApiError; mode: Mode }) {
  const heading =
    error.kind === 'offline'
      ? 'You are offline'
      : error.kind === 'network' || error.kind === 'timeout'
        ? 'Cannot reach the server'
        : error.status === 401
          ? 'Those credentials did not match'
          : error.status === 429
            ? 'Too many attempts'
            : error.status === 409
              ? 'That email is already registered'
              : 'That did not work';

  const detail = (() => {
    if (error.kind === 'offline') {
      return 'Studion needs one connection to sign you in. The timer itself works offline once you are in.';
    }
    if (error.kind === 'network' || error.kind === 'timeout') {
      return 'Check your connection and try again. Nothing you typed has been lost.';
    }
    if (error.status === 401) {
      return mode === 'sign-in'
        ? 'Check the email address and password. Passwords are case-sensitive.'
        : 'The password did not meet the requirements.';
    }
    if (error.status === 429) {
      return 'Several attempts were made in a short window. Wait a minute and try again — this limit protects your account.';
    }
    if (error.status === 409) {
      return 'An account already exists for that address. Try signing in instead.';
    }
    // Validation failures carry per-field detail from the server; show the first
    // one rather than a generic sentence.
    const firstFieldMessage = error.fields ? Object.values(error.fields)[0] : undefined;
    if (firstFieldMessage) return firstFieldMessage;
    return error.message;
  })();

  return (
    <div className="rounded-md border border-alert/35 bg-alert/[0.06] px-3.5 py-3" role="alert">
      <p className="text-small text-ink">{heading}</p>
      <p className="mt-1 text-tiny text-muted">{detail}</p>
    </div>
  );
}

/** Mirrors the server's rule so the user is told before a round trip. */
function describePasswordProblem(password: string): string | null {
  if (password.length === 0) return null;
  if (password.length < 10) return `Too short — ${10 - password.length} more character${10 - password.length === 1 ? '' : 's'} needed.`;
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return 'Include at least one letter and one number.';
  return null;
}

/** A slow, decorative ring used only on this page. Nothing here is real data. */
function DemoDial() {
  const [progress, setProgress] = useState(0.14);

  useEffect(() => {
    const handle = setInterval(() => setProgress((value) => (value >= 0.92 ? 0.14 : value + 0.007)), 120);
    return () => clearInterval(handle);
  }, []);

  const radius = 74;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative flex h-52 w-52 items-center justify-center">
      <svg viewBox="0 0 180 180" className="h-52 w-52 -rotate-90" aria-hidden="true">
        <circle cx="90" cy="90" r={radius} fill="none" stroke="rgb(var(--line))" strokeWidth="2" />
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
        />
        {Array.from({ length: 12 }).map((_, index) => {
          const angle = (index / 12) * Math.PI * 2;
          return (
            <line
              key={index}
              x1={90 + Math.cos(angle) * 62}
              y1={90 + Math.sin(angle) * 62}
              x2={90 + Math.cos(angle) * 68}
              y2={90 + Math.sin(angle) * 68}
              stroke="rgb(var(--edge))"
              strokeWidth="1"
            />
          );
        })}
      </svg>
      <div className="absolute text-center">
        <p className="font-mono text-[2.4rem] leading-none text-ink numeric-stable">42:18</p>
        <p className="mt-1 font-mono text-micro uppercase tracking-[0.18em] text-faint">DSA · 45 min</p>
      </div>
    </div>
  );
}
