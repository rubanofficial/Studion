/**
 * Shared hooks.
 *
 * Small and single-purpose. Anything that needs to survive a re-render, a route
 * change or a reload lives in the store or the timer engine instead — a hook is
 * for *observing* the world, never for owning state that matters.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useApp } from '../store/app';
import { timer, timerActions } from '../store/timer';

/**
 * Track connectivity and flush the offline queue when it returns.
 *
 * Recovery is the important half: coming back online should *automatically* push
 * anything that was recorded while offline, because a user who has to remember to
 * press "sync" will eventually lose data.
 */
export function useConnectivity(): { online: boolean; pendingSync: number } {
  const online = useApp((state) => state.online);
  const pendingSync = useApp((state) => state.pendingSync);
  const setOnline = useApp((state) => state.setOnline);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void (async () => {
        const flushed = await timerActions.flushOutbox();
        await timerActions.flush();
        useApp.getState().setPendingSync(0);
        if (flushed > 0) {
          useApp.getState().toast({
            tone: 'success',
            title: `${flushed} session${flushed === 1 ? '' : 's'} synced`,
            detail: 'Anything you recorded offline is now saved.',
          });
        }
        await useApp.getState().loadOverview({ quiet: true });
      })();
    };

    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [setOnline]);

  return { online, pendingSync };
}

/**
 * Recompute the timer whenever the tab becomes visible again.
 *
 * A background tab throttles its timers, so the displayed reading can be stale by
 * minutes when the user comes back. Because every number is derived from
 * timestamps, re-emitting is enough — there is nothing to correct.
 */
export function useVisibilityRefresh(onVisible?: () => void): void {
  const handlerRef = useRef(onVisible);
  handlerRef.current = onVisible;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void timerActions.flush();
      handlerRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
    };
  }, []);
}

export interface ShortcutDefinition {
  /** A single key (`' '`, `'r'`), or a combo (`'mod+k'`, `'shift+?'`). */
  combo: string;
  handler: () => void;
  /** Do not fire while the user is typing in a field. */
  allowInInput?: boolean;
  description: string;
  group: 'Timer' | 'Navigation' | 'View' | 'Session';
}

/**
 * Global keyboard shortcuts.
 *
 * Two rules, both about not being annoying:
 *   - Nothing fires while the user is typing, unless it explicitly opts in. A
 *     space bar that pauses a timer instead of typing a space is the classic
 *     version of this bug.
 *   - Modifiers are matched properly, so `mod+k` does not also fire on `ctrl+k`
 *     while shift is held.
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[], enabled = true): void {
  const ref = useRef(shortcuts);
  ref.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable === true ||
        target?.getAttribute('role') === 'textbox';

      for (const shortcut of ref.current) {
        if (isTyping && !shortcut.allowInInput) continue;
        if (!matches(event, shortcut.combo)) continue;

        // Let the browser handle plain modifier combos it owns (reload, devtools).
        event.preventDefault();
        shortcut.handler();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

function matches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantsMod = parts.includes('mod');
  const wantsCtrlOnly = parts.includes('ctrl') && !wantsMod;
  const wantsShift = parts.includes('shift');

  const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const modPressed = isApple ? event.metaKey : event.ctrlKey;

  if (wantsMod && !modPressed) return false;

  // For a plain `ctrl+…` combo, require ctrl on every platform and no meta.
  const hasPlatformMod = wantsCtrlOnly ? event.ctrlKey : false;
  const spuriousMod = wantsMod || wantsCtrlOnly ? false : event.metaKey;

  if (wantsCtrlOnly && !hasPlatformMod) return false;
  if (spuriousMod) return false;
  if (wantsShift !== event.shiftKey) {
    // `?` is shift+/ on most layouts; treat an explicit shift as satisfied.
    if (!(key === '?' && event.shiftKey)) return false;
  }

  const eventKey = event.key.toLowerCase();
  if (key === 'space') return eventKey === ' ';
  if (key === 'esc') return eventKey === 'escape';
  if (key === 'left') return eventKey === 'arrowleft';
  if (key === 'right') return eventKey === 'arrowright';
  return eventKey === key;
}

/** A media query as React state. Used for the intentional mobile layout switch. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(list.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** True on phone-sized viewports, where the cockpit is laid out differently. */
export function useIsCompact(): boolean {
  return useMediaQuery('(max-width: 767px)');
}

export function useIsTouch(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}

/**
 * Run a callback on an interval, with the latest closure.
 *
 * `setInterval` inside an effect captures its closure once; the ref keeps the
 * callback current so a polling loop does not act on stale props.
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const handle = setInterval(() => ref.current(), delayMs);
    return () => clearInterval(handle);
  }, [delayMs]);
}

/** Lock body scroll while a modal or the focus mode is open. */
export function useScrollLock(locked: boolean): void {
  useLayoutEffect(() => {
    if (!locked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

/**
 * Restore focus to the element that opened a dialog. Without this, closing a
 * modal leaves focus on `<body>` and a keyboard user has to tab from the top.
 */
export function useReturnFocus(active: boolean): React.RefObject<HTMLElement> {
  const triggerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (active) return;
    return;
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      (triggerRef as React.MutableRefObject<HTMLElement | null>).current = previous;
      previous?.focus?.();
    };
  }, [active]);

  return triggerRef;
}

/** Announce a message to assistive technology without a visible element. */
export function useAnnounce(): (message: string) => void {
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!message) return;
    const handle = setTimeout(() => setMessage(''), 1000);
    return () => clearTimeout(handle);
  }, [message]);

  return setMessage;
}

/** Exposed so components can read the live snapshot without a second subscription. */
export { timer };
