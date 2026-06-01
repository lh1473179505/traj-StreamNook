// Chord parsing, normalization, and display.
//
// We key off KeyboardEvent.code (the physical key) rather than .key so that
// bindings are layout-stable and immune to Shift producing different glyphs
// ("Shift+." stays "Shift+." instead of flipping to ">"). The canonical string
// is what we store and match on; the display string is the pretty version.

export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Normalized physical-key token, e.g. 'M', '1', 'Space', '↑', ','. */
  key: string;
}

// Physical codes that carry no own glyph or want a friendly token.
const CODE_TO_TOKEN: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Minus: '-',
  Equal: '=',
  Slash: '/',
  Backslash: '\\',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
};

const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
]);

/** True when the event is a lone modifier key press (Shift, Ctrl, ...). */
export function isModifierEvent(e: KeyboardEvent): boolean {
  return (
    MODIFIER_CODES.has(e.code) ||
    e.key === 'Shift' ||
    e.key === 'Control' ||
    e.key === 'Alt' ||
    e.key === 'Meta'
  );
}

/** Map a physical key code (+ fallback key) to a normalized token. */
export function normalizeCode(code: string, key: string): string {
  if (code in CODE_TO_TOKEN) return CODE_TO_TOKEN[code];
  if (code.startsWith('Key')) return code.slice(3); // KeyM -> M
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 -> 1
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6); // Numpad5 -> Num5
  if (/^F\d{1,2}$/.test(code)) return code; // F1..F12
  if (key && key.length === 1) return key.toUpperCase();
  return key || code;
}

export function eventToChord(e: KeyboardEvent): Chord {
  return {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key: normalizeCode(e.code, e.key),
  };
}

/** Canonical, order-stable string used for storage and matching.
 *  Order: Ctrl, Alt, Shift, Meta, then the key. */
export function chordToCanonical(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Meta');
  parts.push(c.key);
  return parts.join('+');
}

export function eventToCanonical(e: KeyboardEvent): string {
  return chordToCanonical(eventToChord(e));
}

/** A chord is "complete" only once a non-modifier key is part of it. The
 *  recorder uses this to know when to stop capturing. */
export function isCompleteChord(c: Chord): boolean {
  return c.key.length > 0 && !['Shift', 'Control', 'Alt', 'Meta'].includes(c.key);
}

const PRETTY_WHOLE: Record<string, string> = {
  'Shift+/': '?',
  'Shift+.': '>',
  'Shift+,': '<',
};

/** Human-friendly rendering of a canonical chord (used in kbd chips). */
export function canonicalToDisplay(canonical: string): string {
  if (PRETTY_WHOLE[canonical]) return PRETTY_WHOLE[canonical];
  return canonical.replace(/\bMeta\b/g, '⌘');
}
