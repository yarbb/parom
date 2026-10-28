// Names a key press as a shortcut ("Ctrl+Shift+K") by the key's place on the
// keyboard (event.code), so a shortcut is the same key on every layout.
// No imports, so it can be tested on its own.

/** The parts of a key press that name it (a KeyboardEvent has them all). */
export type KeyPress = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

const named: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
  NumpadAdd: '=', NumpadSubtract: '-', NumpadEnter: 'Enter', Space: 'Space',
};

/** The key itself, from its place on the keyboard; null for a modifier alone. */
function keyName(e: KeyPress): string | null {
  const code = e.code;
  if (/^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code) || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    return letter[1];
  }
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) {
    return digit[1];
  }
  if (named[code]) {
    return named[code];
  }
  if (/^(F\d{1,2}|Arrow\w+|Delete|Backspace|Enter|Escape|Tab|Home|End|PageUp|PageDown|Insert)$/.test(code)) {
    return code;
  }
  return e.key.length === 1 ? e.key.toUpperCase() : e.key || null;
}

/** "Ctrl+Shift+K" for a key press (Cmd counts as Ctrl); null for a modifier alone. */
export function comboOf(e: KeyPress): string | null {
  const key = keyName(e);
  if (!key) {
    return null;
  }
  const parts = [];
  if (e.ctrlKey || e.metaKey) {
    parts.push('Ctrl');
  }
  if (e.altKey) {
    parts.push('Alt');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  parts.push(key);
  return parts.join('+');
}
