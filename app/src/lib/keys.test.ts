import { describe, expect, it } from 'vitest';
import { comboOf } from './keycombo';

const press = (code: string, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) =>
  comboOf({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('shortcut names', () => {
  it('names keys by their place, whatever the layout', () => {
    expect(press('KeyS', 's', { ctrlKey: true })).toBe('Ctrl+S');
    // Russian layout: the same key types "ы".
    expect(press('KeyS', 'ы', { ctrlKey: true })).toBe('Ctrl+S');
    expect(press('Comma', 'б', { ctrlKey: true })).toBe('Ctrl+,');
  });

  it('orders modifiers and keeps named keys', () => {
    expect(press('KeyK', 'K', { ctrlKey: true, shiftKey: true, altKey: true })).toBe('Ctrl+Alt+Shift+K');
    expect(press('F2', 'F2')).toBe('F2');
    expect(press('Delete', 'Delete', { shiftKey: true })).toBe('Shift+Delete');
    expect(press('Numpad1', '1', { ctrlKey: true })).toBe('Ctrl+1');
  });

  it('waits for a key when only a modifier is pressed', () => {
    expect(press('ControlLeft', 'Control', { ctrlKey: true })).toBeNull();
  });
});
