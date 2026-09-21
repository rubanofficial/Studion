/**
 * Settings.
 *
 * Organised as a list of short, single-purpose rooms rather than one long scroll,
 * because a settings page that takes four screens of scrolling to cross is a
 * settings page nobody finishes.
 *
 * Two principles run through it:
 *
 *   - **Every control says what it changes.** "Auto-start breaks" is followed by
 *     "the break begins the moment a session ends, without a confirmation" — not
 *     left for the user to discover.
 *   - **Nothing is destructive without a way back.** Export is offered right next
 *     to deletion, and account deletion requires the password *and* a typed
 *     confirmation.
 */

import { useEffect, useState } from 'react';

import { AMBIENCE } from '@focusforge/core';

import { api } from '../../lib/api';
import { duration } from '../../lib/format';
import { applyTheme, prefersReducedMotion } from '../../lib/theme';
import { playAmbience, playChime, releaseAudio, setAmbienceVolume, stopAmbience } from '../../lib/sound';
import { useApp } from '../../store/app';
import { Button, Field, Modal, SectionHeading, SelectField, Switch, cn } from '../../components/ui';
import { SHORTCUT_REFERENCE } from '../../components/shell/ShortcutSheet';
import { KeyHint } from '../../components/ui';
import { useCapabilities, usePrivacyStatement } from '../../data/queries';

const AMBIENCE_LABELS: Record<string, string> = {
  none: 'Silence',
  rain: 'Rain',
  cafe: 'Cafe',
  forest: 'Forest',
  white: 'White noise',
  brown: 'Brown noise',
  lofi: 'Low drone',
};

type Tab = 'profile' | 'timer' | 'appearance' | 'sound' | 'notifications' | 'data' | 'shortcuts' | 'privacy';

