/**
 * Client entry point.
 *
 * Order matters here. Fonts are imported before any application module so the
 * type system is registered before React paints (self-hosted, so there is no
 * third-party request and no layout shift once the face loads).
 *
 * The service worker is registered but deliberately *not* auto-updating: the
 * registration returns an update callback and the shell surfaces it as a button.
 * Reloading a tab that is mid-session to install a new bundle would be hostile.
 */

import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyAccent, applyMotion, applyTheme, getStoredAccent, getStoredMotion, getStoredTheme } from './lib/theme';
import { timer } from './store/timer';

// Theme, accent and motion are applied before first paint as well as inline in
// `index.html` — the inline script wins for the very first frame, this keeps the
// values correct if the document was restored from the bfcache.
applyTheme(getStoredTheme());
applyAccent(getStoredAccent() ?? '#5eead4');
applyMotion(getStoredMotion());

/**
 * Restore any session that was running before the tab was closed.
 *
 * This runs outside React because a session must survive a re-render, and it is
 * awaited before the first paint of the cockpit so the user never briefly sees
 * "idle" while a session is actually running.
 */
void timer.hydrate();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Service worker registration with an explicit update prompt.
 *
 * `vite-plugin-pwa` writes `/sw.js` in a production build; in development the
 * registration is a no-op because `devOptions.enabled` is false.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state !== 'installed') return;
            if (!navigator.serviceWorker.controller) return;
            window.dispatchEvent(new CustomEvent('focusforge:update-available'));
          });
        });
      })
      .catch(() => {
        // A failed registration degrades to a normal web app; it must not break boot.
      });
  });
}
