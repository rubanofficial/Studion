import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Vite configuration.
 *
 * Three things here are load-bearing rather than boilerplate:
 *
 *   1. The dev proxy sends `/api` to the Express server. That makes the browser
 *      see one origin in development, which matters because the refresh token
 *      travels in an httpOnly cookie — same-origin means `SameSite=Lax` works and
 *      the whole flow behaves the way it will in production behind a rewrite.
 *
 *   2. The service worker is configured to *never* cache `/api`. A cached
 *      analytics response would be indistinguishable from a real one, and the
 *      offline story here is an explicit outbox queue, not stale reads.
 *
 *   3. Vendor chunks are split so a change to application code does not
 *      invalidate the React bundle in users' caches.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'Studion — Focus Operating System',
        short_name: 'Studion',
        description: 'A focus timer and study analytics instrument. Track where your hours actually go.',
        theme_color: '#08090c',
        background_color: '#08090c',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Start a focus session', short_name: 'Focus', url: '/?action=focus' },
          { name: 'Open analytics', short_name: 'Analytics', url: '/insights' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The API is never cached: the offline design is a write-behind outbox,
        // and a served-from-cache analytics payload would look like live data.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // Self-hosted fonts are content-addressed by the bundler, so they are
            // safe to serve from cache forever.
            urlPattern: /\/assets\/.*\.woff2$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'focusforge-fonts',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          state: ['zustand'],
          storage: ['idb'],
        },
      },
    },
  },
});
