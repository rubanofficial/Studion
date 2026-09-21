/**
 * The application shell.
 *
 * Owns the things that must exist exactly once no matter which room you are in:
 * the ambient layer, the instrument readout, the dock, the command palette, the
 * global shortcut table and the side panels.
 *
 * The shortcut table lives here rather than on each screen so that a shortcut
 * cannot mean two different things in two places — the fastest way to make a
 * keyboard-driven product feel unreliable.
 */

import { useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApp } from '../../store/app';
import { timerActions, useTimer } from '../../store/timer';
import { useKeyboardShortcuts, type ShortcutDefinition } from '../../hooks';
import { CommandPalette } from '../CommandPalette';
import { DistractionPanel, SessionPanel, TaskPanel } from '../panels/Panels';
import { Ambient } from './Ambient';
import { Dock } from './Dock';
import { InstrumentBar } from './InstrumentBar';
import { ShortcutSheet } from './ShortcutSheet';

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { phase } = useTimer();
  const focusMode = useApp((state) => state.focusMode);
  const panel = useApp((state) => state.panel);
  const setPanel = useApp((state) => state.setPanel);
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const setFocusMode = useApp((state) => state.setFocusMode);
  const setShortcutsOpen = useApp((state) => state.setShortcutsOpen);
  const settings = useApp((state) => state.settings);
  const subjects = useApp((state) => state.subjects);
  const toast = useApp((state) => state.toast);

  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultSeconds = (settings?.focusPresets?.[1]?.minutes ?? 25) * 60;

  /** Start a session, or explain precisely why it cannot start. */
  const startFocus = useCallback(() => {
    const active = subjects.filter((subject) => !subject.archivedAt);
    const preferred = active.find((subject) => subject._id === settings?.defaultSubject) ?? active[0];

    if (!preferred) {
      toast({
        tone: 'info',
        title: 'Add a subject first',
        detail: 'A session needs a subject so your hours land somewhere in the analytics.',
      });
      void navigate('/subjects?new=1');
      return;
    }

    void timerActions.start({
      subjectId: preferred._id,
      taskId: null,
      plannedSeconds: defaultSeconds,
      timeZone,
    });
  }, [defaultSeconds, navigate, settings?.defaultSubject, subjects, timeZone, toast]);

  /** The single contextual primary action, mirrored by the dock's centre button. */
  const primary = useCallback(() => {
    if (phase === 'focus') {
      void timerActions.pause();
      return;
    }
    if (phase === 'paused' || phase === 'break') {
      void timerActions.resume();
      return;
    }
    if (phase === 'finished') {
      void timerActions.flush().finally(() => {
        void timerActions.clear();
        void useApp.getState().refreshAll();
      });
      return;
    }
    startFocus();
  }, [phase, setPanel, startFocus]);

  const primaryTone = phase === 'paused' ? 'running' : phase === 'break' ? 'break' : phase === 'focus' ? 'running' : 'idle';
  const primaryLabel = phase === 'focus' ? 'Pause' : phase === 'paused' ? 'Resume' : phase === 'break' ? 'End break' : phase === 'finished' ? 'Finish up' : 'Start focus';

  const shortcuts: ShortcutDefinition[] = [
    {
      combo: 'mod+k',
      handler: () => setPaletteOpen(true),
      allowInInput: true,
      description: 'Open the command palette',
      group: 'Navigation',
    },
    {
      combo: 'space',
      handler: () => {
        if (phase === 'focus') void timerActions.pause();
        else if (phase === 'paused' || phase === 'break') void timerActions.resume();
        else if (phase === 'finished') {
          void timerActions.flush().finally(() => {
            void timerActions.clear();
            void useApp.getState().refreshAll();
          });
        } else if (phase === 'idle') {
          startFocus();
        }
      },
      description: 'Pause or resume the timer',
      group: 'Timer',
    },
    { combo: 'f', handler: startFocus, description: 'Start a focus session', group: 'Timer' },
    {
      combo: 'b',
      handler: () => {
        if (phase === 'focus') void timerActions.startBreak();
        else if (phase === 'break') void timerActions.endBreak();
      },
      description: 'Take or end a break',
      group: 'Timer',
    },
    {
      combo: 'd',
      handler: () => setPanel(phase === 'idle' ? 'none' : 'distractions'),
      description: 'Log a distraction',
      group: 'Session',
    },
    {
      combo: 'r',
      handler: () => {
        if (phase === 'idle') return;
        if (phase === 'finished') {
          void timerActions.clear();
          void useApp.getState().refreshAll();
          return;
        }
        // Reset means "end without recording a completion", so it asks.
        setPanel('session');
      },
      description: 'End the current session',
      group: 'Session',
    },
    { combo: 'm', handler: () => setFocusMode(!focusMode), description: 'Toggle focus mode', group: 'View' },
    {
      combo: 'esc',
      handler: () => {
        if (focusMode) setFocusMode(false);
        else if (panel !== 'none') setPanel('none');
      },
      allowInInput: true,
      description: 'Close panels and focus mode',
      group: 'View',
    },
    { combo: '?', handler: () => setShortcutsOpen(true), allowInInput: true, description: 'Show the shortcut sheet', group: 'Navigation' },
    { combo: 'left', handler: () => navigate(-1), description: 'Previous view', group: 'View' },
    { combo: 'right', handler: () => navigate(1), description: 'Next view', group: 'View' },
    ...(
      [
        ['/', 'Cockpit'],
        ['/insights', 'Insights'],
        ['/subjects', 'Subjects'],
        ['/tasks', 'Tasks'],
        ['/goals', 'Goals'],
        ['/settings', 'Settings'],
      ] as Array<[string, string]>
    ).map(([to, label], index) => ({
      combo: String(index + 1),
      handler: () => void navigate(to),
      description: `Go to ${label}`,
      group: 'Navigation' as const,
      allowInInput: false,
    })),
  ];

  useKeyboardShortcuts(shortcuts, settings?.shortcuts?.enabled !== false);

  return (
    <div className="relative flex min-h-full flex-col">
      <Ambient suppressed={focusMode} />

      {/* Skip link: the cockpit is a single instrument, and a keyboard user should
          be able to step past the readout without tabbing through it. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-accent focus:bg-raised focus:px-3 focus:py-1.5 focus:text-small"
      >
        Skip to main content
      </a>

      {!focusMode && <InstrumentBar />}

      <main
        id="main"
        className={
          focusMode
            ? 'flex flex-1 flex-col'
            : 'flex flex-1 flex-col pb-24 sm:pb-28'
        }
      >
        {children}
      </main>

      {!focusMode && <Dock onPrimaryAction={primary} primaryLabel={primaryLabel} primaryTone={primaryTone} />}

      <CommandPalette />
      <ShortcutSheet />

      {/* Panels are rendered here so a session can be ended from any screen. */}
      {panel === 'tasks' && <TaskPanel />}
      {panel === 'distractions' && <DistractionPanel />}
      {panel === 'session' && <SessionPanel onStartNew={startFocus} />}
    </div>
  );
}
