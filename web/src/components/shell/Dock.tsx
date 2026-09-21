/**
 * The dock.
 *
 * Navigation is a *floating instrument dock*, not a sidebar. The reasoning: this
 * product has one primary action (start/stop focusing) and five secondary
 * destinations. A sidebar gives equal visual weight to five rarely-used links and
 * steals horizontal room from the thing that matters, which on a laptop is the
 * difference between a timer you can read across the room and one you cannot.
 *
 * So the dock is anchored to the bottom edge, centred, and translucent. The
 * centre slot is the *contextual primary action* — the thing you would do next,
 * whatever that is — which means the most common interaction in the app is never
 * more than one click from anywhere.
 *
 * On phones it becomes a full-width bottom bar sized for thumbs, with the primary
 * action raised into the centre where a one-handed grip can reach it.
 */

import { NavLink } from 'react-router-dom';

import { useApp, selectActiveSubjects } from '../../store/app';
import { useTimer } from '../../store/timer';
import { cn } from '../ui';

interface Destination {
  to: string;
  label: string;
  icon: JSX.Element;
  /** Shown as a dot when there is something new behind the door. */
  badge?: number;
}

const iconProps = {
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-[1.1rem] w-[1.1rem]',
};

const CockpitIcon = (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6.5V10l2.5 1.8" />
  </svg>
);

const InsightsIcon = (
  <svg {...iconProps} aria-hidden="true">
    <path d="M3 15.5h14" />
    <path d="M4.5 12.5V8" />
    <path d="M8.2 12.5V5.5" />
    <path d="M11.8 12.5V9" />
    <path d="M15.5 12.5V4.5" />
  </svg>
);

const SubjectsIcon = (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="10" cy="10" r="2.2" />
    <ellipse cx="10" cy="10" rx="7.4" ry="3.2" transform="rotate(-28 10 10)" />
    <ellipse cx="10" cy="10" rx="7.4" ry="3.2" transform="rotate(28 10 10)" />
  </svg>
);

const TasksIcon = (
  <svg {...iconProps} aria-hidden="true">
    <path d="M4 6.2h12M4 10h12M4 13.8h7.5" />
    <circle cx="2.4" cy="6.2" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.4" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="2.4" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

const GoalsIcon = (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="3.6" />
    <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const SettingsIcon = (
  <svg {...iconProps} aria-hidden="true">
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 2.6v2M10 15.4v2M3.6 10h2M14.4 10h2M5.5 5.5l1.4 1.4M13.1 13.1l1.4 1.4M14.5 5.5l-1.4 1.4M6.9 13.1l-1.4 1.4" />
  </svg>
);

export function Dock({
  onPrimaryAction,
  primaryLabel,
  primaryTone = 'idle',
}: {
  /** What the centre button does — always the contextually correct thing. */
  onPrimaryAction: () => void;
  primaryLabel: string;
  primaryTone?: 'idle' | 'running' | 'paused' | 'break';
}) {
  const achievements = useApp((state) => state.achievements);
  const subjectCount = useApp((state) => selectActiveSubjects(state).length);
  const openTasks = useApp((state) => state.tasks.filter((task) => task.status === 'todo' || task.status === 'in-progress').length);
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const { phase } = useTimer();

  const destinations: Destination[] = [
    { to: '/', label: 'Cockpit', icon: CockpitIcon },
    { to: '/insights', label: 'Insights', icon: InsightsIcon, badge: achievements?.unseenCount ?? 0 },
    { to: '/subjects', label: 'Subjects', icon: SubjectsIcon, badge: subjectCount === 0 ? 1 : 0 },
    { to: '/tasks', label: 'Tasks', icon: TasksIcon, badge: openTasks },
    { to: '/goals', label: 'Goals', icon: GoalsIcon, badge: 0 },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, badge: 0 },
  ];

  // The two halves of the dock sit either side of the raised centre control, which
  // is what makes the primary action read as the centre of gravity.
  const left = destinations.slice(0, 3);
  const right = destinations.slice(3);

  const running = phase !== 'idle' && phase !== 'finished';

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
    >
      <div className="pointer-events-auto flex w-full max-w-[36rem] items-center gap-1 rounded-t-lg border border-b-0 border-line bg-surface/85 px-2 py-2 backdrop-blur-xl sm:mb-4 sm:rounded-pill sm:border-b sm:px-2.5 sm:shadow-pane">
        <DockGroup items={left} />

        <button
          type="button"
          onClick={onPrimaryAction}
          className={cn(
            'group relative mx-1 flex h-11 flex-1 items-center justify-center gap-2 rounded-pill px-4 text-small font-medium transition-all duration-quick ease-forge sm:flex-none sm:px-6',
            primaryTone === 'running'
              ? 'bg-pause/15 text-pause hover:bg-pause/25'
              : primaryTone === 'break'
                ? 'bg-rest/15 text-rest hover:bg-rest/25'
                : 'bg-accent text-accent-ink hover:brightness-110',
          )}
          aria-label={primaryLabel}
        >
          {running ? (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
              <path d="M4 2.8l9 5.2-9 5.2z" fill="currentColor" />
            </svg>
          )}
          <span className="truncate">{primaryLabel}</span>
          {phase === 'focus' && (
            <span className="absolute inset-0 -z-10 animate-pulseRing rounded-pill border border-accent/40" aria-hidden="true" />
          )}
        </button>

        <DockGroup items={right} />

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="ml-1 hidden h-9 items-center gap-1.5 rounded-pill border border-line px-2.5 text-tiny text-faint transition-colors duration-quick hover:border-faint hover:text-ink lg:flex"
          aria-label="Open the command palette"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.2 10.2L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className="font-mono">⌘K</span>
        </button>
      </div>
    </nav>
  );
}

function DockGroup({ items }: { items: Destination[] }) {
  return (
    <div className="flex flex-1 items-center justify-around sm:flex-none sm:gap-0.5">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(
              'group relative flex flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 transition-colors duration-quick sm:flex-none',
              isActive ? 'text-ink' : 'text-faint hover:text-muted',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                {item.icon}
                {item.badge ? (
                  <span className="absolute -right-1.5 -top-1 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                ) : null}
              </span>
              <span className="text-micro uppercase tracking-[0.08em] sm:hidden">{item.label}</span>
              <span className="sr-only">{item.label}</span>
              {isActive && (
                <span
                  className="absolute -bottom-0.5 h-px w-5 rounded-pill bg-accent sm:-top-0.5 sm:bottom-auto"
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}
