/**
 * The command palette.
 *
 * This is the keyboard-native way through the product. Every destination and
 * every timer action is reachable from `⌘K` / `Ctrl+K`, which means a user who
 * learns three shortcuts never has to hunt for a button.
 *
 * Two details that make it feel native rather than bolted on:
 *
 *   - Ranking is a real subsequence match with contiguity and word-boundary
 *     bonuses, so typing `dsp` finds "Dynamic Programming" and `strk` finds the
 *     streak readout. Everything else in the list is then filtered out.
 *   - The palette is rendered lazily. It is a dialog, not a screen, and mounting
 *     its input into the tab order on every route would make `Tab` unpredictable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { duration } from '../lib/format';
import { selectActiveSubjects, useApp } from '../store/app';
import { timerActions, useTimer } from '../store/timer';
import { KeyHint, cn } from './ui';

interface Command {
  id: string;
  label: string;
  group: 'Timer' | 'Go to' | 'Start focus on' | 'Tasks' | 'Settings';
  hint?: string;
  combo?: string;
  keywords?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useApp((state) => state.paletteOpen);
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const subjects = useApp(selectActiveSubjects);
  const tasks = useApp((state) => state.tasks);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);
  const updateSettings = useApp((state) => state.updateSettings);
  const openSession = useApp((state) => state.overview?.openSession ?? null);
  const { phase } = useTimer();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const running = phase === 'focus' || phase === 'paused';
  const timeZone = settings?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    // ---------------------------------------------------------------- timer
    if (!running && openSession === null) {
      list.push({
        id: 'timer.start',
        label: 'Start focus session',
        group: 'Timer',
        combo: 'f',
        keywords: 'begin work timer pomodoro',
        run: () => {
          const subject = subjects.find((item) => item._id === settings?.defaultSubject) ?? subjects[0];
          if (!subject) {
            toast({ tone: 'info', title: 'Create a subject first', detail: 'A session needs somewhere to be filed.' });
            void navigate('/subjects?new=1');
            return;
          }
          void timerActions.start({
            subjectId: subject._id,
            taskId: null,
            plannedSeconds: (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
            timeZone,
          });
        },
      });
    }
    if (phase === 'focus') {
      list.push({ id: 'timer.pause', label: 'Pause timer', group: 'Timer', combo: 'space', run: () => void timerActions.pause() });
      list.push({ id: 'timer.break', label: 'Take a break', group: 'Timer', combo: 'b', run: () => void timerActions.startBreak() });
    }
    if (phase === 'paused') {
      list.push({ id: 'timer.resume', label: 'Resume timer', group: 'Timer', combo: 'space', run: () => void timerActions.resume() });
    }
    if (phase === 'break') {
      list.push({ id: 'timer.endBreak', label: 'End break and resume focus', group: 'Timer', combo: 'b', run: () => void timerActions.endBreak() });
    }
    if (phase !== 'idle') {
      list.push({ id: 'timer.distraction', label: 'Log a distraction', group: 'Timer', keywords: 'interruption phone', run: () => useApp.getState().setPanel('distractions') });
      list.push({ id: 'timer.extend5', label: 'Extend session by 5 minutes', group: 'Timer', keywords: 'longer more 5m', run: () => void timerActions.extend(5) });
      list.push({ id: 'timer.extend', label: 'Extend session by 10 minutes', group: 'Timer', keywords: 'longer more 10m', run: () => void timerActions.extend(10) });
      list.push({ id: 'timer.extend15', label: 'Extend session by 15 minutes', group: 'Timer', keywords: 'longer more 15m', run: () => void timerActions.extend(15) });
      list.push({ id: 'timer.extend30', label: 'Extend session by 30 minutes', group: 'Timer', keywords: 'longer more 30m', run: () => void timerActions.extend(30) });
      list.push({
        id: 'timer.end',
        label: 'End session',
        group: 'Timer',
        combo: 'esc',
        keywords: 'stop finish complete',
        run: () => {
          useApp.getState().setPanel('session');
        },
      });
      list.push({
        id: 'timer.reset',
        label: 'Reset timer (discard session)',
        group: 'Timer',
        keywords: 'stop cancel abandon reset drop',
        run: () => {
          void timerActions.clear();
        },
      });
    } else {
      const presets = settings?.focusPresets ?? [
        { minutes: 15, label: '15' },
        { minutes: 25, label: '25' },
        { minutes: 45, label: '45' },
        { minutes: 60, label: '60' },
        { minutes: 90, label: '90' },
      ];
      for (const preset of presets) {
        list.push({
          id: `timer.duration.${preset.minutes}`,
          label: `Start focus session (${preset.minutes}m)`,
          group: 'Timer',
          keywords: `duration ${preset.minutes} minutes timer`,
          run: () => {
            const subject = subjects.find((item) => item._id === settings?.defaultSubject) ?? subjects[0];
            if (!subject) {
              toast({ tone: 'info', title: 'Create a subject first', detail: 'A session needs somewhere to be filed.' });
              void navigate('/subjects?new=1');
              return;
            }
            void timerActions.start({
              subjectId: subject._id,
              taskId: null,
              plannedSeconds: preset.minutes * 60,
              timeZone,
            });
          },
        });
      }
    }

    // --------------------------------------------------------------- go to
    const destinations: Array<[string, string]> = [
      ['/', 'Open the cockpit'],
      ['/insights', 'Open insights'],
      ['/subjects', 'Open subjects'],
      ['/tasks', 'Open tasks'],
      ['/goals', 'Open goals'],
      ['/achievements', 'Open achievements'],
      ['/review/daily', "Open today's review"],
      ['/review/weekly', 'Open the weekly review'],
      ['/calendar', 'Open the calendar'],
      ['/settings', 'Open settings'],
    ];
    for (const [to, label] of destinations) {
      list.push({
        id: `nav.${to}`,
        label,
        group: 'Go to',
        keywords: to.replace('/', ''),
        run: () => void navigate(to),
      });
    }

    // ------------------------------------------------------- start focus on
    for (const subject of subjects) {
      list.push({
        id: `start.${subject._id}`,
        label: `Focus on ${subject.name}`,
        group: 'Start focus on',
        keywords: `${subject.name} ${subject.description}`,
        hint: subject.weeklyTargetSeconds > 0 ? `${duration(subject.weeklyTargetSeconds)}/week target` : undefined,
        run: () =>
          void timerActions.start({
            subjectId: subject._id,
            taskId: null,
            plannedSeconds: (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
            timeZone,
          }),
      });
    }

    // ------------------------------------------------------------ open tasks
    for (const task of tasks.filter((item) => item.status === 'todo' || item.status === 'in-progress').slice(0, 40)) {
      const subject = subjects.find((item) => item._id === task.subject);
      list.push({
        id: `task.${task._id}`,
        label: task.title,
        group: 'Tasks',
        keywords: `${subject?.name ?? ''} ${task.tags.join(' ')}`,
        hint: subject ? `Start a session on ${subject.name}` : undefined,
        run: () =>
          void timerActions.start({
            subjectId: task.subject,
            taskId: task._id,
            plannedSeconds: task.estimatedDuration > 0 ? task.estimatedDuration : (settings?.focusPresets?.[1]?.minutes ?? 25) * 60,
            timeZone,
          }),
      });
    }

    // -------------------------------------------------------------- settings
    list.push({
      id: 'settings.theme',
      label: settings?.theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode',
      group: 'Settings',
      keywords: 'appearance night light',
      run: () => void updateSettings({ theme: settings?.theme === 'light' ? 'dark' : 'light' }),
    });
    list.push({
      id: 'settings.motion',
      label: settings?.reduceMotion ? 'Enable animations' : 'Reduce motion',
      group: 'Settings',
      keywords: 'accessibility animation',
      run: () => void updateSettings({ reduceMotion: !settings?.reduceMotion }),
    });
    list.push({
      id: 'settings.newSubject',
      label: 'Create a subject',
      group: 'Settings',
      keywords: 'add new project',
      run: () => void navigate('/subjects?new=1'),
    });
    list.push({
      id: 'settings.newTask',
      label: 'Create a task',
      group: 'Settings',
      keywords: 'add new todo',
      run: () => void navigate('/tasks?new=1'),
    });
    list.push({
      id: 'view.fullscreen',
      label: 'Toggle fullscreen',
      group: 'Settings',
      keywords: 'maximize display screen monitor window',
      run: () => {
        if (!document.fullscreenElement) {
          void document.documentElement.requestFullscreen().catch(() => {});
        } else {
          void document.exitFullscreen().catch(() => {});
        }
      },
    });
    list.push({
      id: 'view.focusMode',
      label: 'Toggle focus mode',
      group: 'Settings',
      combo: 'm',
      keywords: 'focus mode distraction free zen',
      run: () => {
        const current = useApp.getState().focusMode;
        useApp.getState().setFocusMode(!current);
      },
    });

    return list;
  }, [navigate, openSession, running, settings, subjects, tasks, timeZone, toast, updateSettings, phase]);

  const results = useMemo(() => rank(commands, query), [commands, query]);

  // Reset the cursor whenever the result set changes shape.
  useEffect(() => setActiveIndex(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    // Focus on the next frame: the dialog mounts in this one.
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [open]);

  // Keep the highlighted row in view when the user arrows past the fold.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % Math.max(1, results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % Math.max(1, results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[activeIndex];
      if (!chosen) return;
      setPaletteOpen(false);
      void chosen.run();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPaletteOpen(false);
    }
  };

  // Group the flat ranked list back into sections, preserving rank order.
  const grouped = new Map<string, Array<{ command: Command; index: number }>>();
  results.forEach((command, index) => {
    const bucket = grouped.get(command.group) ?? [];
    bucket.push({ command, index });
    grouped.set(command.group, bucket);
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" role="presentation">
      <button
        type="button"
        aria-label="Close the command palette"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-void/60 backdrop-blur-[3px]"
        onClick={() => setPaletteOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl animate-sweep overflow-hidden rounded-lg border border-edge bg-surface/95 shadow-pane backdrop-blur-xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden="true">
            <circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.4 10.4L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command, a subject, or a task…"
            aria-label="Search commands"
            aria-controls="palette-results"
            className="h-12 flex-1 bg-transparent text-base text-ink placeholder:text-ghost focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <KeyHint combo="esc" />
        </div>

        <ul
          id="palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="max-h-[52vh] overflow-y-auto py-1.5 scroll-thin"
        >
          {results.length === 0 && (
            <li className="px-4 py-8 text-center">
              <p className="text-small text-muted">Nothing matches “{query}”.</p>
              <p className="hint mt-1">Try a subject name, “start”, “break”, or “settings”.</p>
            </li>
          )}

          {[...grouped.entries()].map(([group, items]) => (
            <li key={group}>
              <p className="px-4 pb-1 pt-2.5 text-micro uppercase tracking-[0.1em] text-ghost">{group}</p>
              <ul>
                {items.map(({ command, index }) => (
                  <li key={command.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      data-active={index === activeIndex}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => {
                        setPaletteOpen(false);
                        void command.run();
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-instant',
                        index === activeIndex ? 'bg-accent/10' : 'hover:bg-raised',
                      )}
                    >
                      <span className={cn('flex-1 truncate text-small', index === activeIndex ? 'text-ink' : 'text-muted')}>
                        {command.label}
                      </span>
                      {command.hint && <span className="hidden shrink-0 text-tiny text-ghost sm:inline">{command.hint}</span>}
                      {command.combo && <KeyHint combo={command.combo} />}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-micro text-ghost">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <KeyHint combo="↑" /> <KeyHint combo="↓" /> navigate
            </span>
            <span className="flex items-center gap-1">
              <KeyHint combo="enter" /> run
            </span>
          </span>
          <span>{results.length} command{results.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Rank commands against a query.
 *
 * A subsequence match with bonuses for contiguity, word starts and a prefix on
 * the label. Deliberately not fuzzy-fuzzy: a palette that surfaces
 * "Reduce motion" for the query `r` is a palette that makes you scroll.
 *
 * An empty query returns everything, unranked, in declaration order — which is
 * also the order the groups appear, so the palette reads as a menu before it
 * becomes a search.
 */
