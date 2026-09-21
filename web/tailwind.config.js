/**
 * Tailwind configuration.
 *
 * The design system is expressed as CSS custom properties in
 * `src/styles/tokens.css`, and Tailwind is pointed at those variables rather than
 * at hard-coded values. That means one place defines the palette, and the same
 * tokens can be read by canvas, SVG and inline styles — which matters here because
 * several of the visualisations are computed geometry rather than styled markup.
 *
 * Colours are declared with the `<alpha-value>` placeholder so Tailwind's
 * opacity modifiers keep working against variables.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // Surfaces, from the deepest canvas outward.
        void: 'rgb(var(--void) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',

        // Foreground ramp.
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        ghost: 'rgb(var(--ghost) / <alpha-value>)',

        line: 'rgb(var(--line) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',

        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-ink': 'rgb(var(--accent-ink) / <alpha-value>)',

        // Semantic states. Deliberately few: the product should read as calm.
        focus: 'rgb(var(--state-focus) / <alpha-value>)',
        rest: 'rgb(var(--state-rest) / <alpha-value>)',
        pause: 'rgb(var(--state-pause) / <alpha-value>)',
        alert: 'rgb(var(--state-alert) / <alpha-value>)',
        good: 'rgb(var(--state-good) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Reserved for instrumentation: the timer readout, metrics, timestamps,
        // keyboard hints. JetBrains Mono has true tabular figures, which stops
        // the big timer from jittering as digits change.
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // A compact, deliberate type scale. Nothing between these steps.
        micro: ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.08em' }],
        tiny: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em' }],
        small: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        lead: ['1.0625rem', { lineHeight: '1.625rem' }],
        title: ['1.375rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        head: ['1.875rem', { lineHeight: '2.125rem', letterSpacing: '-0.02em' }],
        display: ['2.75rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        // The instrument readout. Sized in viewport units so it stays the
        // dominant object on a phone and on a 34-inch monitor alike.
        instrument: ['clamp(3.5rem, 13vw, 9rem)', { lineHeight: '0.9', letterSpacing: '-0.04em' }],
      },
      spacing: {
        // The 4px base grid, plus two large rhythm steps for the cockpit.
        gutter: '1.25rem',
        rail: '13.5rem',
        spine: '4.5rem',
        dock: '4.25rem',
      },
      borderRadius: {
        // Tight by default. Rounded-everything is the fastest way to look generic.
        xs: '0.125rem',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1.125rem',
        pill: '999px',
      },
      boxShadow: {
        lift: '0 1px 0 0 rgb(var(--edge) / 0.6), 0 12px 32px -12px rgb(0 0 0 / 0.55)',
        pane: '0 24px 64px -24px rgb(0 0 0 / 0.7)',
        glow: '0 0 0 1px rgb(var(--accent) / 0.35), 0 0 48px -12px rgb(var(--accent) / 0.5)',
        inset: 'inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
      },
      transitionTimingFunction: {
        // A single motion signature for the whole product.
        forge: 'cubic-bezier(0.22, 1, 0.36, 1)',
        snap: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        instant: '90ms',
        quick: '160ms',
        calm: '320ms',
        slow: '640ms',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.015)' },
        },
        ridge: {
          from: { strokeDashoffset: 'var(--dash-from)' },
          to: { strokeDashoffset: 'var(--dash-to)' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        sweep: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        pulseRing: {
          '0%': { transform: 'scale(0.92)', opacity: '0.7' },
          '70%': { transform: 'scale(1.22)', opacity: '0' },
          '100%': { transform: 'scale(1.22)', opacity: '0' },
        },
      },
      animation: {
        breathe: 'breathe 5.5s ease-in-out infinite',
        rise: 'rise 260ms cubic-bezier(0.22, 1, 0.36, 1) both',
        sweep: 'sweep 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        pulseRing: 'pulseRing 2.4s ease-out infinite',
      },
    },
  },
  plugins: [],
};
