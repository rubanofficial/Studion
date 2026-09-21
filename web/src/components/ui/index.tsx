/**
 * UI primitives.
 *
 * Every interactive element in the app is built from these. That is what keeps
 * states consistent — focus rings, disabled treatment, invalid styling and
 * keyboard behaviour are defined once, and a component that hand-rolls a
 * `<button>` is a component that will eventually lose its focus ring.
 *
 * Accessibility is structural, not decorative: real elements (`button`, `input`,
 * `dialog`), labelled controls, `aria-live` for announcements, and focus returned
 * to the trigger when a dialog closes.
 */

import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

import { useScrollLock } from '../../hooks';
import { useApp } from '../../store/app';

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'instrument';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const variantClass = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
    instrument: 'btn-instrument',
  }[variant];

  const sizeClass = variant === 'instrument' ? '' : size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';

  return (
    <button
      type="button"
      className={cn('btn', variantClass, sizeClass, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonProps & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted',
        'transition-colors duration-quick hover:border-edge hover:bg-raised hover:text-ink',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('h-3.5 w-3.5 animate-spin', className)} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ----------------------------------------------------------------------- Field

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  /** Hide the visible label but keep it for assistive technology. */
  hideLabel?: boolean;
}

export function Field({ label, hint, error, hideLabel, className, id, ...rest }: FieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={cn('label', hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        id={fieldId}
        className={cn('field', error && 'field-invalid', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...rest}
      />
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="text-small text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
}

export function TextArea({ label, hint, error, hideLabel, className, id, ...rest }: TextAreaProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={cn('label', hideLabel && 'sr-only')}>
        {label}
      </label>
      <textarea
        id={fieldId}
        className={cn('field min-h-[5rem] resize-y', error && 'field-invalid', className)}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {hint && <p className="hint">{hint}</p>}
      {error && (
        <p className="text-small text-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  hideLabel,
  className,
  id,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className={cn('label', hideLabel && 'sr-only')}>
        {label}
      </label>
      <select id={fieldId} className={cn('field', error && 'field-invalid', className)} {...rest}>
        {children}
      </select>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-small text-ink">{label}</p>
        {description && <p className="hint mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-pill border transition-colors duration-quick',
          checked ? 'border-accent/60 bg-accent/30' : 'border-edge bg-sunken',
          disabled && 'opacity-40',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform duration-quick ease-forge',
            checked ? 'translate-x-[1.15rem] bg-accent' : 'translate-x-0.5 bg-faint',
          )}
        />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------- Segmented

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          aria-selected={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-sm px-2.5 py-1 text-tiny transition-colors duration-quick',
            value === option.value ? 'bg-raised text-ink' : 'text-faint hover:text-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------- Progress

export function ProgressBar({
  value,
  tone = 'accent',
  height = 3,
  label,
}: {
  value: number;
  tone?: 'accent' | 'rest' | 'pause';
  height?: number;
  label?: string;
}) {
  const colour = tone === 'rest' ? 'bg-rest' : tone === 'pause' ? 'bg-pause' : 'bg-accent';
  return (
    <div
      className="w-full overflow-hidden rounded-pill bg-sunken"
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-pill transition-[width] duration-calm ease-forge', colour)}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

// ----------------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    // Move focus into the dialog so a keyboard user is not left behind it.
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab') return;

      // Trap focus: a dialog that lets you tab into the page behind it is a
      // dialog that has visually lied about being modal.
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, textarea, select, button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter((node) => !node.hasAttribute('disabled'));
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-void/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'relative w-full animate-sweep rounded-t-xl border border-edge bg-surface shadow-pane sm:rounded-xl',
          width,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lead text-ink">
              {title}
            </h2>
            {description && <p className="hint mt-1">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            </svg>
          </IconButton>
        </header>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4 scroll-thin">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------- Toast

export function ToastHost() {
  const toasts = useApp((state) => state.toasts);
  const dismiss = useApp((state) => state.dismissToast);

  const toneClass: Record<string, string> = {
    info: 'border-edge',
    success: 'border-good/40',
    warning: 'border-pause/40',
    error: 'border-alert/50',
  };

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      <div aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto animate-rise rounded-lg border bg-raised px-3.5 py-2.5 shadow-lift',
              toneClass[toast.tone],
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-small text-ink">{toast.title}</p>
                {toast.detail && <p className="hint mt-0.5">{toast.detail}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {toast.action && (
                  <button
                    type="button"
                    className="rounded-sm px-2 py-1 text-tiny text-accent hover:bg-accent/10"
                    onClick={() => {
                      toast.action?.run();
                      dismiss(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
                <IconButton label="Dismiss" className="h-6 w-6" onClick={() => dismiss(toast.id)}>
                  <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- Feedback

export function Skeleton({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-raised', className)} role="status" aria-label={label} />;
}

export function EmptyState({
  title,
  detail,
  action,
  icon,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ghost">{icon}</div>}
      <div>
        <p className="text-base text-ink">{title}</p>
        {detail && <p className="hint mx-auto mt-1 max-w-sm">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Error state that explains what happened and what to do about it.
 *
 * The kind of failure determines the copy, because "check your connection" is
 * unhelpful when the server actually rejected the request, and "try again" is
 * unhelpful when the user is offline.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const shape = error as { kind?: string; message?: string; retryable?: boolean } | null;
  const kind = shape?.kind ?? 'http';

  const heading =
    kind === 'offline'
      ? 'You are offline'
      : kind === 'timeout'
        ? 'The server is taking too long'
        : kind === 'network'
          ? 'Could not reach the server'
          : 'Something went wrong';

  const detail =
    shape?.message ??
    'The request could not be completed. Nothing you did caused this — your recorded sessions are safe.';

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-alert/30 bg-alert/[0.04] px-4 py-3.5">
      <div>
        <p className="text-small text-ink">{heading}</p>
        <p className="hint mt-1">{detail}</p>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function SectionHeading({
  title,
  detail,
  action,
  className,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div>
        <h2 className="text-title text-ink">{title}</h2>
        {detail && <p className="hint mt-1">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function Metric({
  label,
  value,
  sub,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
  className?: string;
}) {
  const toneClass =
    tone === 'positive' ? 'text-good' : tone === 'negative' ? 'text-alert' : tone === 'muted' ? 'text-muted' : 'text-ink';
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="label">{label}</span>
      <span className={cn('metric', toneClass)}>{value}</span>
      {sub && <span className="hint">{sub}</span>}
    </div>
  );
}

export function KeyHint({ combo }: { combo: string }) {
  const isApple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const parts = combo.split('+').map((part) => {
    if (part === 'mod') return isApple ? '⌘' : 'Ctrl';
    if (part === 'shift') return '⇧';
    if (part === 'ctrl') return 'Ctrl';
    if (part === 'space') return 'Space';
    if (part === 'esc') return 'Esc';
    if (part === 'left') return '←';
    if (part === 'right') return '→';
    return part.length === 1 ? part.toUpperCase() : part;
  });

  return (
    <span className="flex items-center gap-1">
      {parts.map((part) => (
        <kbd key={part} className="key">
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  if (!onClick) {
    return (
      <span className={cn('chip', active && 'chip-active')} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={cn('chip transition-colors', active ? 'chip-active' : 'hover:border-faint hover:text-ink')}>
      {children}
    </button>
  );
}

export function StatRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-small text-muted">{label}</span>
      <span
        className={cn(
          'font-mono text-small numeric-stable',
          tone === 'positive' ? 'text-good' : tone === 'negative' ? 'text-alert' : 'text-ink',
        )}
      >
        {value}
      </span>
    </div>
  );
}
