// Keyboard shortcuts (Preferences → Keyboard shortcuts). Every command has a
// default; the user's own choices live in prefs.keybindings ("" = none).
// Keys are named by their place on the keyboard (event.code), so Ctrl+S is
// the same key on any layout, Russian included.
import { prefs } from './prefs.svelte';

export { comboOf } from './keycombo';

/** "global": anywhere in the window; "list": in a file list that has the focus. */
export type KeyScope = 'global' | 'list';

export interface KeyCommand {
  id: string;
  /** Message key of its name. */
  label: string;
  scope: KeyScope;
  /** Default combination ("" = none until the user picks one). */
  key: string;
}

export const keyCommands: KeyCommand[] = [
  { id: 'siteManager', label: 'menu.site_manager', scope: 'global', key: 'Ctrl+S' },
  { id: 'preferences', label: 'menu.preferences', scope: 'global', key: 'Ctrl+,' },
  { id: 'tabFiles', label: 'tab.files', scope: 'global', key: 'Ctrl+1' },
  { id: 'tabGithub', label: 'tab.github', scope: 'global', key: 'Ctrl+2' },
  { id: 'log', label: 'log.title', scope: 'global', key: 'Ctrl+L' },
  { id: 'syncBrowse', label: 'files.sync_browse', scope: 'global', key: 'Ctrl+Y' },
  { id: 'reconnect', label: 'menu.reconnect', scope: 'global', key: 'Ctrl+R' },
  { id: 'disconnect', label: 'common.disconnect', scope: 'global', key: 'Ctrl+D' },
  { id: 'sync', label: 'sync.sync_with_server', scope: 'global', key: '' },
  { id: 'checkUpdates', label: 'menu.check_updates', scope: 'global', key: '' },
  { id: 'zoomIn', label: 'menu.zoom_in', scope: 'global', key: 'Ctrl+=' },
  { id: 'zoomOut', label: 'menu.zoom_out', scope: 'global', key: 'Ctrl+-' },
  { id: 'zoomReset', label: 'prefs.keys.zoom_reset', scope: 'global', key: 'Ctrl+0' },
  { id: 'rename', label: 'fileop.rename.title', scope: 'list', key: 'F2' },
  { id: 'delete', label: 'prefs.keys.delete', scope: 'list', key: 'Delete' },
  { id: 'refresh', label: 'files.refresh', scope: 'list', key: 'F5' },
  { id: 'parent', label: 'prefs.keys.up', scope: 'list', key: 'Backspace' },
];

/** A command's combination now: the user's choice, else its default. */
export function keyOf(id: string, bindings: Record<string, string> = prefs.value.keybindings ?? {}): string {
  return bindings[id] ?? keyCommands.find((c) => c.id === id)?.key ?? '';
}

/** The command a combination runs in a scope, if any. */
export function commandFor(combo: string, scope: KeyScope): KeyCommand | undefined {
  return keyCommands.find((c) => c.scope === scope && keyOf(c.id) === combo);
}

/** For menus: the combination shown next to a command, or nothing. */
export function hint(id: string): string | undefined {
  return keyOf(id) || undefined;
}