export function SettingsView() {
  const settings = useApp((state) => state.settings);
  const user = useApp((state) => state.user);
  const updateSettings = useApp((state) => state.updateSettings);
  const toast = useApp((state) => state.toast);

  const [tab, setTab] = useState<Tab>('profile');
  const [saving, setSaving] = useState(false);

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'profile', label: 'Profile' },
    { id: 'timer', label: 'Timer' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'sound', label: 'Sound' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'data', label: 'Data' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'privacy', label: 'Privacy' },
  ];

  /** Every settings write goes through here so the failure path is handled once. */
  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    const result = await updateSettings(patch);
    setSaving(false);
    if (!result.ok) {
      toast({
        tone: 'error',
        title: 'That setting did not save',
        detail: result.error.fields ? Object.values(result.error.fields)[0] : result.error.message,
      });
      return false;
    }
    return true;
  };

  if (!settings || !user) return null;

  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-head text-ink">Settings</h1>
          <p className="hint mt-1">
            Changes apply here and sync to your other devices. {saving ? 'Saving…' : 'All changes saved.'}
          </p>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-20 lg:self-start">
          <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
            {tabs.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={tab === entry.id ? 'true' : undefined}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-small transition-colors duration-quick',
                    tab === entry.id ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink',
                  )}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-9">
          {tab === 'profile' && <ProfileSection />}

          {tab === 'timer' && (
            <>
              <section>
                <SectionHeading title="Presets" detail="These appear on the cockpit and in the command palette." />
                <div className="mt-3 flex flex-col gap-5 rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <PresetEditor
                    label="Focus lengths (minutes)"
                    presets={settings.focusPresets}
                    onSave={(presets) => save({ focusPresets: presets })}
                  />
                  <PresetEditor
                    label="Break lengths (minutes)"
                    presets={settings.breakPresets}
                    onSave={(presets) => save({ breakPresets: presets })}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <Field
                      label="Short break"
                      type="number"
                      min={1}
                      max={60}
                      value={settings.shortBreakMinutes}
                      onChange={(event) => void save({ shortBreakMinutes: Number(event.target.value) })}
                      hint="minutes"
                    />
                    <Field
                      label="Long break"
                      type="number"
                      min={1}
                      max={120}
                      value={settings.longBreakMinutes}
                      onChange={(event) => void save({ longBreakMinutes: Number(event.target.value) })}
                      hint="minutes"
                    />
                    <Field
                      label="Long break every"
                      type="number"
                      min={2}
                      max={12}
                      value={settings.longBreakEvery}
                      onChange={(event) => void save({ longBreakEvery: Number(event.target.value) })}
                      hint="sessions"
                    />
                  </div>
                </div>
              </section>

              <section>
                <SectionHeading title="Behaviour" detail="How the timer moves between focus and rest." />
                <div className="mt-3 divide-y divide-line/70 rounded-lg border border-line bg-surface/50 px-4 py-2">
                  <Switch
                    checked={settings.autoStartBreaks}
                    onChange={(next) => void save({ autoStartBreaks: next })}
                    label="Start a break automatically"
                    description="The break begins the moment a focus session is saved, without a confirmation."
                  />
                  <Switch
                    checked={settings.autoStartFocus}
                    onChange={(next) => void save({ autoStartFocus: next })}
                    label="Start the next session automatically"
                    description="A new session on the same subject begins when a break ends."
                  />
                  <Switch
                    checked={settings.confirmEarlyEnd}
                    onChange={(next) => void save({ confirmEarlyEnd: next })}
                    label="Confirm before ending a session early"
                    description="Asks once before recording a session as interrupted."
                  />
                  <Field
                    label="Maximum extension per session (minutes)"
                    type="number"
                    min={0}
                    max={240}
                    value={settings.maxExtendMinutes}
                    onChange={(event) => void save({ maxExtendMinutes: Number(event.target.value) })}
                    hint="Caps how far the +10m control can push a plan."
                    className="my-2"
                  />
                </div>
              </section>

              <section>
                <SectionHeading title="Scoring and streaks" detail="What the numbers measure." />
                <div className="mt-3 flex flex-col gap-4 rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <Field
                    label="Daily goal (minutes)"
                    type="number"
                    min={5}
                    max={960}
                    value={Math.round(settings.dailyGoalSeconds / 60)}
                    onChange={(event) => void save({ dailyGoalSeconds: Math.max(5, Number(event.target.value)) * 60 })}
                    hint={`Currently ${duration(settings.dailyGoalSeconds)}. This drives the cockpit ring.`}
                  />
                  <Field
                    label="A day counts towards a streak at (minutes)"
                    type="number"
                    min={1}
                    max={480}
                    value={Math.round(settings.successThresholdSeconds / 60)}
                    onChange={(event) => void save({ successThresholdSeconds: Math.max(1, Number(event.target.value)) * 60 })}
                    hint={`Currently ${duration(settings.successThresholdSeconds)}. Keep this lower than the goal — it measures showing up, not a good day.`}
                  />
                  <Field
                    label="Week starts on"
                    type="number"
                    min={0}
                    max={6}
                    value={settings.weekStart}
                    onChange={(event) => void save({ weekStart: Number(event.target.value) })}
                    hint="0 is Sunday, 1 is Monday. This changes how the week landscape is grouped."
                  />
                </div>
              </section>

              <section>
                <SectionHeading title="Time zone" detail="Every day boundary in the analytics is computed in this zone." />
                <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-4">
                  <TimeZoneField current={settings.timeZone} onSave={(timeZone) => save({ timeZone })} />
                  <p className="hint mt-2">
                    Sessions store absolute timestamps and are re-bucketed when this changes, so switching zones re-reads your history
                    correctly rather than losing it.
                  </p>
                </div>
              </section>
            </>
          )}

          {tab === 'appearance' && (
            <section>
              <SectionHeading title="Appearance" detail="Both themes are first-class; light mode is not an inverted dark mode." />
              <div className="mt-3 flex flex-col gap-5 rounded-lg border border-line bg-surface/50 px-4 py-4">
                <div>
                  <p className="label">Theme</p>
                  <div className="mt-2 flex gap-1.5">
                    {['dark', 'light', 'system'].map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={settings.theme === option}
                        onClick={() => {
                          if (option !== 'system') applyTheme(option as 'dark' | 'light');
                          void save({ theme: option });
                        }}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-small capitalize transition-colors duration-quick',
                          settings.theme === option
                            ? 'border-accent/60 bg-accent/10 text-ink'
                            : 'border-line text-faint hover:border-faint hover:text-muted',
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <p className="hint mt-2">
                    System follows your operating system and changes live when the OS switches at sunset.
                  </p>
                </div>

                <div>
                  <p className="label">Accent</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {['#5eead4', '#818cf8', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24', '#34d399'].map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Accent ${hex}`}
                        aria-pressed={settings.accent.toLowerCase() === hex}
                        onClick={() => void save({ accent: hex })}
                        className={cn(
                          'h-7 w-7 rounded-md border transition-transform duration-quick',
                          settings.accent.toLowerCase() === hex ? 'scale-110 border-ink' : 'border-transparent hover:scale-105',
                        )}
                        style={{ background: hex }}
                      />
                    ))}
                    <label className="flex h-7 items-center gap-2 rounded-md border border-line px-2 text-micro text-faint">
                      custom
                      <input
                        type="color"
                        value={settings.accent}
                        onChange={(event) => void save({ accent: event.target.value })}
                        className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                        aria-label="Pick a custom accent"
                      />
                    </label>
                  </div>
                  <p className="hint mt-2">
                    The accent is the fallback. During a session the instrument takes the colour of the subject you are working on.
                  </p>
                </div>

                <div className="divide-y divide-line/70">
                  <Switch
                    checked={settings.ambientBackground}
                    onChange={(next) => void save({ ambientBackground: next })}
                    label="Ambient background"
                    description="A soft wash behind the instrument that shifts with the timer state. Purely informational; turn it off if you prefer a flat canvas."
                  />
                  <Switch
                    checked={settings.reduceMotion}
                    onChange={(next) => void save({ reduceMotion: next })}
                    label="Reduce motion"
                    description={
                      prefersReducedMotion()
                        ? 'Your system already asks for reduced motion. This setting overrides it in either direction.'
                        : 'Removes the breathing background, the ring transitions and the reveal animations.'
                    }
                  />
                </div>
              </div>
            </section>
          )}

          {tab === 'sound' && (
            <section>
              <SectionHeading
                title="Sound"
                detail="Generated in the browser. No files, no streaming, no external service — so it works offline and never costs data."
              />
              <div className="mt-3 flex flex-col gap-5 rounded-lg border border-line bg-surface/50 px-4 py-4">
                <Switch
                  checked={settings.sound.enabled}
                  onChange={(next) => {
                    if (!next) stopAmbience();
                    void save({ sound: { ...settings.sound, enabled: next, ambience: next ? settings.sound.ambience : 'none' } });
                  }}
                  label="Sound enabled"
                  description="Turning this off silences everything, including the chime, without changing your other choices."
                />

                <div>
                  <p className="label">Ambience</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(AMBIENCE as readonly string[]).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        aria-pressed={settings.sound.ambience === kind}
                        disabled={!settings.sound.enabled}
                        onClick={() => {
                          if (kind === 'none') stopAmbience();
                          else playAmbience(kind as 'rain', settings.sound.volume);
                          void save({ sound: { ...settings.sound, ambience: kind } });
                        }}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-small transition-colors duration-quick',
                          settings.sound.ambience === kind
                            ? 'border-accent/60 bg-accent/10 text-ink'
                            : 'border-line text-faint hover:border-faint hover:text-muted',
                          !settings.sound.enabled && 'opacity-40',
                        )}
                      >
                        {AMBIENCE_LABELS[kind] ?? kind}
                      </button>
                    ))}
                  </div>
                  <p className="hint mt-2">
                    Ambience always starts from this button — a browser will not let the app begin playing sound on its own, and you would
                    not want it to.
                  </p>
                </div>

                <div>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor="volume" className="label">
                      Volume
                    </label>
                    <span className="font-mono text-micro text-faint">{Math.round(settings.sound.volume * 100)}%</span>
                  </div>
                  <input
                    id="volume"
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings.sound.volume * 100)}
                    disabled={!settings.sound.enabled}
                    onChange={(event) => {
                      const value = Number(event.target.value) / 100;
                      setAmbienceVolume(value);
                      void save({ sound: { ...settings.sound, volume: value } });
                    }}
                    className="mt-2 w-full accent-[rgb(var(--accent))]"
                  />
                </div>

                <div className="divide-y divide-line/70">
                  <Switch
                    checked={settings.sound.chime}
                    onChange={(next) => void save({ sound: { ...settings.sound, chime: next } })}
                    label="Chime at the end of a session"
                    description="Two soft notes, a fifth apart. Nothing plays when this is off."
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => playChime(settings.sound.volume, 'complete')}>
                    Preview the chime
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => stopAmbience()}>
                    Stop all sound
                  </Button>
                </div>
              </div>
            </section>
          )}

          {tab === 'notifications' && (
            <NotificationsSection
              notifications={settings.notifications}
              onSave={(notifications) => save({ notifications })}
              onTest={() => {
                if (!('Notification' in window)) {
                  toast({ tone: 'warning', title: 'This browser has no notification support', detail: 'The in-app notices still work.' });
                  return;
                }
                void Notification.requestPermission().then((permission) => {
                  if (permission !== 'granted') {
                    toast({ tone: 'info', title: 'Notifications were not granted', detail: 'In-app notices will still appear.' });
                    return;
                  }
                  new Notification('Studion', { body: 'This is how a session-complete notice looks.' });
                });
              }}
            />
          )}

          {tab === 'data' && <DataSection />}
          {tab === 'shortcuts' && <ShortcutsSection />}
          {tab === 'privacy' && <PrivacySection />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ profile

function ProfileSection() {
  const user = useApp((state) => state.user);
  const settings = useApp((state) => state.settings);
  const toast = useApp((state) => state.toast);
  const signOut = useApp((state) => state.signOut);

  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <section>
        <SectionHeading title="Profile" detail="Your name appears in the cockpit greeting and nowhere else." />
        <div className="mt-3 flex flex-col gap-4 rounded-lg border border-line bg-surface/50 px-4 py-4">
          <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          <Field label="Email" value={user.email} readOnly hint="The address your account is registered to. It cannot be changed here." />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!name.trim() || name.trim() === user.name}
              onClick={async () => {
                setBusy(true);
                const result = await api.auth.updateProfile({ name: name.trim() });
                setBusy(false);
                if (!result.ok) {
                  toast({ tone: 'error', title: 'Could not save your name', detail: result.error.message });
                  return;
                }
                useApp.setState({ user: result.data.user, settings: result.data.settings });
                toast({ tone: 'success', title: 'Profile updated' });
              }}
            >
              Save name
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPasswordOpen(true)}>
              Change password
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
          <p className="hint">
            Account created {user.createdAt ? new Date(user.createdAt).toISOString().slice(0, 10) : '—'}. Local time zone on the server:{' '}
            {settings?.timeZone ?? 'unknown'}.
          </p>
        </div>
      </section>

      <PasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useApp((state) => state.toast);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const problem = next.length > 0 && next.length < 10 ? 'At least 10 characters.' : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      description="Changing your password signs out every other device. This tab stays signed in."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!current || next.length < 10}
            onClick={async () => {
              setBusy(true);
              const result = await api.auth.changePassword({ currentPassword: current, newPassword: next });
              setBusy(false);
              if (!result.ok) {
                toast({
                  tone: 'error',
                  title: 'Password not changed',
                  detail: result.error.fields ? Object.values(result.error.fields)[0] : result.error.message,
                });
                return;
              }
              toast({ tone: 'success', title: 'Password changed', detail: 'Other devices have been signed out.' });
              setCurrent('');
              setNext('');
              onClose();
            }}
          >
            Change password
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Current password"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
        />
        <Field
          label="New password"
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          error={problem ?? undefined}
          hint="Ten characters or more. A passphrase of a few words is stronger than a short scramble."
        />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- timer bits

