// Key bindings of the world. Every action has a visible control as well; these are the defaults, and the player can
// change any of them (stored in this browser only). Keys are matched by physical position (KeyboardEvent.code), so
// W-A-S-D stays where the fingers are on any layout. Arrow keys always work as a second set of movement keys.
export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'brake'
  | 'focus' | 'return' | 'overview' | 'capture' | 'view' | 'pause' | 'step' | 'tool' | 'context' | 'help';

export const ACTIONS: Array<{ id: Action; label: string; group: 'Move' | 'Look at' | 'Model' | 'Other' }> = [
  { id: 'forward', label: 'Forward', group: 'Move' }, { id: 'back', label: 'Back', group: 'Move' },
  { id: 'left', label: 'Left', group: 'Move' }, { id: 'right', label: 'Right', group: 'Move' },
  { id: 'up', label: 'Up', group: 'Move' }, { id: 'down', label: 'Down', group: 'Move' },
  { id: 'brake', label: 'Brake / precise', group: 'Move' },
  { id: 'capture', label: 'Mouse look on / off', group: 'Look at' },
  { id: 'focus', label: 'Focus the selection', group: 'Look at' }, { id: 'return', label: 'Return to where I was', group: 'Look at' },
  { id: 'overview', label: 'Overview', group: 'Look at' }, { id: 'view', label: 'Third / first person', group: 'Look at' },
  { id: 'pause', label: 'Pause / run the model', group: 'Model' }, { id: 'step', label: 'Step the model', group: 'Model' },
  { id: 'tool', label: 'Use the tool', group: 'Model' }, { id: 'context', label: 'Explore ↔ Pilot', group: 'Model' },
  { id: 'help', label: 'Show the controls', group: 'Other' },
];
export const MOVE: readonly Action[] = ['forward', 'back', 'left', 'right', 'up', 'down', 'brake'];

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', up: 'KeyE', down: 'KeyQ', brake: 'Shift',
  focus: 'KeyF', return: 'KeyR', overview: 'KeyM', capture: 'KeyL', view: 'KeyV', pause: 'Space', step: 'Period', tool: 'KeyC', context: 'KeyP', help: 'KeyH',
};
const ARROWS: Record<string, Action> = { ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right' };
const STORE = 'hbci.world.keys.v1';
/** Keys that may not be bound: they belong to the browser or to leaving a mode. */
const RESERVED = new Set(['Escape', 'Tab', 'Enter', 'MetaLeft', 'MetaRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * The physical key of an event. Some input sources (on-screen keyboards, remote sessions) send no `code`; the
 * printed character is used then, so that the world still answers.
 */
export function codeOf(e: { code: string; key?: string }): string {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
  if (e.code) return e.code;
  const k = e.key ?? '';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return ({ ' ': 'Space', '.': 'Period', ',': 'Comma', '/': 'Slash', Shift: 'Shift' } as Record<string, string>)[k] ?? k;
}
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return ({ Space: 'Space', Shift: 'Shift', Period: '.', Comma: ',', Slash: '/', Semicolon: ';', Quote: '’', BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '−', Equal: '=', Backspace: '⌫', Backslash: '\\' } as Record<string, string>)[code] ?? code;
}

export function loadKeys(): Record<Action, string> {
  const keys = { ...DEFAULT_KEYS };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>;
    for (const a of ACTIONS) if (typeof raw[a.id] === 'string' && !RESERVED.has(raw[a.id] as string)) keys[a.id] = raw[a.id] as string;
  } catch { /* storage unavailable or damaged: defaults */ }
  return keys;
}
export function saveKeys(keys: Record<Action, string>): void { try { localStorage.setItem(STORE, JSON.stringify(keys)); } catch { /* not stored */ } }

/** Bind an action to a key. If another action had that key, the two swap. Returns the new table, or null if the key is reserved. */
export function rebind(keys: Record<Action, string>, action: Action, code: string): Record<Action, string> | null {
  if (RESERVED.has(code)) return null;
  const next = { ...keys }, other = ACTIONS.find((a) => a.id !== action && next[a.id] === code);
  if (other) next[other.id] = next[action];
  next[action] = code;
  return next;
}
export function actionFor(keys: Record<Action, string>, code: string): Action | null {
  for (const a of ACTIONS) if (keys[a.id] === code) return a.id;
  return ARROWS[code] ?? null;
}
/** True when a key press belongs to a text field, a slider or a menu, not to the world. */
export function isTyping(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