export function rank<T extends { label: string; group: string; keywords?: string }>(items: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const haystack = item.label.toLowerCase();
    const score = matchScore(haystack, needle);
    if (score !== null) {
      scored.push({ item, score });
      continue;
    }
    // Fall back to keyword matches at a fixed penalty, so an explicit label match
    // always outranks a hidden keyword one.
    const keywordScore = item.keywords ? matchScore(item.keywords.toLowerCase(), needle) : null;
    if (keywordScore !== null) scored.push({ item, score: keywordScore - 40 });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.item.label.length - b.item.label.length || a.item.label.localeCompare(b.item.label))
    .map((entry) => entry.item);
}

/** Returns a score for a subsequence match, or null when there is none. */
function matchScore(haystack: string, needle: string): number | null {
  if (!needle) return 0;

  let score = 0;
  let cursor = 0;
  let consecutive = 0;

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;

    score += 10;
    // Contiguity: each adjacent match is worth progressively more, which is what
    // makes "timer" beat a scattershot match across a long label.
    if (found === cursor && cursor > 0) {
      consecutive += 1;
      score += 8 + consecutive * 2;
    } else {
      consecutive = 0;
    }
    // Word boundaries are what a human means by a "good" match.
    if (found === 0) score += 24;
    else if (/[\s\-_/.]/.test(haystack[found - 1] ?? '')) score += 14;

    cursor = found + 1;
  }

  // Prefer shorter haystacks when scores tie: "Goals" over "Open the goals view".
  score -= Math.min(20, Math.floor(haystack.length / 4));
  return score;
}