function PresetEditor({
  label,
  presets,
  onSave,
}: {
  label: string;
  presets: Array<{ minutes: number; label: string }>;
  onSave: (presets: Array<{ minutes: number; label: string }>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState('');

  return (
    <div>
      <p className="label">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {presets.map((preset) => (
          <span key={preset.minutes} className="chip">
            {preset.minutes}m
            <button
              type="button"
              aria-label={`Remove the ${preset.minutes} minute preset`}
              className="text-ghost transition-colors hover:text-alert"
              onClick={() => void onSave(presets.filter((entry) => entry.minutes !== preset.minutes))}
            >
              ×
            </button>
          </span>
        ))}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const minutes = Number(draft);
            if (!Number.isFinite(minutes) || minutes < 1 || minutes > 600) return;
            if (presets.some((entry) => entry.minutes === minutes)) return;
            void onSave([...presets, { minutes, label: String(minutes) }].sort((a, b) => a.minutes - b.minutes));
            setDraft('');
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="add min"
            aria-label={`Add a ${label.toLowerCase()} preset`}
            className="field w-20 py-1 text-tiny"
            inputMode="numeric"
          />
          <Button variant="ghost" size="sm" type="submit" disabled={!draft}>
            Add
          </Button>
        </form>
      </div>
    </div>
  );
}

/**
 * Time zone picker.
 *
 * The full list comes from `Intl.supportedValuesOf` where available, which is the
 * only source that is guaranteed to match what the formatting code will accept. A
 * free-text field is still offered for the case where it is missing, with the
 * current zone shown so the user can see what is actually in effect.
 */
function TimeZoneField({ current, onSave }: { current: string; onSave: (timeZone: string) => Promise<boolean> }) {
  const zones = (() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported !== 'function') return [];
    try {
      return supported('timeZone');
    } catch {
      return [];
    }
  })();

  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);

  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = offsetLabel(current);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {zones.length > 0 ? (
          <div className="min-w-[16rem] flex-1">
            <SelectField label="Time zone" value={value} onChange={(event) => setValue(event.target.value)}>
              {zones.includes(value) ? null : <option value={value}>{value}</option>}
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </SelectField>
          </div>
        ) : (
          <div className="min-w-[16rem] flex-1">
            <Field label="Time zone" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Asia/Kolkata" />
          </div>
        )}

        <Button variant="secondary" size="sm" disabled={value === current} onClick={() => void onSave(value)}>
          Apply
        </Button>
        {detected && detected !== value && (
          <Button variant="ghost" size="sm" onClick={() => setValue(detected)}>
            Use this device's zone ({detected.replace(/_/g, ' ')})
          </Button>
        )}
      </div>
      <p className="hint">
        Currently {current.replace(/_/g, ' ')} (UTC{offset}). Now there:{' '}
        {new Intl.DateTimeFormat('en-GB', { timeZone: current, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())}.
      </p>
    </div>
  );
}

