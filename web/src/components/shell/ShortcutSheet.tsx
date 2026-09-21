/**
 * The keyboard reference sheet.
 *
 * Opened with `?`. It lists the *actual* bindings from the shell's table rather
 * than a hand-written copy, so a shortcut can never be documented while not
 * working, or work while being undocumented. The pairs are kept in one constant
 * that both the shell and this sheet read.
 *
 * Shortcuts are also disabled-aware: if the user turns keyboard shortcuts off in
 * settings, the sheet says so instead of advertising keys that do nothing.
 */

import { KeyHint, Modal } from '../ui';
import { useApp } from '../../store/app';

export interface ShortcutReference {
  keys: string;
  action: string;
  group: 'Timer' | 'Session' | 'Navigation' | 'View';
}

/** The canonical list. Mirrors `AppShell`'s shortcut table. */
export const SHORTCUT_REFERENCE: ShortcutReference[] = [
  { keys: 'f', action: 'Start a focus session', group: 'Timer' },
  { keys: 'space', action: 'Pause or resume the timer', group: 'Timer' },
  { keys: 'b', action: 'Take or end a break', group: 'Timer' },
  { keys: 'd', action: 'Log a distraction', group: 'Session' },
  { keys: 'r', action: 'End the current session', group: 'Session' },
  { keys: 'mod+k', action: 'Open the command palette', group: 'Navigation' },
  { keys: '1 … 6', action: 'Jump between rooms', group: 'Navigation' },
  { keys: '?', action: 'Show this reference', group: 'Navigation' },
  { keys: 'm', action: 'Toggle focus mode', group: 'View' },
  { keys: 'esc', action: 'Close panels, dialogs and focus mode', group: 'View' },
  { keys: 'left', action: 'Previous day in a day view', group: 'View' },
  { keys: 'right', action: 'Next day in a day view', group: 'View' },
];

export function ShortcutSheet() {
  const open = useApp((state) => state.shortcutsOpen);
  const setOpen = useApp((state) => state.setShortcutsOpen);
  const enabled = useApp((state) => state.settings?.shortcuts?.enabled !== false);

  const groups: ShortcutReference['group'][] = ['Timer', 'Session', 'Navigation', 'View'];

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      description={
        enabled
          ? 'Everything in Studion is reachable without the mouse.'
          : 'Shortcuts are currently disabled in Settings — the keys below are listed for reference.'
      }
      size="md"
    >
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="label mb-2">{group}</h3>
            <ul className="divide-y divide-line/70">
              {SHORTCUT_REFERENCE.filter((item) => item.group === group).map((item) => (
                <li key={item.keys} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-small text-muted">{item.action}</span>
                  <span className="shrink-0">
                    {item.keys.includes('…') ? <span className="key">{item.keys}</span> : <KeyHint combo={item.keys} />}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="hint">
          Shortcuts never fire while you are typing in a field, so it is always safe to write a note mid-session.
        </p>
      </div>
    </Modal>
  );
}
