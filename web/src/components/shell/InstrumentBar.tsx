/**
 * The instrument bar.
 *
 * This is emphatically *not* a top navbar. It carries no navigation links. It is a
 * readout: the live time, the day's accumulated focus, the streak, and the sync
 * state. Its job is to answer "is everything recorded, and where am I today?"
 * without the user having to go and look.
 *
 * On phones it collapses to the two facts that matter — status and the day's
 * total — because a row of six readouts on a 390px screen is decoration.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { duration } from '../../lib/format';
import { applyTheme } from '../../lib/theme';
import { useApp } from '../../store/app';
import { useTimer } from '../../store/timer';
import { IconButton, cn } from '../ui';

export function InstrumentBar() {
  const overview = useApp((state) => state.overview);
  const settings = useApp((state) => state.settings);
  const user = useApp((state) => state.user);
  const online = useApp((state) => state.online);
  const pendingSync = useApp((state) => state.pendingSync);
  const stale = useApp((state) => state.stale);
  const updateSettings = useApp((state) => state.updateSettings);
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const { phase, synced, pendingEvents } = useTimer();

  const [clock, setClock] = useState(() => new Date());
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    const handle = setInterval(() => setClock(new Date()), 15_000);
    return () => clearInterval(handle);
  }, []);

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true);
    window.addEventListener('focusforge:update-available', onUpdate);
    return () => window.removeEventListener('focusforge:update-available', onUpdate);
  }, []);

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const theme = settings?.theme ?? 'dark';

  // A session that is live on this device is unsynced work the user cannot afford
  // to lose, so the indicator escalates: saved, saving, or held locally.
  const syncState: { label: string; tone: string; title: string } = !online
    ? {
        label: 'Offline',
        tone: 'text-pause',
        title: 'You are offline. Sessions are recorded on this device and uploaded automatically when you reconnect.',
      }
    : stale
      ? { label: 'Stale', tone: 'text-pause', title: 'Showing the last data this device received. It will refresh when the server responds.' }
      : pendingSync + pendingEvents > 0 || !synced
        ? {
            label: 'Saving',
            tone: 'text-rest',
            title: `${pendingSync + pendingEvents} change${pendingSync + pendingEvents === 1 ? '' : 's'} waiting to be uploaded.`,
          }
        : { label: 'Synced', tone: 'text-good', title: 'Everything is saved on the server.' };

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-void/70 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[100rem] items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Studion cockpit">
          <Mark />
          <span className="hidden text-small font-medium tracking-[-0.01em] text-ink sm:inline">Studion</span>
        </Link>

        <div className="hidden items-center gap-2 text-faint sm:flex">
          <span className="text-ghost">/</span>
          <Clock clock={clock} timeZone={timeZone} />
        </div>

        <div className="flex-1" />

        {overview && (
          <div className="hidden items-center gap-4 md:flex">
            <Readout
              label="Today"
              value={duration(overview.today.focusedSeconds)}
              sub={overview.today.goalSeconds > 0 ? `of ${duration(overview.today.goalSeconds)}` : undefined}
            />
            <span className="h-6 w-px bg-line" aria-hidden="true" />
            <Readout
              label="Streak"
              value={`${overview.streak.daily.current}d`}
              sub={overview.streak.daily.isTodayMet ? 'secured' : 'at risk'}
              tone={overview.streak.daily.isTodayMet ? 'good' : undefined}
            />
            <span className="hidden h-6 w-px bg-line lg:block" aria-hidden="true" />
          </div>
        )}

        <div className="flex items-center gap-2">
          {(phase === 'focus' || phase === 'paused' || phase === 'break') && (
            <span className="hidden items-center gap-1.5 rounded-pill border border-accent/30 bg-accent/5 px-2.5 py-1 text-micro uppercase text-accent sm:flex">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              {phase === 'break' ? 'Break' : phase === 'paused' ? 'Paused' : 'Focusing'}
            </span>
          )}

          <button
            type="button"
            className={cn('flex items-center gap-1.5 rounded-pill px-2 py-1 text-micro uppercase transition-colors', syncState.tone)}
            title={syncState.title}
            onClick={() => pendingSync > 0 && void useApp.getState().loadOverview({ quiet: true })}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', !online ? 'bg-pause' : stale ? 'bg-pause' : pendingSync > 0 || !synced ? 'bg-rest' : 'bg-good')} aria-hidden="true" />
            <span className="hidden sm:inline">{syncState.label}</span>
          </button>

          {updateReady && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-pill border border-accent/40 px-2.5 py-1 text-micro uppercase text-accent"
            >
              Update
            </button>
          )}

          <IconButton
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark';
              applyTheme(next);
              void updateSettings({ theme: next });
            }}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-1.5 rounded-md border border-line px-2 text-tiny text-faint transition-colors duration-quick hover:border-faint hover:text-ink md:flex"
            aria-label="Open the command palette"
          >
            <span className="font-mono">⌘K</span>
          </button>

          {user && (
            <Link
              to="/settings"
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-edge bg-raised text-micro font-medium uppercase text-muted transition-colors hover:border-faint hover:text-ink"
              aria-label={`Signed in as ${user.name || user.email}. Open settings.`}
            >
              {(user.name || user.email).slice(0, 2)}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Clock({ clock, timeZone }: { clock: Date; timeZone: string }) {
  let formatted = '';
  let day = '';
  try {
    formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(clock);
    day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(clock);
  } catch {
    formatted = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(clock);
    day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(clock);
  }

  return (
    <span className="flex items-baseline gap-2" title={`Current time (${timeZone.replace(/_/g, ' ')})`}>
      <time className="font-mono text-small text-muted numeric-stable" dateTime={clock.toISOString()}>
        {formatted}
      </time>
      <span className="text-tiny text-faint">{day}</span>
    </span>
  );
}

function Readout({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good';
}) {
  return (
    <span className="flex items-baseline gap-1.5" title={`${label}: ${value}${sub ? ` ${sub}` : ''}`}>
      <span className="text-micro uppercase tracking-[0.08em] text-faint">{label}</span>
      <span className={cn('font-mono text-small numeric-stable', tone === 'good' ? 'text-good' : 'text-ink')}>{value}</span>
      {sub && <span className="text-tiny text-ghost">{sub}</span>}
    </span>
  );
}

/** The mark: a forge ring with a struck core. Doubles as a favicon motif. */
function Mark() {
  return (
    <span className="relative flex h-6 w-6 items-center justify-center" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-6 w-6">
        <circle cx="12" cy="12" r="9.2" fill="none" stroke="rgb(var(--edge))" strokeWidth="1.5" />
        <path
          d="M12 2.8a9.2 9.2 0 0 1 9.2 9.2"
          fill="none"
          stroke="rgb(var(--accent))"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="2.4" fill="rgb(var(--accent))" />
      </svg>
    </span>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6z" strokeLinejoin="round" />
    </svg>
  );
}