function offsetLabel(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(new Date());
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC';
  return name.replace('GMT', '');
}

// ------------------------------------------------------------ notifications

function NotificationsSection({
  notifications,
  onSave,
  onTest,
}: {
  notifications: Record<string, boolean>;
  onSave: (notifications: Record<string, boolean>) => Promise<boolean>;
  onTest: () => void;
}) {
  const entries: Array<{ key: string; label: string; description: string }> = [
    { key: 'sessionComplete', label: 'Session complete', description: 'When a planned session reaches its duration.' },
    { key: 'breakFinished', label: 'Break finished', description: 'When a break has run its course.' },
    { key: 'dailyGoal', label: 'Daily goal reached', description: 'Once a day, the first time the daily goal is met.' },
    { key: 'weeklyGoal', label: 'Weekly goal reached', description: 'Once a week, when a weekly or monthly goal is met.' },
    { key: 'streak', label: 'Streak milestones', description: 'At 7, 30 and 100 days — and never more often than that.' },
    { key: 'sync', label: 'Sync problems', description: 'When a session could not be uploaded and is being held locally.' },
  ];

  return (
    <section>
      <SectionHeading
        title="Notifications"
        detail="Played by the browser, so what you get depends on whether this tab is focused — everything is also announced inside the app."
      />
      <div className="mt-3 divide-y divide-line/70 rounded-lg border border-line bg-surface/50 px-4 py-2">
        {entries.map((entry) => (
          <Switch
            key={entry.key}
            checked={notifications[entry.key] !== false}
            onChange={(next) => void onSave({ ...notifications, [entry.key]: next })}
            label={entry.label}
            description={entry.description}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onTest}>
          Send a test notification
        </Button>
        <span className="hint">
          Permission:{' '}
          {typeof Notification === 'undefined' ? 'unsupported in this browser' : Notification.permission}
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- shortcuts

function ShortcutsSection() {
  const settings = useApp((state) => state.settings);
  const updateSettings = useApp((state) => state.updateSettings);

  if (!settings) return null;

  const groups: Array<typeof SHORTCUT_REFERENCE[number]['group']> = ['Timer', 'Session', 'Navigation', 'View'];

  return (
    <section>
      <SectionHeading
        title="Keyboard shortcuts"
        detail="Shortcuts never fire while you are typing in a field, so it is always safe to write a note mid-session."
      />

      <div className="mt-3 rounded-lg border border-line bg-surface/50 px-4 py-2">
        <Switch
          checked={settings.shortcuts.enabled}
          onChange={(next) => void updateSettings({ shortcuts: { enabled: next } })}
          label="Keyboard shortcuts enabled"
          description="Turn this off if you use the space bar for something else on these screens."
        />
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group}>
            <p className="label mb-2">{group}</p>
            <ul className="divide-y divide-line/60">
              {SHORTCUT_REFERENCE.filter((entry) => entry.group === group).map((entry) => (
                <li key={entry.keys} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-small text-muted">{entry.action}</span>
                  <span className="shrink-0">
                    {entry.keys.includes('…') ? <span className="key">{entry.keys}</span> : <KeyHint combo={entry.keys} />}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p className="hint mt-4">
        Timer actions are also available from the command palette with a keyboard-only workflow — press ⌘K and type what you want.
      </p>
    </section>
  );
}

// --------------------------------------------------------------------- data

function DataSection() {
  const user = useApp((state) => state.user);
  const toast = useApp((state) => state.toast);
  const signOut = useApp((state) => state.signOut);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dataset, setDataset] = useState('sessions');
  const [format, setFormat] = useState<'json' | 'csv'>('csv');
  const [deleting, setDeleting] = useState(false);

  /**
   * Downloads go through the API host with the access token attached, so the
   * export is authorised exactly like every other request — no public signed URLs
   * that could outlive the session.
   */
  const download = async () => {
    const path = api.exportUrl({ format, dataset, ...(from ? { from } : {}), ...(to ? { to } : {}) });
    const response = await fetch(path, { credentials: 'include' });
    if (!response.ok) {
      toast({ tone: 'error', title: 'Export failed', detail: `The server returned ${response.status}.` });
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `studion-${dataset}-${new Date().toISOString().slice(0, 10)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast({ tone: 'success', title: 'Export downloaded' });
  };

  return (
    <>
      <section>
        <SectionHeading
          title="Export your data"
          detail="Everything the app knows about you, in a format you can read without this app. No account, no request, no waiting."
        />
        <div className="mt-3 flex flex-col gap-4 rounded-lg border border-line bg-surface/50 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="What" value={dataset} onChange={(event) => setDataset(event.target.value)}>
              <option value="sessions">Sessions</option>
              <option value="subjects">Subjects</option>
              <option value="tasks">Tasks</option>
              <option value="goals">Goals</option>
              <option value="daily">Daily analytics</option>
              <option value="all">Everything</option>
            </SelectField>
            <SelectField label="Format" value={format} onChange={(event) => setFormat(event.target.value as 'json' | 'csv')}>
              <option value="csv">CSV (spreadsheet)</option>
              <option value="json">JSON (complete, lossless)</option>
            </SelectField>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <Field label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={() => void download()}>
              Download {dataset === 'all' ? 'everything' : dataset}
            </Button>
            <span className="hint self-center">
              {format === 'csv' && dataset === 'all'
                ? 'CSV of everything exports one file per dataset, zipped by the server.'
                : 'JSON round-trips exactly; CSV drops nothing but flattens nested fields.'}
            </span>
          </div>
        </div>
      </section>

      <section>
        <SectionHeading title="Delete your account" detail="Permanent, immediate, and not reversible by support." />
        <div className="mt-3 rounded-lg border border-alert/30 bg-alert/[0.04] px-4 py-4">
          <p className="text-small text-muted">
            This removes your account, every session, subject, task, goal and setting. Your email address is released and the data is
            deleted — it is not soft-deleted and there is no recovery window.
          </p>
          <p className="hint mt-2">Export first if there is any chance you will want the record later.</p>
          <Button variant="danger" size="sm" className="mt-3" onClick={() => setDeleting(true)}>
            Delete my account
          </Button>
        </div>
      </section>

      <DeleteAccountModal
        open={deleting}
        email={user?.email ?? ''}
        onClose={() => setDeleting(false)}
        onDeleted={async () => {
          releaseAudio();
          await signOut();
        }}
      />
    </>
  );
}

function DeleteAccountModal({
  open,
  email,
  onClose,
  onDeleted,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const toast = useApp((state) => state.toast);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete your account"
      description="Both the password and the typed confirmation are required. This cannot be undone."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Keep my account
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!password || confirm.trim().toUpperCase() !== 'DELETE'}
            onClick={async () => {
              setBusy(true);
              const result = await api.auth.deleteAccount({ password, confirm: 'DELETE' });
              if (!result.ok) {
                setBusy(false);
                toast({
                  tone: 'error',
                  title: 'Account not deleted',
                  detail: result.error.status === 401 ? 'That password did not match.' : result.error.message,
                });
                return;
              }
              await onDeleted();
            }}
          >
            Delete everything
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-small text-muted">
          Everything recorded under <span className="text-ink">{email}</span> will be removed, including sessions held locally on this
          device.
        </p>
        <Field
          label="Your password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
        <Field
          label="Type DELETE to confirm"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="DELETE"
          autoComplete="off"
        />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ privacy

function PrivacySection() {
  const { data, loading } = usePrivacyStatement();
  const capabilities = useCapabilities();

  return (
    <>
      <section>
        <SectionHeading
          title="What is stored, and why"
          detail="The complete list, taken from the server rather than written here, so it cannot drift from what the code actually does."
        />
        <div className="mt-3 flex flex-col gap-3">
          {loading && <p className="hint">Loading the statement…</p>}
          {data?.statement.map((entry) => (
            <div key={entry.key} className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
              <p className="text-small text-ink">{entry.title}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {entry.stored.map((field) => (
                  <li key={field} className="chip font-mono text-micro">
                    {field}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-small text-muted">{entry.why}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionHeading title="What is not stored" />
        <ul className="mt-3 flex flex-col gap-2 text-small text-muted">
          {[
            'No third-party analytics, no session replay, no advertising identifiers.',
            'No keystroke, clipboard or window-title monitoring — distractions are logged only when you tap the button.',
            'No location data beyond the IANA time zone you choose.',
            'No plaintext password: only a bcrypt hash, computed before the record is ever written.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5">
              <span className="mt-[0.5rem] h-1 w-1 shrink-0 rounded-full bg-good" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading title="Your rights, in practice" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
            <p className="label">Access</p>
            <p className="mt-1 text-small text-muted">Export everything as JSON or CSV at any time, from the Data tab.</p>
          </div>
          <div className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
            <p className="label">Portability</p>
            <p className="mt-1 text-small text-muted">The JSON export is lossless and self-describing, so it survives without this app.</p>
          </div>
          <div className="rounded-lg border border-line bg-surface/50 px-4 py-3.5">
            <p className="label">Erasure</p>
            <p className="mt-1 text-small text-muted">Account deletion removes the records immediately. There is no soft-delete window.</p>
          </div>
        </div>
      </section>

      {capabilities.data && (
        <section>
          <SectionHeading title="This deployment" detail="Features the server reports it can currently serve." />
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {Object.entries(capabilities.data.capabilities).map(([key, enabled]) => (
              <li key={key} className={cn('chip', enabled ? 'chip-active' : 'opacity-60')}>
                {key}
                <span className="font-mono text-micro">{enabled ? 'on' : 'off'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
