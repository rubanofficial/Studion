/**
 * Theme, accent and motion preferences.
 *
 * These live in `localStorage` and are applied by mutating attributes and CSS
 * custom properties on `<html>`, rather than being driven through React state.
 * That is deliberate: the palette has to be correct on the very first paint
 * (see the inline bootstrap in `index.html`), and a theme that only applies after
 * a React effect is a visible flash of the wrong colour.
 *
 * The server is still the owner of the *setting*; this module is the fast local
 * mirror of it.
 */

import { hexToRgbChannels } from './format';

export type ThemeChoice = 'dark' | 'light';

const THEME_KEY = 'focusforge.theme';
const ACCENT_KEY = 'focusforge.accent';
const MOTION_KEY = 'focusforge.motion';

export function getStoredTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* private browsing */
  }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: ThemeChoice): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
  // Keep the browser chrome in step with the app on mobile.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && !meta.getAttribute('media')) meta.setAttribute('content', theme === 'dark' ? '#08090c' : '#f6f7f9');
}

/**
 * Set the accent colour.
 *
 * The accent is not just a preference — at runtime it is overwritten with the
 * active subject's colour, so the instrument is painted by what you are working
 * on. This function sets the *fallback* used when no subject is selected.
 */
export function applyAccent(hex: string): void {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  document.documentElement.style.setProperty('--accent', hexToRgbChannels(hex));
  try {
    localStorage.setItem(ACCENT_KEY, hex);
  } catch {
    /* ignore */
  }
}

export function getStoredAccent(): string | null {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    return stored && /^#[0-9a-fA-F]{6}$/.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Motion preference.
 *
 * Separate from the OS setting on purpose: reduced motion is also a preference
 * *about this product* — some people simply do not want an animated instrument —
 * and the two must be able to differ.
 */
export function applyMotion(reduced: boolean): void {
  document.documentElement.setAttribute('data-motion', reduced ? 'reduced' : 'full');
  try {
    localStorage.setItem(MOTION_KEY, reduced ? 'reduced' : 'full');
  } catch {
    /* ignore */
  }
}

export function getStoredMotion(): boolean {
  try {
    return localStorage.getItem(MOTION_KEY) === 'reduced';
  } catch {
    return false;
  }
}

/** Does the OS ask for reduced motion? Used as the default for new users. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Paint the ambient wash and the state colour.
 *
 * The ambient background is informational, not decorative: it shifts with the
 * timer state, so a glance from across the room tells you whether you are
 * supposed to be working or resting. Two subject-adjacent hues are used so the
 * gradient has depth without introducing a second colour language.
 */
export function applyState(
  state: 'idle' | 'focus' | 'break' | 'paused' | 'finished',
  accentHex: string,
  options: { ambient: boolean } = { ambient: true },
): void {
  const root = document.documentElement;
  const channels = hexToRgbChannels(accentHex);

  root.style.setProperty('--accent', channels);

  if (!options.ambient || state === 'idle') {
    root.style.setProperty('--ambient-strength', state === 'idle' ? '0.05' : '0.08');
    return;
  }

  // A cool second hue at a fixed 40° offset keeps the wash coherent whatever the
  // subject colour happens to be.
  const shifted = rotateHue(accentHex, state === 'break' ? 160 : 40);
  root.style.setProperty('--ambient-a', channels);
  root.style.setProperty('--ambient-b', hexToRgbChannels(shifted));
  root.style.setProperty('--ambient-strength', state === 'focus' ? '0.16' : state === 'break' ? '0.13' : '0.08');
}

/** Rotate a hex colour's hue by `degrees`. Used only for the ambient wash. */
function rotateHue(hex: string, degrees: number): string {
  const value = hex.replace('#', '');
  let r = Number.parseInt(value.slice(0, 2), 16) / 255;
  let g = Number.parseInt(value.slice(2, 4), 16) / 255;
  let b = Number.parseInt(value.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  h = (h + degrees + 360) % 360;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const pick = (): [number, number, number] => {
    if (h < 60) return [c, x, 0];
    if (h < 120) return [x, c, 0];
    if (h < 180) return [0, c, x];
    if (h < 240) return [0, x, c];
    if (h < 300) return [x, 0, c];
    return [c, 0, x];
  };

  [r, g, b] = pick();
  const toHex = (channel: number) =>
    Math.round(Math.min(1, Math.max(0, channel + m)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
